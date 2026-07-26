import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { PrismaService } from '../src/database/prisma.service';
import { hashOpaqueToken } from '../src/modules/auth/auth.service';
import { type Clock, CLOCK } from '../src/modules/auth/clock';
import { DAILY_PLAN_CLOSE_GUARD } from '../src/modules/daily-plans/plan-close.guard';
import { TaskLifecycleService } from '../src/modules/tasks/task-lifecycle.service';

const origin = 'http://localhost:5173';

class FakeClock implements Clock {
  private current = new Date('2026-07-20T09:00:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  reset(iso = '2026-07-20T09:00:00.000Z'): void {
    this.current = new Date(iso);
  }

  advanceMinutes(minutes = 1): void {
    this.current = new Date(this.current.getTime() + minutes * 60 * 1000);
  }
}

interface TestSession {
  cookie: string;
  userId: string;
}

interface TaskResponse {
  id: string;
  status: string;
  version: number;
}

interface PlanItemResponse {
  id: string;
  taskId: string;
  position: number;
  completedDuringDay: boolean;
}

interface PlanResponse {
  id: string;
  date: string;
  status: string;
  version: number;
  workdayStart: string;
  workdayEnd: string;
  items: PlanItemResponse[];
  warnings: Array<{ code: string }>;
  carryoverSignals: Array<{
    taskId: string;
    count: number;
    level: string | null;
  }>;
}

function localTime(value: string): Date {
  const [hours, minutes] = value.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, hours ?? 0, minutes ?? 0));
}

describe('daily planning and carryover boundaries', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let lifecycle: TaskLifecycleService;
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
    lifecycle = app.get(TaskLifecycleService);
  });

  beforeEach(async () => {
    clock.reset();
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_carryover_trigger ON task_events',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS test_fail_carryover()',
    );
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_carryover_trigger ON task_events',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS test_fail_carryover()',
    );
    await app.close();
  });

  async function createSession(
    label: string,
    options: {
      timezone?: string;
      workdayStart?: string;
      workdayEnd?: string;
      primaryTaskLimit?: number;
      secondaryTaskLimit?: number;
      capacityWarningPercent?: number;
    } = {},
  ): Promise<TestSession> {
    const token = `daily-plan-session-${label}`;
    const now = clock.now();
    const user = await prisma.user.create({
      data: {
        email: `${label}@example.test`,
        timezone: options.timezone ?? 'UTC',
        preferences: {
          create: {
            ...(options.workdayStart
              ? { workdayStart: localTime(options.workdayStart) }
              : {}),
            ...(options.workdayEnd
              ? { workdayEnd: localTime(options.workdayEnd) }
              : {}),
            ...(options.primaryTaskLimit !== undefined
              ? { primaryTaskLimit: options.primaryTaskLimit }
              : {}),
            ...(options.secondaryTaskLimit !== undefined
              ? { secondaryTaskLimit: options.secondaryTaskLimit }
              : {}),
            ...(options.capacityWarningPercent !== undefined
              ? {
                  capacityWarningPercent: options.capacityWarningPercent,
                }
              : {}),
          },
        },
        sessions: {
          create: {
            tokenHash: hashOpaqueToken(token),
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            lastUsedAt: now,
          },
        },
      },
    });
    return { cookie: `execution_session=${token}`, userId: user.id };
  }

  async function createTask(
    session: TestSession,
    title: string,
    extra: Record<string, unknown> = {},
  ): Promise<TaskResponse> {
    const response = await request(app.getHttpServer())
      .post('/tasks')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({ title, ...extra })
      .expect(201);
    return response.body as TaskResponse;
  }

  async function capture(
    session: TestSession,
    title: string,
  ): Promise<TaskResponse> {
    const response = await request(app.getHttpServer())
      .post('/inbox/capture')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({ title })
      .expect(201);
    return response.body as TaskResponse;
  }

  async function createTodayPlan(session: TestSession): Promise<PlanResponse> {
    const response = await request(app.getHttpServer())
      .post('/daily-plans/today')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({})
      .expect(201);
    return response.body as PlanResponse;
  }

  async function addItem(
    session: TestSession,
    body: Record<string, unknown>,
  ): Promise<PlanResponse> {
    const response = await request(app.getHttpServer())
      .post('/daily-plans/today/items')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send(body)
      .expect(201);
    return response.body as PlanResponse;
  }

  it('selects today by timezone, snapshots work hours, and creates idempotently', async () => {
    clock.reset('2026-07-20T00:30:00.000Z');
    const losAngeles = await createSession('date-la', {
      timezone: 'America/Los_Angeles',
      workdayStart: '08:30',
      workdayEnd: '16:30',
    });
    const moscow = await createSession('date-moscow', {
      timezone: 'Europe/Moscow',
    });

    const laPlan = await createTodayPlan(losAngeles);
    const sameLaPlan = await createTodayPlan(losAngeles);
    const moscowPlan = await createTodayPlan(moscow);
    expect(laPlan).toMatchObject({
      date: '2026-07-19',
      workdayStart: '08:30',
      workdayEnd: '16:30',
      status: 'active',
      version: 1,
    });
    expect(sameLaPlan.id).toBe(laPlan.id);
    expect(sameLaPlan.version).toBe(1);
    expect(moscowPlan.date).toBe('2026-07-20');

    await prisma.userPreferences.update({
      where: { userId: losAngeles.userId },
      data: {
        workdayStart: localTime('09:00'),
        workdayEnd: localTime('17:00'),
      },
    });
    const historicalSnapshot = await request(app.getHttpServer())
      .get('/daily-plans/today')
      .set('Cookie', losAngeles.cookie)
      .expect(200);
    expect(historicalSnapshot.body).toMatchObject({
      workdayStart: '08:30',
      workdayEnd: '16:30',
    });
    expect(await prisma.dailyPlan.count()).toBe(2);

    await expect(
      prisma.dailyPlan.create({
        data: {
          userId: losAngeles.userId,
          date: new Date('2026-07-19T00:00:00.000Z'),
          workdayStart: localTime('09:00'),
          workdayEnd: localTime('17:00'),
          status: 'active',
        },
      }),
    ).rejects.toHaveProperty('code', 'P2002');
  });

  it('returns soft warnings and applies deterministic optimistic item edits', async () => {
    const user = await createSession('mutations', {
      workdayStart: '09:00',
      workdayEnd: '10:00',
      capacityWarningPercent: 10,
    });
    const first = await createTask(user, 'First');
    const second = await createTask(user, 'Second', { estimateMinutes: 40 });
    const third = await createTask(user, 'Third');
    await createTodayPlan(user);

    let plan = await addItem(user, {
      taskId: first.id,
      role: 'primary',
      plannedDurationMinutes: 40,
      expectedPlanVersion: 1,
    });
    plan = await addItem(user, {
      taskId: second.id,
      role: 'primary',
      expectedPlanVersion: plan.version,
    });
    plan = await addItem(user, {
      taskId: third.id,
      role: 'secondary',
      expectedPlanVersion: plan.version,
    });
    expect(plan.warnings.map((warning) => warning.code)).toEqual([
      'MULTIPLE_PRIMARY',
      'MISSING_ESTIMATE',
      'OVER_CAPACITY',
    ]);
    expect(
      await prisma.task.findMany({
        where: { id: { in: [first.id, second.id, third.id] } },
        orderBy: { title: 'asc' },
        select: { status: true },
      }),
    ).toEqual([
      { status: 'planned' },
      { status: 'planned' },
      { status: 'planned' },
    ]);

    const otherUser = await createSession('mutations-other-user');
    const otherPlan = await createTodayPlan(otherUser);
    const otherTask = await createTask(otherUser, 'Other user task');
    await request(app.getHttpServer())
      .post('/daily-plans/today/items')
      .set('Cookie', otherUser.cookie)
      .set('Origin', origin)
      .send({
        taskId: first.id,
        expectedPlanVersion: otherPlan.version,
      })
      .expect(404);
    await request(app.getHttpServer())
      .post('/daily-plans/today/items')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ taskId: otherTask.id, expectedPlanVersion: plan.version })
      .expect(404);

    const thirdItem = plan.items.find((item) => item.taskId === third.id);
    if (!thirdItem) throw new Error('Third plan item missing.');
    const beforeReorderVersion = plan.version;
    const reordered = await request(app.getHttpServer())
      .patch(`/daily-plans/today/items/${thirdItem.id}`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({
        expectedPlanVersion: beforeReorderVersion,
        position: 0,
        plannedDurationMinutes: 10,
      })
      .expect(200);
    plan = reordered.body as PlanResponse;
    expect(plan.items.map((item) => item.taskId)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
    expect(plan.items.map((item) => item.position)).toEqual([0, 1, 2]);

    await request(app.getHttpServer())
      .patch(`/daily-plans/today/items/${thirdItem.id}`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ expectedPlanVersion: beforeReorderVersion, position: 2 })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('DAILY_PLAN_VERSION_CONFLICT');
      });

    await request(app.getHttpServer())
      .post('/daily-plans/today/items')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({
        taskId: first.id,
        plannedStart: '2026-07-21T09:00:00.000Z',
      })
      .expect(201);
    expect(
      await prisma.dailyPlanItem.count({ where: { taskId: first.id } }),
    ).toBe(1);

    const outsidePlanDate = await createTask(user, 'Outside plan date');
    await request(app.getHttpServer())
      .post('/daily-plans/today/items')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({
        taskId: outsidePlanDate.id,
        plannedStart: '2026-07-21T09:00:00.000Z',
        expectedPlanVersion: plan.version,
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('PLANNED_START_OUTSIDE_PLAN_DATE');
      });
    expect(
      await prisma.dailyPlanItem.count({
        where: { taskId: outsidePlanDate.id },
      }),
    ).toBe(0);
    expect(
      await prisma.task.findUniqueOrThrow({
        where: { id: outsidePlanDate.id },
      }),
    ).toMatchObject({ status: 'backlog', version: 1 });

    const firstItem = plan.items.find((item) => item.taskId === first.id);
    if (!firstItem) throw new Error('First plan item missing.');
    const removed = await request(app.getHttpServer())
      .delete(
        `/daily-plans/today/items/${firstItem.id}?expectedPlanVersion=${plan.version}`,
      )
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .expect(200);
    expect(removed.body.items).toHaveLength(2);
    expect(
      await prisma.task.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({ status: 'backlog' });
    expect(
      (
        await prisma.taskEvent.findMany({
          where: { taskId: first.id },
          orderBy: { taskVersion: 'asc' },
          select: { type: true },
        })
      ).map((event) => event.type),
    ).toEqual(['created', 'scheduled', 'unscheduled']);

    await request(app.getHttpServer())
      .delete(`/tasks/${second.id}`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('TASK_DELETE_CONFLICT');
      });
  });

  it('closes atomically, preserves history, carries mixed active states, and retries idempotently', async () => {
    const user = await createSession('close');
    const completed = await createTask(user, 'Completed');
    const planned = await createTask(user, 'Planned');
    const inProgress = await createTask(user, 'In progress');
    const waiting = await createTask(user, 'Waiting');
    const blocked = await createTask(user, 'Blocked');
    const cancelled = await createTask(user, 'Cancelled');
    let plan = await createTodayPlan(user);
    for (const task of [
      completed,
      planned,
      inProgress,
      waiting,
      blocked,
      cancelled,
    ]) {
      plan = await addItem(user, {
        taskId: task.id,
        expectedPlanVersion: plan.version,
      });
    }

    await lifecycle.transition({
      taskId: completed.id,
      userId: user.userId,
      to: 'completed',
    });
    await lifecycle.transition({
      taskId: inProgress.id,
      userId: user.userId,
      to: 'in_progress',
    });
    await lifecycle.transition({
      taskId: waiting.id,
      userId: user.userId,
      to: 'in_progress',
    });
    await lifecycle.transition({
      taskId: waiting.id,
      userId: user.userId,
      to: 'waiting',
    });
    await lifecycle.transition({
      taskId: blocked.id,
      userId: user.userId,
      to: 'in_progress',
    });
    await lifecycle.transition({
      taskId: blocked.id,
      userId: user.userId,
      to: 'blocked',
    });
    await lifecycle.transition({
      taskId: cancelled.id,
      userId: user.userId,
      to: 'cancelled',
    });
    await prisma.task.update({
      where: { id: planned.id },
      data: { carryoverCount: 1 },
    });

    expect(app.get(DAILY_PLAN_CLOSE_GUARD)).toBeDefined();
    const closedResponse = await request(app.getHttpServer())
      .post('/daily-plans/today/close')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ expectedPlanVersion: plan.version })
      .expect(201);
    const closed = closedResponse.body as PlanResponse;
    expect(closed.status).toBe('closed');
    expect(closed.items).toHaveLength(6);
    expect(
      closed.items.find((item) => item.taskId === completed.id)
        ?.completedDuringDay,
    ).toBe(true);
    expect(closed.carryoverSignals).toHaveLength(4);
    expect(
      closed.carryoverSignals.find((signal) => signal.taskId === planned.id),
    ).toEqual({ taskId: planned.id, count: 2, level: 'warning' });
    expect(
      await prisma.task.findMany({
        where: {
          id: { in: [planned.id, inProgress.id, waiting.id, blocked.id] },
        },
        select: { status: true, carryoverCount: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { status: 'backlog', carryoverCount: 2 },
        { status: 'backlog', carryoverCount: 1 },
        { status: 'backlog', carryoverCount: 1 },
        { status: 'backlog', carryoverCount: 1 },
      ]),
    );
    expect(
      await prisma.task.findUniqueOrThrow({ where: { id: cancelled.id } }),
    ).toMatchObject({ status: 'cancelled', carryoverCount: 0 });
    expect(await prisma.dailyPlan.count()).toBe(1);

    const carriedEvents = await prisma.taskEvent.findMany({
      where: { type: 'carried_over' },
      orderBy: { taskId: 'asc' },
      select: { taskId: true, metadata: true },
    });
    expect(carriedEvents).toHaveLength(4);
    expect(carriedEvents.map((event) => event.taskId)).toEqual(
      [planned.id, inProgress.id, waiting.id, blocked.id].sort(),
    );
    for (const event of carriedEvents) {
      expect(event.metadata).toMatchObject({
        dailyPlanId: plan.id,
        sourcePlanDate: '2026-07-20',
        carryoverCount: event.taskId === planned.id ? 2 : 1,
      });
    }
    expect(
      await prisma.dailyPlan.findUnique({
        where: {
          userId_date: {
            userId: user.userId,
            date: new Date('2026-07-21T00:00:00.000Z'),
          },
        },
      }),
    ).toBeNull();
    const carriedEventCount = carriedEvents.length;
    const retry = await request(app.getHttpServer())
      .post('/daily-plans/today/close')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ expectedPlanVersion: 1 })
      .expect(201);
    expect(retry.body).toMatchObject({
      id: closed.id,
      status: 'closed',
      carryoverSignals: closed.carryoverSignals,
    });
    expect(
      await prisma.taskEvent.count({ where: { type: 'carried_over' } }),
    ).toBe(carriedEventCount);

    await request(app.getHttpServer())
      .post('/daily-plans/today/items')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ taskId: completed.id })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('DAILY_PLAN_CLOSED');
      });
  });

  it('rolls back task, event, and plan changes when carryover event creation fails', async () => {
    const user = await createSession('rollback');
    const task = await createTask(user, 'Rollback task');
    let plan = await createTodayPlan(user);
    plan = await addItem(user, {
      taskId: task.id,
      expectedPlanVersion: plan.version,
    });

    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_carryover() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'carried_over' THEN
          RAISE EXCEPTION 'injected carryover failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_carryover_trigger
      BEFORE INSERT ON task_events
      FOR EACH ROW EXECUTE FUNCTION test_fail_carryover()
    `);
    await request(app.getHttpServer())
      .post('/daily-plans/today/close')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ expectedPlanVersion: plan.version })
      .expect(500);
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER test_fail_carryover_trigger ON task_events',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION test_fail_carryover()');

    expect(
      await prisma.dailyPlan.findUniqueOrThrow({ where: { id: plan.id } }),
    ).toMatchObject({
      status: 'active',
      closedAt: null,
      version: plan.version,
    });
    expect(
      await prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
    ).toMatchObject({ status: 'planned', carryoverCount: 0 });
    expect(
      await prisma.taskEvent.count({
        where: { taskId: task.id, type: 'carried_over' },
      }),
    ).toBe(0);
  });

  it('schedules inbox tasks into today and future drafts without duplicates', async () => {
    const user = await createSession('inbox-schedule');
    const futureTask = await capture(user, 'Future inbox task');
    const futureSchedule = () =>
      request(app.getHttpServer())
        .post(`/inbox/${futureTask.id}/process`)
        .set('Cookie', user.cookie)
        .set('Origin', origin)
        .send({
          action: 'schedule',
          planDate: '2026-07-22',
          role: 'primary',
          plannedDurationMinutes: 30,
        })
        .expect(201);
    const scheduled = await futureSchedule();
    expect(scheduled.body).toMatchObject({
      date: '2026-07-22',
      status: 'draft',
    });
    expect(scheduled.body.items).toHaveLength(1);
    await futureSchedule();
    expect(
      await prisma.dailyPlanItem.count({ where: { taskId: futureTask.id } }),
    ).toBe(1);
    expect(
      await prisma.taskEvent.count({
        where: { taskId: futureTask.id, type: 'scheduled' },
      }),
    ).toBe(1);

    let today = await createTodayPlan(user);
    today = await addItem(user, {
      taskId: futureTask.id,
      expectedPlanVersion: today.version,
    });
    const todayItem = today.items.find((item) => item.taskId === futureTask.id);
    if (!todayItem) throw new Error('Today item missing.');
    await request(app.getHttpServer())
      .delete(
        `/daily-plans/today/items/${todayItem.id}?expectedPlanVersion=${today.version}`,
      )
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .expect(200);
    expect(
      await prisma.task.findUniqueOrThrow({ where: { id: futureTask.id } }),
    ).toMatchObject({ status: 'planned' });

    const todayTask = await capture(user, 'Today inbox task');
    const todayScheduled = await request(app.getHttpServer())
      .post(`/inbox/${todayTask.id}/process`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ action: 'schedule', role: 'secondary' })
      .expect(201);
    expect(todayScheduled.body).toMatchObject({
      date: '2026-07-20',
      status: 'active',
    });

    const closedPlan = await prisma.dailyPlan.create({
      data: {
        userId: user.userId,
        date: new Date('2026-07-23T00:00:00.000Z'),
        workdayStart: localTime('09:00'),
        workdayEnd: localTime('17:00'),
        status: 'closed',
        closedAt: clock.now(),
      },
    });
    const closedTask = await capture(user, 'Closed-plan task');
    await request(app.getHttpServer())
      .post(`/inbox/${closedTask.id}/process`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ action: 'schedule', planDate: '2026-07-23' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('DAILY_PLAN_CLOSED');
      });
    expect(
      await prisma.dailyPlanItem.count({
        where: { dailyPlanId: closedPlan.id },
      }),
    ).toBe(0);
  });
});
