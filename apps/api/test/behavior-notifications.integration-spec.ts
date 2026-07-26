import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { PrismaService } from '../src/database/prisma.service';
import { hashOpaqueToken } from '../src/modules/auth/auth.service';
import { type Clock, CLOCK } from '../src/modules/auth/clock';
import { BehaviorSchedulerService } from '../src/modules/behavior/behavior-scheduler.service';
import { FakePushGateway } from '../src/modules/behavior/fake-push.gateway';
import { NotificationWorkerService } from '../src/modules/behavior/notification-worker.service';
import { PUSH_GATEWAY } from '../src/modules/behavior/push-gateway';

const origin = 'http://localhost:5173';

class FakeClock implements Clock {
  private current = new Date('2026-07-20T10:30:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  reset(iso = '2026-07-20T10:30:00.000Z'): void {
    this.current = new Date(iso);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}

interface TestSession {
  userId: string;
  cookie: string;
}

describe('deterministic behavior and notification boundaries', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scheduler: BehaviorSchedulerService;
  let worker: NotificationWorkerService;
  let push: FakePushGateway;
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
    scheduler = app.get(BehaviorSchedulerService);
    worker = app.get(NotificationWorkerService);
    push = app.get(PUSH_GATEWAY) as FakePushGateway;
  });

  beforeEach(async () => {
    clock.reset();
    push.reset();
    await prisma.user.deleteMany();
  });

  afterAll(async () => app.close());

  async function session(
    label: string,
    preferences = {},
  ): Promise<TestSession> {
    const token = `behavior-${label}`;
    const now = clock.now();
    const user = await prisma.user.create({
      data: {
        email: `${label}@example.test`,
        timezone: 'UTC',
        preferences: { create: preferences },
        sessions: {
          create: {
            tokenHash: hashOpaqueToken(token),
            expiresAt: new Date(now.getTime() + 86_400_000),
            lastUsedAt: now,
          },
        },
      },
    });
    return { userId: user.id, cookie: `execution_session=${token}` };
  }

  async function createTask(
    actor: TestSession,
    input: Record<string, unknown>,
  ): Promise<{ id: string; status: string }> {
    const response = await request(app.getHttpServer())
      .post('/tasks')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send(input)
      .expect(201);
    return response.body as { id: string; status: string };
  }

  function subscribe(actor: TestSession, endpoint: string) {
    return request(app.getHttpServer())
      .post('/notifications/push/subscriptions')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({
        endpoint,
        expirationTime: null,
        keys: { p256dh: 'public-encryption-key', auth: 'auth-secret' },
      });
  }

  it('warns before personal work, preserves explicit override, and schedules after work', async () => {
    const actor = await session('protected', {
      protectedHoursEnabled: true,
      protectedHoursStart: new Date('1970-01-01T10:00:00.000Z'),
      protectedHoursEnd: new Date('1970-01-01T12:00:00.000Z'),
    });
    const personal = await createTask(actor, {
      title: 'Book a personal appointment',
      category: 'personal',
    });

    const warning = await request(app.getHttpServer())
      .post('/focus/start')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ taskId: personal.id })
      .expect(409);
    expect(warning.body).toMatchObject({
      code: 'PROTECTED_HOURS_CONFIRMATION_REQUIRED',
      scheduleAfterWorkAt: '2026-07-20T12:00:00.000Z',
    });
    expect(
      await prisma.focusSession.count({ where: { userId: actor.userId } }),
    ).toBe(0);

    const scheduled = await request(app.getHttpServer())
      .post('/focus/schedule-after-protected-hours')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ taskId: personal.id })
      .expect(201);
    expect(scheduled.body.items[0]).toMatchObject({
      taskId: personal.id,
      role: 'optional',
      plannedStart: '2026-07-20T12:00:00.000Z',
    });

    const second = await createTask(actor, {
      title: 'Urgent family call',
      category: 'personal',
    });
    await request(app.getHttpServer())
      .post('/focus/start')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ taskId: second.id, protectedHoursOverride: true })
      .expect(201);
  });

  it('allows critical and planned personal-admin exceptions without a warning', async () => {
    const actor = await session('exceptions', {
      protectedHoursEnabled: true,
      protectedHoursStart: new Date('1970-01-01T10:00:00.000Z'),
      protectedHoursEnd: new Date('1970-01-01T12:00:00.000Z'),
    });
    const urgent = await createTask(actor, {
      title: 'Urgent personal issue',
      category: 'personal',
      priority: 'critical',
    });
    const started = await request(app.getHttpServer())
      .post('/focus/start')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ taskId: urgent.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/focus/${started.body.id as string}/stop`)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ taskStatus: 'backlog' })
      .expect(201);

    const planned = await createTask(actor, {
      title: 'Planned personal admin',
      category: 'personal',
    });
    await prisma.dailyPlan.create({
      data: {
        userId: actor.userId,
        date: new Date('2026-07-20T00:00:00.000Z'),
        workdayStart: new Date('1970-01-01T09:00:00.000Z'),
        workdayEnd: new Date('1970-01-01T17:00:00.000Z'),
        status: 'active',
        items: {
          create: {
            taskId: planned.id,
            role: 'optional',
            plannedStart: new Date('2026-07-20T10:45:00.000Z'),
            position: 0,
          },
        },
      },
    });
    await prisma.task.update({
      where: { id: planned.id },
      data: { status: 'planned' },
    });
    await request(app.getHttpServer())
      .post('/focus/start')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ taskId: planned.id })
      .expect(201);
  });

  it('returns at most three owned short tasks after a real waiting threshold', async () => {
    const actor = await session('waiting', {
      protectedHoursEnabled: true,
      protectedHoursStart: new Date('1970-01-01T10:00:00.000Z'),
      protectedHoursEnd: new Date('1970-01-01T12:00:00.000Z'),
    });
    const other = await session('waiting-other');
    const current = await createTask(actor, {
      title: 'Wait for build',
      estimateMinutes: 30,
    });
    for (const [title, estimateMinutes, priority] of [
      ['Small normal', 10, 'normal'],
      ['Small high', 15, 'high'],
      ['Tiny task', 5, 'normal'],
      ['Fourth fit', 10, 'low'],
      ['Too large', 60, 'critical'],
    ] as const) {
      await createTask(actor, { title, estimateMinutes, priority });
    }
    await createTask(actor, {
      title: 'Personal short task',
      estimateMinutes: 5,
      category: 'personal',
    });
    await createTask(other, { title: 'Another user task', estimateMinutes: 5 });
    const started = await request(app.getHttpServer())
      .post('/focus/start')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ taskId: current.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/focus/${started.body.id as string}/wait`)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ expectedWaitMinutes: 20 })
      .expect(201);

    await request(app.getHttpServer())
      .get('/behavior/waiting-suggestions')
      .set('Cookie', actor.cookie)
      .expect(404);
    clock.advanceMinutes(5);
    const suggestions = await request(app.getHttpServer())
      .get('/behavior/waiting-suggestions')
      .set('Cookie', actor.cookie)
      .expect(200);
    expect(suggestions.body.tasks).toHaveLength(3);
    expect(
      suggestions.body.tasks.map((task: { title: string }) => task.title),
    ).toEqual(['Small high', 'Tiny task', 'Small normal']);
    expect(suggestions.body.explanation).toBeNull();
  });

  it('deduplicates concurrent trigger evaluation and delivers through the fake gateway', async () => {
    const actor = await session('scheduler', {
      notificationsEnabled: true,
      morningPlanningReminder: true,
      aiInterruptionLevel: 'proactive',
    });
    await subscribe(actor, 'https://push.example.test/scheduler').expect(201);
    await Promise.all([
      scheduler.evaluateUser(actor.userId),
      scheduler.evaluateUser(actor.userId),
      scheduler.evaluateUser(actor.userId),
    ]);
    expect(
      await prisma.assistantTrigger.count({
        where: { userId: actor.userId, type: 'morning_plan_missing' },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({ where: { userId: actor.userId } }),
    ).toBe(1);

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(push.deliveries).toHaveLength(1);
    expect(push.deliveries[0]?.payload.body).toBe('Open Fieldnote to review.');
    expect(
      await prisma.notification.findFirst({ where: { userId: actor.userId } }),
    ).toMatchObject({ deliveryStatus: 'sent' });
  });

  it('keeps opt-out in audit state without creating a notification', async () => {
    const actor = await session('optout', {
      morningPlanningReminder: true,
      notificationsEnabled: false,
    });
    await scheduler.evaluateUser(actor.userId);
    expect(
      await prisma.assistantTrigger.findFirst({
        where: { userId: actor.userId },
      }),
    ).toMatchObject({ status: 'resolved' });
    expect(
      await prisma.notification.count({ where: { userId: actor.userId } }),
    ).toBe(0);
  });

  it('revokes 410 subscriptions, recovers expired leases, and enforces ownership', async () => {
    const actor = await session('revoked');
    const other = await session('revoked-other');
    const endpoint = 'https://push.example.test/revoked';
    await subscribe(actor, endpoint).expect(201);
    await subscribe(other, endpoint).expect(409);
    const notification = await prisma.notification.create({
      data: {
        userId: actor.userId,
        type: 'deadline_risk',
        title: 'Deadline soon',
        body: 'Review the deadline.',
        deepLink: '/backlog',
        dedupeKey: 'lease-recovery',
        scheduledAt: clock.now(),
        deliveryStatus: 'sending',
        leaseOwner: 'dead-worker',
        leaseExpiresAt: new Date(clock.now().getTime() - 1_000),
      },
    });
    push.respondOnce({ kind: 'revoked', code: '410' });
    await expect(worker.runOnce()).resolves.toBe(true);
    expect(
      await prisma.pushSubscription.findFirst({
        where: { userId: actor.userId },
      }),
    ).toMatchObject({ revokedAt: expect.any(Date) });
    expect(
      await prisma.notification.findUnique({ where: { id: notification.id } }),
    ).toMatchObject({
      deliveryStatus: 'failed',
      lastErrorCode: '410',
    });
  });

  it('keeps notification read state user-scoped and invalidates future schedules on preference change', async () => {
    const actor = await session('read-state');
    const other = await session('read-state-other');
    const notification = await prisma.notification.create({
      data: {
        userId: actor.userId,
        type: 'morning_plan',
        title: 'Plan tomorrow',
        body: 'Future reminder',
        deepLink: '/today',
        dedupeKey: 'future-reminder',
        scheduledAt: new Date(clock.now().getTime() + 3_600_000),
      },
    });
    await request(app.getHttpServer())
      .post(`/notifications/${notification.id}/read`)
      .set('Cookie', other.cookie)
      .set('Origin', origin)
      .expect(404);
    await request(app.getHttpServer())
      .patch('/users/me/preferences')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ timezone: 'Europe/Moscow' })
      .expect(200);
    expect(
      await prisma.notification.findUnique({ where: { id: notification.id } }),
    ).toBeNull();
  });

  it('counts safe distraction provenance and compares actual focus with estimates', async () => {
    const actor = await session('review-feedback');
    const task = await createTask(actor, {
      title: 'Estimated work',
      estimateMinutes: 10,
    });
    const started = await request(app.getHttpServer())
      .post('/focus/start')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ taskId: task.id })
      .expect(201);
    clock.advanceMinutes(15);
    await request(app.getHttpServer())
      .post(`/focus/${started.body.id as string}/distractions`)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ title: 'Reply to message later' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/focus/${started.body.id as string}/complete`)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ outcome: 'Work completed' })
      .expect(201);
    const review = await request(app.getHttpServer())
      .post('/reviews/daily/2026-07-20/generate')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({})
      .expect(201);
    expect(review.body).toMatchObject({
      focusedMinutes: 15,
      estimatedFocusMinutes: 10,
      estimateVarianceMinutes: 5,
      interruptionCount: 1,
    });
    const event = await prisma.taskEvent.findFirst({
      where: { userId: actor.userId, type: 'created' },
      orderBy: { createdAt: 'desc' },
    });
    expect(event?.metadata).toMatchObject({ source: 'focus_distraction' });
  });
});
