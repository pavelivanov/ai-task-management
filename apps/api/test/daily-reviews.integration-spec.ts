import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { PrismaService } from '../src/database/prisma.service';
import { hashOpaqueToken } from '../src/modules/auth/auth.service';
import { type Clock, CLOCK } from '../src/modules/auth/clock';

const origin = 'http://localhost:5173';

class FakeClock implements Clock {
  private current = new Date('2026-07-20T20:55:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  reset(iso = '2026-07-20T20:55:00.000Z'): void {
    this.current = new Date(iso);
  }
}

interface TestSession {
  cookie: string;
  userId: string;
}

interface ReviewResponse {
  id: string;
  date: string;
  primaryOutcomeCompleted: boolean;
  focusedMinutes: number;
  completedPlannedTasks: number;
  completedUnplannedTasks: number;
  carriedOverTasks: number;
  focusSessions: number;
  interruptionCount: number;
  userReflection: string | null;
  assistantSummary: string | null;
}

describe('deterministic daily reviews', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const clock = new FakeClock();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    clock.reset();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createSession(
    label: string,
    timezone = 'UTC',
  ): Promise<TestSession> {
    const token = `daily-review-session-${label}`;
    const now = clock.now();
    const user = await prisma.user.create({
      data: {
        email: `${label}@example.test`,
        timezone,
        preferences: { create: {} },
        sessions: {
          create: {
            tokenHash: hashOpaqueToken(token),
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
            lastUsedAt: now,
          },
        },
      },
    });
    return { cookie: `execution_session=${token}`, userId: user.id };
  }

  async function generate(
    session: TestSession,
    date = '2026-07-20',
  ): Promise<ReviewResponse> {
    const response = await request(app.getHttpServer())
      .post(`/reviews/daily/${date}/generate`)
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .expect(201);
    return response.body as ReviewResponse;
  }

  it('generates an empty review and also generates when an empty plan closes', async () => {
    const session = await createSession('empty');

    const first = await generate(session);
    expect(first).toMatchObject({
      date: '2026-07-20',
      primaryOutcomeCompleted: false,
      focusedMinutes: 0,
      completedPlannedTasks: 0,
      completedUnplannedTasks: 0,
      carriedOverTasks: 0,
      focusSessions: 0,
      interruptionCount: 0,
      userReflection: null,
      assistantSummary: null,
    });

    const createdPlan = await request(app.getHttpServer())
      .post('/daily-plans/today')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post('/daily-plans/today/close')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({ expectedPlanVersion: createdPlan.body.version })
      .expect(201);
    await request(app.getHttpServer())
      .get('/reviews/daily/2026-07-20')
      .set('Cookie', session.cookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.id).toBe(first.id);
      });
  });

  it('recomputes authoritative outcomes and clips focus at local midnight', async () => {
    const session = await createSession('mixed', 'Europe/Moscow');
    const date = new Date('2026-07-20T00:00:00.000Z');
    const primary = await prisma.task.create({
      data: {
        userId: session.userId,
        title: 'Ship the review',
        category: 'work',
        status: 'completed',
        version: 4,
        completedAt: new Date('2026-07-20T10:00:00.000Z'),
      },
    });
    const secondary = await prisma.task.create({
      data: {
        userId: session.userId,
        title: 'Prepare notes',
        category: 'work',
        status: 'backlog',
        version: 3,
      },
    });
    const unplanned = await prisma.task.create({
      data: {
        userId: session.userId,
        title: 'Handle interruption',
        category: 'work',
        status: 'completed',
        version: 2,
        completedAt: new Date('2026-07-20T12:00:00.000Z'),
      },
    });
    const plan = await prisma.dailyPlan.create({
      data: {
        userId: session.userId,
        date,
        workdayStart: new Date('1970-01-01T09:00:00.000Z'),
        workdayEnd: new Date('1970-01-01T17:00:00.000Z'),
        status: 'closed',
        closedAt: new Date('2026-07-20T20:55:00.000Z'),
        items: {
          create: [
            { taskId: primary.id, role: 'primary', position: 0 },
            { taskId: secondary.id, role: 'secondary', position: 1 },
          ],
        },
      },
    });
    await prisma.taskEvent.createMany({
      data: [
        {
          userId: session.userId,
          taskId: primary.id,
          taskVersion: 1,
          type: 'completed',
          metadata: {},
          createdAt: new Date('2026-07-20T10:00:00.000Z'),
        },
        {
          userId: session.userId,
          taskId: unplanned.id,
          taskVersion: 1,
          type: 'completed',
          metadata: {},
          createdAt: new Date('2026-07-20T12:00:00.000Z'),
        },
        {
          userId: session.userId,
          taskId: secondary.id,
          taskVersion: 1,
          type: 'paused',
          metadata: {},
          createdAt: new Date('2026-07-20T13:00:00.000Z'),
        },
        {
          userId: session.userId,
          taskId: secondary.id,
          taskVersion: 2,
          type: 'carried_over',
          metadata: { sourcePlanDate: '2026-07-20', dailyPlanId: plan.id },
          createdAt: new Date('2026-07-20T20:50:00.000Z'),
        },
      ],
    });

    await prisma.focusSession.create({
      data: {
        userId: session.userId,
        taskId: primary.id,
        status: 'completed',
        startedAt: new Date('2026-07-19T20:50:00.000Z'),
        endedAt: new Date('2026-07-19T21:10:00.000Z'),
        segments: {
          create: {
            sequence: 0,
            type: 'focused',
            startedAt: new Date('2026-07-19T20:50:00.000Z'),
            endedAt: new Date('2026-07-19T21:10:00.000Z'),
          },
        },
      },
    });
    await prisma.focusSession.create({
      data: {
        userId: session.userId,
        taskId: primary.id,
        status: 'completed',
        startedAt: new Date('2026-07-20T20:50:00.000Z'),
        endedAt: new Date('2026-07-20T21:10:00.000Z'),
        segments: {
          create: {
            sequence: 0,
            type: 'focused',
            startedAt: new Date('2026-07-20T20:50:00.000Z'),
            endedAt: new Date('2026-07-20T21:10:00.000Z'),
          },
        },
      },
    });

    const first = await generate(session);
    expect(first).toMatchObject({
      primaryOutcomeCompleted: true,
      focusedMinutes: 15,
      completedPlannedTasks: 1,
      completedUnplannedTasks: 1,
      carriedOverTasks: 1,
      focusSessions: 2,
      interruptionCount: 1,
    });

    await request(app.getHttpServer())
      .patch('/reviews/daily/2026-07-20')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({ userReflection: 'The primary outcome moved the work forward.' })
      .expect(200);
    await prisma.dailyReview.update({
      where: { id: first.id },
      data: { assistantSummary: 'Reserved for a later deterministic input.' },
    });
    await prisma.taskEvent.create({
      data: {
        userId: session.userId,
        taskId: secondary.id,
        taskVersion: 3,
        type: 'completed',
        metadata: {},
        createdAt: new Date('2026-07-20T20:54:00.000Z'),
      },
    });

    const recomputed = await generate(session);
    expect(recomputed).toMatchObject({
      id: first.id,
      completedPlannedTasks: 2,
      completedUnplannedTasks: 1,
      userReflection: 'The primary outcome moved the work forward.',
      assistantSummary: 'Reserved for a later deterministic input.',
    });
    expect(await prisma.dailyReview.count()).toBe(1);
  });

  it('isolates generation and reads by authenticated user', async () => {
    const owner = await createSession('owner');
    const stranger = await createSession('stranger');
    const review = await generate(owner);

    await request(app.getHttpServer())
      .get('/reviews/daily/2026-07-20')
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app.getHttpServer())
      .patch('/reviews/daily/2026-07-20')
      .set('Cookie', stranger.cookie)
      .set('Origin', origin)
      .send({ userReflection: 'Not mine.' })
      .expect(404);

    expect(
      await prisma.dailyReview.findUnique({ where: { id: review.id } }),
    ).toMatchObject({ userId: owner.userId, userReflection: null });
  });
});
