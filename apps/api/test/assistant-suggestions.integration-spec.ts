import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { PrismaService } from '../src/database/prisma.service';
import { AssistantWorkerService } from '../src/modules/assistant/assistant-worker.service';
import { hashOpaqueToken } from '../src/modules/auth/auth.service';
import { type Clock, CLOCK } from '../src/modules/auth/clock';

const origin = 'http://localhost:5173';

class FakeClock implements Clock {
  private current = new Date('2026-07-21T09:00:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  reset(): void {
    this.current = new Date('2026-07-21T09:00:00.000Z');
  }
}

interface TestSession {
  cookie: string;
  userId: string;
}

describe('bounded assistant suggestions', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: AssistantWorkerService;
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
    worker = app.get(AssistantWorkerService);
  });

  beforeEach(async () => {
    clock.reset();
    await prisma.user.deleteMany();
  });

  afterAll(async () => app.close());

  async function createSession(label: string): Promise<TestSession> {
    const token = `assistant-session-${label}`;
    const now = clock.now();
    const user = await prisma.user.create({
      data: {
        email: `${label}@example.test`,
        timezone: 'UTC',
        preferences: { create: {} },
        sessions: {
          create: {
            tokenHash: hashOpaqueToken(token),
            expiresAt: new Date(now.getTime() + 86_400_000),
            lastUsedAt: now,
          },
        },
      },
    });
    return { cookie: `execution_session=${token}`, userId: user.id };
  }

  async function createTask(session: TestSession, title: string) {
    return request(app.getHttpServer())
      .post('/tasks')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({ title, estimateMinutes: 30 })
      .expect(201);
  }

  async function processQueued(suggestionId: string): Promise<void> {
    const before = await prisma.aiSuggestion.findUniqueOrThrow({
      where: { id: suggestionId },
    });
    if (before.status === 'queued') await worker.runOnce();
    const after = await prisma.aiSuggestion.findUniqueOrThrow({
      where: { id: suggestionId },
    });
    expect(after.status).toBe('completed');
  }

  it('stores extraction without mutation, isolates ownership, and applies once with audit events', async () => {
    const user = await createSession('extract-owner');
    const other = await createSession('extract-other');

    const created = await request(app.getHttpServer())
      .post('/assistant/suggestions')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({
        type: 'task_extraction',
        sourceText: 'Prepare evidence and submit the claim',
        idempotencyKey: 'extract-claim-0001',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      type: 'task_extraction',
      status: 'completed',
    });
    expect(await prisma.task.count({ where: { userId: user.userId } })).toBe(0);

    await request(app.getHttpServer())
      .get(`/assistant/suggestions/${String(created.body.id)}`)
      .set('Cookie', other.cookie)
      .expect(404);

    const duplicate = await request(app.getHttpServer())
      .post('/assistant/suggestions')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({
        type: 'task_extraction',
        sourceText: 'ignored duplicate content',
        idempotencyKey: 'extract-claim-0001',
      })
      .expect(201);
    expect(duplicate.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post(`/assistant/suggestions/${String(created.body.id)}/accept`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({})
      .expect(201)
      .expect((response) => expect(response.body.status).toBe('accepted'));

    const tasks = await prisma.task.findMany({
      where: { userId: user.userId },
      include: { events: { orderBy: { taskVersion: 'asc' } } },
      orderBy: { title: 'asc' },
    });
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.events.map((event) => event.type))).toEqual(
      [
        ['created', 'ai_suggestion_accepted'],
        ['created', 'ai_suggestion_accepted'],
      ],
    );

    await request(app.getHttpServer())
      .post(`/assistant/suggestions/${String(created.body.id)}/accept`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({})
      .expect(201);
    expect(await prisma.task.count({ where: { userId: user.userId } })).toBe(2);
  });

  it('collapses concurrent idempotent creates to one suggestion', async () => {
    const user = await createSession('idempotency-race');
    await createTask(user, 'A candidate for the plan');
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app.getHttpServer())
          .post('/assistant/suggestions')
          .set('Cookie', user.cookie)
          .set('Origin', origin)
          .send({
            type: 'daily_plan',
            idempotencyKey: 'daily-plan-race-2026-07-21',
          }),
      ),
    );

    expect(responses.every((response) => response.status === 202)).toBe(true);
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);
    expect(
      await prisma.aiSuggestion.count({
        where: {
          userId: user.userId,
          type: 'daily_plan',
          idempotencyKey: 'daily-plan-race-2026-07-21',
        },
      }),
    ).toBe(1);
  });

  it('rejects a suggestion without applying it and detects stale decomposition', async () => {
    const user = await createSession('decompose');
    const task = await createTask(user, 'Prepare launch');
    const suggestion = await request(app.getHttpServer())
      .post('/assistant/suggestions')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ type: 'task_decomposition', taskId: task.body.id })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/tasks/${String(task.body.id)}`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ title: 'Prepare launch safely' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/assistant/suggestions/${String(suggestion.body.id)}/accept`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({})
      .expect(409)
      .expect((response) =>
        expect(response.body.code).toBe('ASSISTANT_SUGGESTION_STALE'),
      );
    expect(
      await prisma.task.count({ where: { parentTaskId: task.body.id } }),
    ).toBe(0);

    const rejection = await request(app.getHttpServer())
      .post(`/assistant/suggestions/${String(suggestion.body.id)}/reject`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ reason: 'not_now' })
      .expect(200);
    expect(rejection.body.status).toBe('rejected');
  });

  it('queues and applies a daily plan without scheduling before confirmation', async () => {
    const user = await createSession('plan');
    await createTask(user, 'Primary work');
    await createTask(user, 'Secondary work');

    const suggestion = await request(app.getHttpServer())
      .post('/assistant/suggestions')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ type: 'daily_plan', idempotencyKey: 'daily-plan-2026-07-21' })
      .expect(202);
    expect(suggestion.body.status).toBe('queued');
    expect(
      await prisma.dailyPlan.count({ where: { userId: user.userId } }),
    ).toBe(0);

    await processQueued(String(suggestion.body.id));
    expect(
      await prisma.dailyPlan.count({ where: { userId: user.userId } }),
    ).toBe(0);
    await request(app.getHttpServer())
      .post(`/assistant/suggestions/${String(suggestion.body.id)}/accept`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({})
      .expect(201);
    const plan = await prisma.dailyPlan.findFirst({
      where: { userId: user.userId },
      include: { items: true },
    });
    expect(plan?.items).toHaveLength(2);
  });

  it('applies carryover diagnosis metadata and a grounded outcome summary', async () => {
    const user = await createSession('diagnosis-summary');
    const task = await createTask(user, 'Repeatedly delayed');
    await prisma.task.update({
      where: { id: task.body.id },
      data: { carryoverCount: 3 },
    });
    const diagnosis = await request(app.getHttpServer())
      .post('/assistant/suggestions')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ type: 'carryover_diagnosis', taskId: task.body.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/assistant/suggestions/${String(diagnosis.body.id)}/accept`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({})
      .expect(201);
    const diagnosed = await prisma.task.findUniqueOrThrow({
      where: { id: task.body.id },
    });
    expect(diagnosed.blockReason).toBe('unclear_next_step');

    await prisma.dailyReview.create({
      data: {
        userId: user.userId,
        date: new Date('2026-07-21T00:00:00.000Z'),
        primaryOutcomeCompleted: true,
        focusedMinutes: 90,
        completedPlannedTasks: 1,
      },
    });
    const summary = await request(app.getHttpServer())
      .post('/assistant/suggestions')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ type: 'outcome_summary', date: '2026-07-21' })
      .expect(202);
    await processQueued(String(summary.body.id));
    await request(app.getHttpServer())
      .post(`/assistant/suggestions/${String(summary.body.id)}/accept`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({})
      .expect(201);
    const review = await prisma.dailyReview.findFirstOrThrow({
      where: { userId: user.userId },
    });
    expect(review.assistantSummary).toContain('90 focused minutes');
  });
});
