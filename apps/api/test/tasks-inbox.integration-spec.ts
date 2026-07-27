import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { PrismaService } from '../src/database/prisma.service';
import { hashOpaqueToken } from '../src/modules/auth/auth.service';
import { type Clock, CLOCK } from '../src/modules/auth/clock';
import { TaskLifecycleService } from '../src/modules/tasks/task-lifecycle.service';

const origin = 'http://localhost:5173';

class FakeClock implements Clock {
  private current = new Date('2026-07-20T09:00:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  reset(): void {
    this.current = new Date('2026-07-20T09:00:00.000Z');
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
  completedAt: string | null;
}

describe('task, project, and inbox boundaries', () => {
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
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createSession(label: string): Promise<TestSession> {
    const token = `session-token-${label}`;
    const now = clock.now();
    const user = await prisma.user.create({
      data: {
        email: `${label}@example.test`,
        preferences: { create: {} },
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

  it('validates project CRUD, pagination, archival, and per-user names', async () => {
    const userA = await createSession('project-a');
    const userB = await createSession('project-b');

    const first = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ name: 'Launch', color: '#112233' })
      .expect(201);
    clock.advanceMinutes();
    const second = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ name: 'Operations' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ name: ' launch ' })
      .expect(409)
      .expect({
        code: 'PROJECT_NAME_CONFLICT',
        message: 'An active or archived project already uses this name.',
      });

    await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', userB.cookie)
      .set('Origin', origin)
      .send({ name: 'Launch' })
      .expect(201);

    const pageOne = await request(app.getHttpServer())
      .get('/projects?limit=1')
      .set('Cookie', userA.cookie)
      .expect(200);
    expect(pageOne.body.items).toHaveLength(1);
    expect(pageOne.body.items[0].id).toBe(second.body.id);
    expect(pageOne.body.nextCursor).toBe(second.body.id);

    const pageTwo = await request(app.getHttpServer())
      .get(`/projects?limit=1&cursor=${String(pageOne.body.nextCursor)}`)
      .set('Cookie', userA.cookie)
      .expect(200);
    expect(pageTwo.body.items[0].id).toBe(first.body.id);
    expect(pageTwo.body.nextCursor).toBeNull();

    await request(app.getHttpServer())
      .patch(`/projects/${String(first.body.id)}`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ name: 'Launch 2026', color: null })
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          name: 'Launch 2026',
          color: null,
        });
      });

    await request(app.getHttpServer())
      .post(`/projects/${String(first.body.id)}/archive`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .expect(201);
    const active = await request(app.getHttpServer())
      .get('/projects')
      .set('Cookie', userA.cookie)
      .expect(200);
    expect(active.body.items).toHaveLength(1);
    const all = await request(app.getHttpServer())
      .get('/projects?includeArchived=true')
      .set('Cookie', userA.cookie)
      .expect(200);
    expect(all.body.items).toHaveLength(2);

    await request(app.getHttpServer())
      .patch(`/projects/${String(first.body.id)}`)
      .set('Cookie', userB.cookie)
      .set('Origin', origin)
      .send({ color: '#ffffff' })
      .expect(404);
  });

  it('creates, filters, paginates, patches, and deletes tasks with exact history', async () => {
    const userA = await createSession('tasks-a');
    const userB = await createSession('tasks-b');
    const projectA = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ name: 'A project' })
      .expect(201);
    const projectB = await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', userB.cookie)
      .set('Origin', origin)
      .send({ name: 'B project' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/tasks')
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ title: 'Wrong project', projectId: projectB.body.id })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('INVALID_TASK_PROJECT');
      });

    const otherParent = await createTask(userB, 'Other parent');
    await request(app.getHttpServer())
      .post('/tasks')
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ title: 'Wrong parent', parentTaskId: otherParent.id })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('INVALID_TASK_PARENT');
      });

    const first = await createTask(userA, 'First', {
      category: 'work',
      projectId: projectA.body.id,
    });
    clock.advanceMinutes();
    const second = await createTask(userA, 'Second', {
      category: 'personal',
    });
    clock.advanceMinutes();
    const third = await createTask(userA, 'Third');

    const pageOne = await request(app.getHttpServer())
      .get('/tasks?limit=2')
      .set('Cookie', userA.cookie)
      .expect(200);
    expect(pageOne.body.items.map((item: { id: string }) => item.id)).toEqual([
      third.id,
      second.id,
    ]);
    const pageTwo = await request(app.getHttpServer())
      .get(`/tasks?limit=2&cursor=${String(pageOne.body.nextCursor)}`)
      .set('Cookie', userA.cookie)
      .expect(200);
    expect(pageTwo.body.items.map((item: { id: string }) => item.id)).toEqual([
      first.id,
    ]);

    const filtered = await request(app.getHttpServer())
      .get(`/tasks?category=work&projectId=${String(projectA.body.id)}`)
      .set('Cookie', userA.cookie)
      .expect(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].id).toBe(first.id);

    await request(app.getHttpServer())
      .get(`/tasks/${first.id}`)
      .set('Cookie', userB.cookie)
      .expect(404)
      .expect({ code: 'TASK_NOT_FOUND', message: 'Task was not found.' });
    await request(app.getHttpServer())
      .patch(`/tasks/${first.id}`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ status: 'completed' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/tasks/${first.id}`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ parentTaskId: first.id })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('INVALID_TASK_PARENT');
      });

    clock.advanceMinutes();
    await request(app.getHttpServer())
      .patch(`/tasks/${first.id}`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ title: 'First revised' })
      .expect(200);
    clock.advanceMinutes();
    await request(app.getHttpServer())
      .patch(`/tasks/${first.id}`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ estimateMinutes: 45 })
      .expect(200);

    const history = await request(app.getHttpServer())
      .get(`/tasks/${first.id}/history`)
      .set('Cookie', userA.cookie)
      .expect(200);
    expect(
      history.body.items.map((event: { type: string }) => event.type),
    ).toEqual(['created', 'updated', 'estimate_changed']);
    expect(history.body.items[1].metadata).toEqual({
      changedFields: ['title'],
    });
    expect(history.body.items[2].metadata).toEqual({
      fromMinutes: null,
      toMinutes: 45,
    });

    await request(app.getHttpServer())
      .patch(`/tasks/${first.id}/history`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ metadata: {} })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/tasks/${first.id}`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .expect(204);
    expect(await prisma.taskEvent.count({ where: { taskId: first.id } })).toBe(
      0,
    );

    const parent = await createTask(userA, 'Parent with child');
    await createTask(userA, 'Child', { parentTaskId: parent.id });
    await request(app.getHttpServer())
      .delete(`/tasks/${parent.id}`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .expect(409)
      .expect({
        code: 'TASK_DELETE_CONFLICT',
        message:
          'A task used by subtasks, plan history, or focus history cannot be deleted.',
      });
  });

  it('keeps lifecycle state and its event atomic under invalid and stale writes', async () => {
    const user = await createSession('lifecycle');
    const invalid = await createTask(user, 'Cannot complete from backlog');

    await request(app.getHttpServer())
      .post(`/tasks/${invalid.id}/complete`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({})
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('TASK_TRANSITION_UNSUPPORTED');
      });
    expect(
      await prisma.task.findUniqueOrThrow({ where: { id: invalid.id } }),
    ).toMatchObject({ status: 'backlog', completedAt: null, version: 1 });
    expect(
      await prisma.taskEvent.findMany({
        where: { taskId: invalid.id },
        select: { type: true },
      }),
    ).toEqual([{ type: 'created' }]);

    const completable = await createTask(user, 'Completable');
    await lifecycle.transition({
      taskId: completable.id,
      userId: user.userId,
      to: 'planned',
    });
    clock.advanceMinutes(5);
    const completed = await request(app.getHttpServer())
      .post(`/tasks/${completable.id}/complete`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ reason: 'Done' })
      .expect(201);
    expect(completed.body).toMatchObject({
      status: 'completed',
      completedAt: clock.now().toISOString(),
      version: 3,
    });
    expect(
      (
        await prisma.taskEvent.findMany({
          where: { taskId: completable.id },
          orderBy: { taskVersion: 'asc' },
          select: { type: true },
        })
      ).map((event) => event.type),
    ).toEqual(['created', 'scheduled', 'completed']);

    const stale = await createTask(user, 'Stale transition');
    await lifecycle.transition({
      taskId: stale.id,
      userId: user.userId,
      to: 'archived',
      expectedVersion: 1,
    });
    await expect(
      lifecycle.transition({
        taskId: stale.id,
        userId: user.userId,
        to: 'cancelled',
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      response: { code: 'TASK_VERSION_CONFLICT' },
    });
    expect(await prisma.taskEvent.count({ where: { taskId: stale.id } })).toBe(
      2,
    );

    const concurrent = await createTask(user, 'Concurrent transition');
    const outcomes = await Promise.allSettled([
      lifecycle.transition({
        taskId: concurrent.id,
        userId: user.userId,
        to: 'archived',
      }),
      lifecycle.transition({
        taskId: concurrent.id,
        userId: user.userId,
        to: 'cancelled',
      }),
    ]);
    expect(
      outcomes.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      await prisma.taskEvent.count({ where: { taskId: concurrent.id } }),
    ).toBe(2);
  });

  it('serializes parent changes so concurrent updates cannot form a cycle', async () => {
    const user = await createSession('hierarchy-race');
    const first = await createTask(user, 'First hierarchy node');
    const second = await createTask(user, 'Second hierarchy node');

    const responses = await Promise.all([
      request(app.getHttpServer())
        .patch(`/tasks/${first.id}`)
        .set('Cookie', user.cookie)
        .set('Origin', origin)
        .send({ parentTaskId: second.id }),
      request(app.getHttpServer())
        .patch(`/tasks/${second.id}`)
        .set('Cookie', user.cookie)
        .set('Origin', origin)
        .send({ parentTaskId: first.id }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 400,
    ]);
    expect(
      responses.find((response) => response.status === 400)?.body,
    ).toMatchObject({ code: 'INVALID_TASK_PARENT' });
    const tasks = await prisma.task.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { id: true, parentTaskId: true },
    });
    expect(tasks.filter((task) => task.parentTaskId !== null)).toHaveLength(1);
  });

  it('captures inbox items oldest first and processes every supported action', async () => {
    const userA = await createSession('inbox-a');
    const userB = await createSession('inbox-b');
    const accepted = await capture(userA, 'Accept me');
    clock.advanceMinutes();
    const archived = await capture(userA, 'Archive me');
    clock.advanceMinutes();
    const cancelled = await capture(userA, 'Cancel me');
    clock.advanceMinutes();
    const deleted = await capture(userA, 'Delete me');
    await capture(userB, 'Other user item');

    const inbox = await request(app.getHttpServer())
      .get('/inbox?limit=10')
      .set('Cookie', userA.cookie)
      .expect(200);
    expect(inbox.body.items.map((item: { id: string }) => item.id)).toEqual([
      accepted.id,
      archived.id,
      cancelled.id,
      deleted.id,
    ]);

    const accept = () =>
      request(app.getHttpServer())
        .post(`/inbox/${accepted.id}/process`)
        .set('Cookie', userA.cookie)
        .set('Origin', origin)
        .send({ action: 'accept' })
        .expect(201);
    await accept();
    await accept();
    expect(
      await prisma.taskEvent.count({ where: { taskId: accepted.id } }),
    ).toBe(2);

    await request(app.getHttpServer())
      .post(`/inbox/${archived.id}/process`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ action: 'archive' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/inbox/${cancelled.id}/process`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ action: 'cancel', reason: 'No longer needed' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/inbox/${deleted.id}/process`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ action: 'delete' })
      .expect(201)
      .expect({ deleted: true });
    expect(
      await prisma.task.findUnique({ where: { id: deleted.id } }),
    ).toBeNull();

    await request(app.getHttpServer())
      .post(`/inbox/${accepted.id}/process`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ action: 'archive' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('INVALID_INBOX_ACTION');
      });
    await request(app.getHttpServer())
      .post(`/inbox/${archived.id}/process`)
      .set('Cookie', userA.cookie)
      .set('Origin', origin)
      .send({ action: 'decompose' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/inbox/${archived.id}/process`)
      .set('Cookie', userB.cookie)
      .set('Origin', origin)
      .send({ action: 'archive' })
      .expect(404);

    const empty = await request(app.getHttpServer())
      .get('/inbox')
      .set('Cookie', userA.cookie);
    expect({
      status: empty.status,
      location: empty.headers.location ?? null,
      body: empty.body,
    }).toEqual({ status: 200, location: null, body: expect.any(Object) });
    expect(empty.body.items).toEqual([]);
  });

  it('requires authentication and same-origin mutation requests', async () => {
    await request(app.getHttpServer())
      .post('/inbox/capture')
      .set('Origin', origin)
      .send({ title: 'No session' })
      .expect(401);

    const user = await createSession('csrf');
    await request(app.getHttpServer())
      .post('/tasks')
      .set('Cookie', user.cookie)
      .send({ title: 'No origin' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/projects')
      .set('Cookie', user.cookie)
      .set('Origin', 'https://attacker.example')
      .send({ name: 'Unsafe' })
      .expect(403);
  });
});
