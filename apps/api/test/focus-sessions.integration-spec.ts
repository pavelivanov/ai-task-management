import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { PrismaService } from '../src/database/prisma.service';
import { hashOpaqueToken } from '../src/modules/auth/auth.service';
import { type Clock, CLOCK } from '../src/modules/auth/clock';
import {
  type FocusActivationHook,
  FOCUS_ACTIVATION_HOOK,
} from '../src/modules/focus/focus-activation.hook';
import { InvalidationStreamService } from '../src/modules/invalidations/invalidation-stream.service';

const origin = 'http://localhost:5173';

class FakeClock implements Clock {
  private current = new Date('2026-07-20T09:00:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  reset(iso = '2026-07-20T09:00:00.000Z'): void {
    this.current = new Date(iso);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60 * 1_000);
  }
}

class ActivationBarrier implements FocusActivationHook {
  private target = 0;
  private arrived = 0;
  private release: (() => void) | null = null;
  private gate: Promise<void> | null = null;

  arm(target = 2): void {
    this.target = target;
    this.arrived = 0;
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  reset(): void {
    this.release?.();
    this.target = 0;
    this.arrived = 0;
    this.release = null;
    this.gate = null;
  }

  async beforeActivate(): Promise<void> {
    const gate = this.gate;
    if (!gate) return;
    this.arrived += 1;
    if (this.arrived === this.target) {
      this.release?.();
      this.gate = null;
      this.release = null;
    }
    await gate;
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

interface FocusResponse {
  id: string;
  taskId: string;
  status: string;
  version: number;
  focusedDurationSeconds: number;
  activeSegmentStartedAt: string | null;
  serverNow: string;
  outcome: string | null;
  segments: Array<{
    id: string;
    sequence: number;
    type: string;
    startedAt: string;
    endedAt: string | null;
  }>;
  task: TaskResponse;
}

interface PlanResponse {
  id: string;
  version: number;
  status: string;
  items: Array<{
    id: string;
    taskId: string;
    completedDuringDay: boolean;
  }>;
}

interface StreamEvent {
  id: string;
  type: string;
  occurredAt: string;
  resourceId: string;
  resourceVersion: number;
}

function openEventStream(port: number, cookie: string) {
  let connectedResolve!: () => void;
  let connectedReject!: (error: Error) => void;
  let heartbeatResolve!: () => void;
  let eventResolve!: (event: StreamEvent) => void;
  const connected = new Promise<void>((resolve, reject) => {
    connectedResolve = resolve;
    connectedReject = reject;
  });
  const heartbeat = new Promise<void>((resolve) => {
    heartbeatResolve = resolve;
  });
  const event = new Promise<StreamEvent>((resolve) => {
    eventResolve = resolve;
  });

  const client = httpRequest({
    host: '127.0.0.1',
    port,
    path: '/events',
    headers: { Accept: 'text/event-stream', Cookie: cookie },
  });
  client.on('response', (response) => {
    response.setEncoding('utf8');
    let buffer = '';
    response.on('data', (chunk: string) => {
      buffer += chunk;
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block === ': connected') connectedResolve();
        if (block === ': heartbeat') heartbeatResolve();
        if (block.includes('event: focus.changed')) {
          const data = block
            .split('\n')
            .find((line) => line.startsWith('data: '));
          if (data) eventResolve(JSON.parse(data.slice(6)) as StreamEvent);
        }
        boundary = buffer.indexOf('\n\n');
      }
    });
  });
  client.on('error', (error) => {
    if (!client.destroyed) connectedReject(error);
  });
  client.end();

  return { client, connected, heartbeat, event };
}

describe('focus session, time tracking, and invalidation boundaries', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let invalidations: InvalidationStreamService;
  const clock = new FakeClock();
  const activationBarrier = new ActivationBarrier();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(FOCUS_ACTIVATION_HOOK)
      .useValue(activationBarrier)
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    invalidations = app.get(InvalidationStreamService);
  });

  beforeEach(async () => {
    clock.reset();
    activationBarrier.reset();
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_focus_event_trigger ON task_events',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS test_fail_focus_event()',
    );
    await prisma.user.deleteMany();
    expect(invalidations.activeSubscriberCount()).toBe(0);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_fail_focus_event_trigger ON task_events',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS test_fail_focus_event()',
    );
    await app.close();
  });

  async function createSession(label: string): Promise<TestSession> {
    const token = `focus-session-${label}`;
    const now = clock.now();
    const user = await prisma.user.create({
      data: {
        email: `${label}@example.test`,
        timezone: 'UTC',
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

  async function createTask(
    session: TestSession,
    title: string,
  ): Promise<TaskResponse> {
    const response = await request(app.getHttpServer())
      .post('/tasks')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({ title })
      .expect(201);
    return response.body as TaskResponse;
  }

  async function captureTask(
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

  async function createPlanWithTask(
    session: TestSession,
    taskId: string,
  ): Promise<PlanResponse> {
    const created = await request(app.getHttpServer())
      .post('/daily-plans/today')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({})
      .expect(201);
    const response = await request(app.getHttpServer())
      .post('/daily-plans/today/items')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({ taskId, expectedPlanVersion: created.body.version })
      .expect(201);
    return response.body as PlanResponse;
  }

  async function startFocus(
    session: TestSession,
    taskId: string,
    extra: Record<string, unknown> = {},
  ): Promise<FocusResponse> {
    const response = await request(app.getHttpServer())
      .post('/focus/start')
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send({ taskId, ...extra })
      .expect(201);
    return response.body as FocusResponse;
  }

  async function focusCommand(
    session: TestSession,
    focusId: string,
    command: string,
    body: Record<string, unknown> = {},
  ): Promise<FocusResponse> {
    const response = await request(app.getHttpServer())
      .post(`/focus/${focusId}/${command}`)
      .set('Cookie', session.cookie)
      .set('Origin', origin)
      .send(body)
      .expect(201);
    return response.body as FocusResponse;
  }

  it('enforces one active session per user with the PostgreSQL partial index', async () => {
    const user = await createSession('database-race');
    const otherUser = await createSession('database-other');
    const first = await createTask(user, 'Database first');
    const second = await createTask(user, 'Database second');
    const otherTask = await createTask(otherUser, 'Database other');
    const data = (taskId: string, userId = user.userId) => ({
      userId,
      taskId,
      status: 'active' as const,
      startedAt: clock.now(),
    });

    const raced = await Promise.allSettled([
      prisma.focusSession.create({ data: data(first.id) }),
      prisma.focusSession.create({ data: data(second.id) }),
    ]);
    expect(
      raced.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = raced.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'P2002' } });
    await expect(
      prisma.focusSession.create({
        data: data(otherTask.id, otherUser.userId),
      }),
    ).resolves.toMatchObject({ status: 'active' });
    expect(
      await prisma.focusSession.count({ where: { status: 'active' } }),
    ).toBe(2);
  });

  it('tracks the full lifecycle through exact segments, task events, and plan completion', async () => {
    const user = await createSession('lifecycle');
    const task = await createTask(user, 'Lifecycle task');
    const planBeforeFocus = await createPlanWithTask(user, task.id);
    let focus = await startFocus(user, task.id, {
      initialIntent: 'Finish the invariant',
    });
    expect(focus).toMatchObject({
      status: 'active',
      version: 1,
      focusedDurationSeconds: 0,
      activeSegmentStartedAt: '2026-07-20T09:00:00.000Z',
      task: { status: 'in_progress' },
    });

    const startRetry = await startFocus(user, task.id);
    expect(startRetry).toMatchObject({ id: focus.id, version: 1 });
    expect(await prisma.focusSession.count()).toBe(1);
    expect(
      await prisma.taskEvent.count({
        where: { taskId: task.id, type: 'started' },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .post(`/tasks/${task.id}/complete`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({})
      .expect(409)
      .expect((response) => {
        expect(response.body).toMatchObject({
          code: 'ACTIVE_FOCUS_SESSION_EXISTS',
          currentSession: { id: focus.id, taskId: task.id },
        });
      });

    clock.advanceMinutes(2);
    const current = await request(app.getHttpServer())
      .get('/focus/current')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(current.body).toMatchObject({
      id: focus.id,
      focusedDurationSeconds: 120,
      serverNow: '2026-07-20T09:02:00.000Z',
    });
    focus = await focusCommand(user, focus.id, 'pause', {
      reason: 'Coffee',
    });
    expect(focus).toMatchObject({
      status: 'paused',
      version: 2,
      task: { status: 'backlog' },
    });
    const pausedRetry = await focusCommand(user, focus.id, 'pause', {
      reason: 'Ignored retry',
    });
    expect(pausedRetry.version).toBe(2);

    clock.advanceMinutes(1);
    focus = await focusCommand(user, focus.id, 'resume');
    clock.advanceMinutes(3);
    focus = await focusCommand(user, focus.id, 'wait', {
      reason: 'Build running',
    });
    expect(focus.task.status).toBe('waiting');
    clock.advanceMinutes(2);
    focus = await focusCommand(user, focus.id, 'resume');
    clock.advanceMinutes(4);
    focus = await focusCommand(user, focus.id, 'block', {
      reason: 'Needs a decision',
    });
    expect(focus.task.status).toBe('blocked');
    expect(focus.segments.at(-1)).toMatchObject({
      type: 'focused',
      endedAt: '2026-07-20T09:12:00.000Z',
    });
    clock.advanceMinutes(1);
    focus = await focusCommand(user, focus.id, 'resume');
    clock.advanceMinutes(5);
    focus = await focusCommand(user, focus.id, 'complete', {
      outcome: 'Invariant shipped',
    });
    expect(focus).toMatchObject({
      status: 'completed',
      version: 8,
      outcome: 'Invariant shipped',
      focusedDurationSeconds: 840,
      activeSegmentStartedAt: null,
      task: { status: 'completed' },
    });
    expect(focus.segments.map((segment) => segment.type)).toEqual([
      'focused',
      'paused',
      'focused',
      'waiting',
      'focused',
      'focused',
    ]);
    expect(focus.segments.every((segment) => segment.endedAt !== null)).toBe(
      true,
    );

    const planAfterFocus = await request(app.getHttpServer())
      .get('/daily-plans/today')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(planAfterFocus.body).toMatchObject({
      id: planBeforeFocus.id,
      version: planBeforeFocus.version + 1,
      items: [{ taskId: task.id, completedDuringDay: true }],
    });
    expect(
      (
        await prisma.taskEvent.findMany({
          where: { taskId: task.id },
          orderBy: { taskVersion: 'asc' },
          select: { type: true, metadata: true },
        })
      ).map((event) => event.type),
    ).toEqual([
      'created',
      'scheduled',
      'started',
      'paused',
      'resumed',
      'waiting',
      'resumed',
      'blocked',
      'resumed',
      'completed',
    ]);
    const focusEvents = await prisma.taskEvent.findMany({
      where: {
        taskId: task.id,
        type: {
          in: [
            'started',
            'paused',
            'resumed',
            'waiting',
            'blocked',
            'completed',
          ],
        },
      },
      select: { metadata: true },
    });
    expect(
      focusEvents.every(
        (event) =>
          typeof event.metadata === 'object' &&
          event.metadata !== null &&
          !Array.isArray(event.metadata) &&
          event.metadata.focusSessionId === focus.id,
      ),
    ).toBe(true);

    const completeRetry = await focusCommand(user, focus.id, 'complete', {
      outcome: 'Ignored retry',
    });
    expect(completeRetry).toMatchObject({
      version: 8,
      outcome: 'Invariant shipped',
    });
    await request(app.getHttpServer())
      .delete(`/tasks/${task.id}`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('TASK_DELETE_CONFLICT');
      });
    await request(app.getHttpServer())
      .post(`/focus/${focus.id}/resume`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({})
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('FOCUS_TRANSITION_UNSUPPORTED');
      });

    const other = await createSession('lifecycle-other');
    await request(app.getHttpServer())
      .post(`/focus/${focus.id}/pause`)
      .set('Cookie', other.cookie)
      .set('Origin', origin)
      .send({})
      .expect(404);
  });

  it('rejects inbox starts and stops unfinished work idempotently', async () => {
    const user = await createSession('stop');
    const inbox = await captureTask(user, 'Inbox task');
    await request(app.getHttpServer())
      .post('/focus/start')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ taskId: inbox.id })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('FOCUS_TASK_INBOX');
      });

    const backlog = await createTask(user, 'Stopped backlog');
    let focus = await startFocus(user, backlog.id);
    focus = await focusCommand(user, focus.id, 'stop');
    expect(focus).toMatchObject({
      status: 'stopped',
      task: { status: 'backlog' },
    });
    const retry = await focusCommand(user, focus.id, 'stop');
    expect(retry.version).toBe(focus.version);

    const blocked = await createTask(user, 'Stopped blocked');
    focus = await startFocus(user, blocked.id);
    focus = await focusCommand(user, focus.id, 'stop', {
      taskStatus: 'blocked',
      reason: 'Explicit blocker',
    });
    expect(focus).toMatchObject({
      status: 'stopped',
      interruptionReason: 'Explicit blocker',
      task: { status: 'blocked' },
    });
  });

  it('rejects active daily close and accepts paused, waiting, and blocked sessions', async () => {
    const activeUser = await createSession('close-active');
    const activeTask = await createTask(activeUser, 'Active close');
    let activePlan = await createPlanWithTask(activeUser, activeTask.id);
    const activeFocus = await startFocus(activeUser, activeTask.id);
    await request(app.getHttpServer())
      .post('/daily-plans/today/close')
      .set('Cookie', activeUser.cookie)
      .set('Origin', origin)
      .send({ expectedPlanVersion: activePlan.version })
      .expect(409)
      .expect((response) => {
        expect(response.body).toMatchObject({
          code: 'ACTIVE_FOCUS_SESSION_EXISTS',
          currentSession: {
            id: activeFocus.id,
            taskId: activeTask.id,
            status: 'active',
          },
        });
      });
    expect(
      await prisma.dailyPlan.findUniqueOrThrow({
        where: { id: activePlan.id },
      }),
    ).toMatchObject({ status: 'active', closedAt: null });

    await focusCommand(activeUser, activeFocus.id, 'pause');
    activePlan = (
      await request(app.getHttpServer())
        .post('/daily-plans/today/close')
        .set('Cookie', activeUser.cookie)
        .set('Origin', origin)
        .send({ expectedPlanVersion: activePlan.version })
        .expect(201)
    ).body as PlanResponse;
    expect(activePlan.status).toBe('closed');

    for (const status of ['wait', 'block'] as const) {
      const user = await createSession(`close-${status}`);
      const task = await createTask(user, `${status} close`);
      const plan = await createPlanWithTask(user, task.id);
      const focus = await startFocus(user, task.id);
      await focusCommand(user, focus.id, status);
      await request(app.getHttpServer())
        .post('/daily-plans/today/close')
        .set('Cookie', user.cookie)
        .set('Origin', origin)
        .send({ expectedPlanVersion: plan.version })
        .expect(201);
      expect(
        await prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
      ).toMatchObject({ status: 'backlog', carryoverCount: 1 });
      expect(
        await prisma.focusSession.findUniqueOrThrow({
          where: { id: focus.id },
        }),
      ).toMatchObject({ status: status === 'wait' ? 'waiting' : 'blocked' });
    }
  });

  it('rolls back session, segment, task, and event changes on failure', async () => {
    const user = await createSession('rollback');
    const task = await createTask(user, 'Rollback focus');
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION test_fail_focus_event() RETURNS trigger AS $$
      BEGIN
        IF NEW.type = 'started' THEN
          RAISE EXCEPTION 'injected focus event failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER test_fail_focus_event_trigger
      BEFORE INSERT ON task_events
      FOR EACH ROW EXECUTE FUNCTION test_fail_focus_event()
    `);

    await request(app.getHttpServer())
      .post('/focus/start')
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ taskId: task.id })
      .expect(500);
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER test_fail_focus_event_trigger ON task_events',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION test_fail_focus_event()');

    expect(await prisma.focusSession.count()).toBe(0);
    expect(await prisma.focusSessionSegment.count()).toBe(0);
    expect(
      await prisma.task.findUniqueOrThrow({ where: { id: task.id } }),
    ).toMatchObject({ status: 'backlog', version: 1 });
    expect(
      (
        await prisma.taskEvent.findMany({
          where: { taskId: task.id },
          select: { type: true },
        })
      ).map((event) => event.type),
    ).toEqual(['created']);
  });

  it('races two API starts at a barrier and returns the authoritative winner', async () => {
    const user = await createSession('api-race');
    const first = await createTask(user, 'API race first');
    const second = await createTask(user, 'API race second');
    activationBarrier.arm(2);
    const responses = await Promise.all(
      [first, second].map((task) =>
        request(app.getHttpServer())
          .post('/focus/start')
          .set('Cookie', user.cookie)
          .set('Origin', origin)
          .send({ taskId: task.id }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const winner = responses.find((response) => response.status === 201);
    const loser = responses.find((response) => response.status === 409);
    expect(loser?.body).toMatchObject({
      code: 'ACTIVE_FOCUS_SESSION_EXISTS',
      currentSession: { id: winner?.body.id },
    });
    expect(
      await prisma.focusSession.count({
        where: { userId: user.userId, status: 'active' },
      }),
    ).toBe(1);
    expect(await prisma.focusSessionSegment.count()).toBe(1);
    expect(await prisma.taskEvent.count({ where: { type: 'started' } })).toBe(
      1,
    );
  });

  it('streams one minimized invalidation, heartbeat comments, and cleans up on abort', async () => {
    await request(app.getHttpServer()).get('/events').expect(401);
    const user = await createSession('events');
    const task = await createTask(user, 'Event task');
    const address = app.getHttpServer().address() as AddressInfo;
    const stream = openEventStream(address.port, user.cookie);
    await stream.connected;
    expect(invalidations.activeSubscriberCount(user.userId)).toBe(1);

    const focus = await startFocus(user, task.id);
    const event = await stream.event;
    expect(event).toEqual({
      id: expect.any(String),
      type: 'focus.changed',
      occurredAt: '2026-07-20T09:00:00.000Z',
      resourceId: focus.id,
      resourceVersion: focus.version,
    });
    expect(Object.keys(event).sort()).toEqual([
      'id',
      'occurredAt',
      'resourceId',
      'resourceVersion',
      'type',
    ]);
    await stream.heartbeat;

    const current = await request(app.getHttpServer())
      .get('/focus/current')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(current.body).toMatchObject({ id: focus.id, status: 'active' });

    stream.client.destroy();
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (invalidations.activeSubscriberCount(user.userId) === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(invalidations.activeSubscriberCount(user.userId)).toBe(0);
  });
});
