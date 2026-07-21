import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { AppConfig } from '../src/config/app-config.service';
import { PrismaService } from '../src/database/prisma.service';
import { hashOpaqueToken } from '../src/modules/auth/auth.service';
import { type Clock, CLOCK } from '../src/modules/auth/clock';
import { DataRetentionService } from '../src/modules/privacy/data-retention.service';

const origin = 'http://localhost:5173';

class FakeClock implements Clock {
  private current = new Date('2026-07-21T12:00:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  reset(): void {
    this.current = new Date('2026-07-21T12:00:00.000Z');
  }

  daysBefore(days: number): Date {
    return new Date(this.current.getTime() - days * 24 * 60 * 60 * 1_000);
  }
}

interface TestSession {
  cookie: string;
  rawToken: string;
  userId: string;
  email: string;
}

describe('security and privacy release controls', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let retention: DataRetentionService;
  const clock = new FakeClock();

  beforeAll(async () => {
    const config = new AppConfig({
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      REQUEST_BODY_LIMIT_KB: '8',
      API_RATE_LIMIT_PER_MINUTE: '1000',
      AUTH_RATE_LIMIT_PER_MINUTE: '3',
      ASSISTANT_RATE_LIMIT_PER_MINUTE: '2',
      RETENTION_SWEEP_INTERVAL_MS: '86400000',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfig)
      .useValue(config)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    retention = app.get(DataRetentionService);
  });

  beforeEach(async () => {
    clock.reset();
    await prisma.user.deleteMany();
  });

  afterAll(async () => app.close());

  async function createSession(label: string): Promise<TestSession> {
    const rawToken = `security-session-${label}`;
    const email = `${label}@example.test`;
    const now = clock.now();
    const user = await prisma.user.create({
      data: {
        email,
        timezone: 'UTC',
        preferences: { create: {} },
        identities: {
          create: {
            provider: 'google',
            providerSubject: `security-${label}`,
            emailAtLink: email,
          },
        },
        sessions: {
          create: {
            tokenHash: hashOpaqueToken(rawToken),
            createdAt: now,
            lastUsedAt: now,
            expiresAt: new Date(now.getTime() + 86_400_000),
          },
        },
      },
    });
    return {
      cookie: `execution_session=${rawToken}`,
      rawToken,
      userId: user.id,
      email,
    };
  }

  it('sets security headers, strict CORS, and removes framework disclosure', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('Origin', origin)
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe(origin);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects oversized and malformed bodies without reflecting their content', async () => {
    const actor = await createSession('body-limit');
    const canary = 'PRIVATE-CANARY-DO-NOT-REFLECT';
    const oversized = await request(app.getHttpServer())
      .post('/inbox/capture')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ title: 'Bounded request', description: canary.repeat(400) })
      .expect(413);
    expect(oversized.body).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'The request body exceeds the configured size limit.',
    });
    expect(JSON.stringify(oversized.body)).not.toContain(canary);

    const malformed = await request(app.getHttpServer())
      .post('/inbox/capture')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .set('Content-Type', 'application/json')
      .send(`{"title":"${canary}`)
      .expect(400);
    expect(malformed.body).toEqual({
      code: 'INVALID_REQUEST',
      message: 'The request could not be parsed.',
    });
    expect(JSON.stringify(malformed.body)).not.toContain(canary);
  });

  it('rate-limits authentication by socket IP and ignores spoofed forwarding headers', async () => {
    for (let index = 0; index < 3; index += 1) {
      await request(app.getHttpServer())
        .get('/auth/google')
        .set('X-Forwarded-For', `198.51.100.${index + 1}`)
        .expect(302);
    }
    const blocked = await request(app.getHttpServer())
      .get('/auth/google')
      .set('X-Forwarded-For', '203.0.113.200')
      .expect(429);
    expect(blocked.body).toMatchObject({
      code: 'AUTH_RATE_LIMITED',
      message: 'Too many authentication attempts. Try again shortly.',
    });
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rate-limits assistant creation per authenticated user', async () => {
    const actor = await createSession('assistant-rate');
    for (let index = 0; index < 2; index += 1) {
      await request(app.getHttpServer())
        .post('/assistant/suggestions')
        .set('Cookie', actor.cookie)
        .set('Origin', origin)
        .send({
          type: 'task_extraction',
          sourceText: `Extract task ${index}`,
          idempotencyKey: `security-rate-${index}`,
        })
        .expect(201);
    }
    const blocked = await request(app.getHttpServer())
      .post('/assistant/suggestions')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({
        type: 'task_extraction',
        sourceText: 'This request must be limited',
        idempotencyKey: 'security-rate-blocked',
      })
      .expect(429);
    expect(blocked.body).toMatchObject({
      code: 'ASSISTANT_RATE_LIMITED',
      message: 'The assistant request limit was reached. Try again shortly.',
    });
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('requires a fresh session and exact account confirmation', async () => {
    const stale = await createSession('stale-delete');
    await prisma.authSession.updateMany({
      where: { userId: stale.userId },
      data: { createdAt: new Date(clock.now().getTime() - 11 * 60_000) },
    });
    await request(app.getHttpServer())
      .delete('/users/me')
      .set('Cookie', stale.cookie)
      .set('Origin', origin)
      .send({ confirmation: 'DELETE', confirmationEmail: stale.email })
      .expect(403)
      .expect({
        code: 'ACCOUNT_REAUTHENTICATION_REQUIRED',
        message: 'Sign in again before deleting the account.',
      });
    expect(await prisma.user.count({ where: { id: stale.userId } })).toBe(1);

    const mismatch = await createSession('mismatch-delete');
    await request(app.getHttpServer())
      .delete('/users/me')
      .set('Cookie', mismatch.cookie)
      .set('Origin', origin)
      .send({
        confirmation: 'DELETE',
        confirmationEmail: 'someone-else@example.test',
      })
      .expect(400)
      .expect({
        code: 'ACCOUNT_CONFIRMATION_MISMATCH',
        message: 'The confirmation email does not match the signed-in account.',
      });
    expect(await prisma.user.count({ where: { id: mismatch.userId } })).toBe(1);
  });

  it('deletes every user-owned table and clears the session cookie', async () => {
    const actor = await createSession('cascade-delete');
    const project = await prisma.project.create({
      data: {
        userId: actor.userId,
        name: 'Sensitive project',
        normalizedName: 'sensitive project',
      },
    });
    const task = await prisma.task.create({
      data: {
        userId: actor.userId,
        projectId: project.id,
        title: 'Sensitive task',
        description: 'Private task body',
        category: 'work',
        status: 'completed',
        completedAt: clock.now(),
      },
    });
    await prisma.taskEvent.create({
      data: {
        userId: actor.userId,
        taskId: task.id,
        taskVersion: 1,
        type: 'created',
        metadata: {},
      },
    });
    const plan = await prisma.dailyPlan.create({
      data: {
        userId: actor.userId,
        date: new Date('2026-07-21T00:00:00.000Z'),
        workdayStart: new Date('1970-01-01T09:00:00.000Z'),
        workdayEnd: new Date('1970-01-01T17:00:00.000Z'),
        status: 'closed',
        closedAt: clock.now(),
        items: {
          create: {
            taskId: task.id,
            role: 'primary',
            position: 0,
          },
        },
      },
    });
    await prisma.focusSession.create({
      data: {
        userId: actor.userId,
        taskId: task.id,
        status: 'completed',
        startedAt: new Date('2026-07-21T09:00:00.000Z'),
        endedAt: new Date('2026-07-21T10:00:00.000Z'),
        segments: {
          create: {
            sequence: 1,
            type: 'focused',
            startedAt: new Date('2026-07-21T09:00:00.000Z'),
            endedAt: new Date('2026-07-21T10:00:00.000Z'),
          },
        },
      },
    });
    await prisma.dailyReview.create({
      data: {
        userId: actor.userId,
        date: plan.date,
        userReflection: 'Private reflection',
      },
    });
    const conversation = await prisma.conversation.create({
      data: { userId: actor.userId },
    });
    await prisma.conversationMessage.create({
      data: {
        userId: actor.userId,
        conversationId: conversation.id,
        role: 'user',
        content: 'Private assistant message',
      },
    });
    await prisma.aiSuggestion.create({
      data: {
        userId: actor.userId,
        conversationId: conversation.id,
        type: 'task_extraction',
        status: 'completed',
        schemaVersion: '1',
        promptVersion: '1',
        inputContext: { text: 'Private context' },
        inputContextHash: 'a'.repeat(64),
        output: { tasks: [] },
        expiresAt: new Date('2026-08-20T12:00:00.000Z'),
      },
    });
    const trigger = await prisma.assistantTrigger.create({
      data: {
        userId: actor.userId,
        relatedTaskId: task.id,
        type: 'deadline_risk',
        status: 'fired',
        dedupeKey: 'delete-trigger',
        eligibleAt: clock.now(),
      },
    });
    await prisma.notification.create({
      data: {
        userId: actor.userId,
        assistantTriggerId: trigger.id,
        relatedTaskId: task.id,
        type: 'deadline_risk',
        title: 'Private notification',
        body: 'Private body',
        deepLink: `/tasks/${task.id}`,
        dedupeKey: 'delete-notification',
        scheduledAt: clock.now(),
      },
    });
    await prisma.pushSubscription.create({
      data: {
        userId: actor.userId,
        endpoint: 'https://push.example.test/delete',
        endpointFingerprint: 'b'.repeat(64),
        p256dh: 'private-encryption-material',
        authSecret: 'private-auth-material',
      },
    });

    const response = await request(app.getHttpServer())
      .delete('/users/me')
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ confirmation: 'DELETE', confirmationEmail: actor.email })
      .expect(204);
    expect(String(response.headers['set-cookie'])).toContain(
      'execution_session=',
    );

    const counts = await Promise.all([
      prisma.user.count({ where: { id: actor.userId } }),
      prisma.userPreferences.count({ where: { userId: actor.userId } }),
      prisma.authIdentity.count({ where: { userId: actor.userId } }),
      prisma.authSession.count({ where: { userId: actor.userId } }),
      prisma.project.count({ where: { userId: actor.userId } }),
      prisma.task.count({ where: { userId: actor.userId } }),
      prisma.taskEvent.count({ where: { userId: actor.userId } }),
      prisma.dailyPlan.count({ where: { userId: actor.userId } }),
      prisma.dailyPlanItem.count({ where: { dailyPlanId: plan.id } }),
      prisma.focusSession.count({ where: { userId: actor.userId } }),
      prisma.dailyReview.count({ where: { userId: actor.userId } }),
      prisma.conversation.count({ where: { userId: actor.userId } }),
      prisma.conversationMessage.count({ where: { userId: actor.userId } }),
      prisma.aiSuggestion.count({ where: { userId: actor.userId } }),
      prisma.assistantTrigger.count({ where: { userId: actor.userId } }),
      prisma.notification.count({ where: { userId: actor.userId } }),
      prisma.pushSubscription.count({ where: { userId: actor.userId } }),
    ]);
    expect(counts).toEqual(Array.from({ length: 17 }, () => 0));
  });

  it('expires sensitive history while retaining current records', async () => {
    const actor = await createSession('retention');
    await prisma.authSession.updateMany({
      where: { userId: actor.userId },
      data: { expiresAt: clock.daysBefore(1) },
    });
    const conversation = await prisma.conversation.create({
      data: {
        userId: actor.userId,
        createdAt: clock.daysBefore(31),
        updatedAt: clock.daysBefore(31),
      },
    });
    await prisma.conversationMessage.create({
      data: {
        userId: actor.userId,
        conversationId: conversation.id,
        role: 'user',
        content: 'Expired private message',
        createdAt: clock.daysBefore(31),
      },
    });
    const suggestion = await prisma.aiSuggestion.create({
      data: {
        userId: actor.userId,
        type: 'task_extraction',
        status: 'accepted',
        schemaVersion: '1',
        promptVersion: '1',
        inputContext: { sourceText: 'Expired private context' },
        inputContextHash: 'c'.repeat(64),
        output: { tasks: [{ title: 'Expired private output' }] },
        providerRequestId: 'provider-private-request',
        acceptedAt: clock.daysBefore(1),
        expiresAt: clock.daysBefore(1),
      },
    });
    await prisma.notification.createMany({
      data: [
        {
          userId: actor.userId,
          type: 'morning_plan',
          title: 'Expired notification',
          body: 'Expired body',
          deepLink: '/today',
          dedupeKey: 'expired-notification',
          scheduledAt: clock.daysBefore(91),
          createdAt: clock.daysBefore(91),
        },
        {
          userId: actor.userId,
          type: 'morning_plan',
          title: 'Current notification',
          body: 'Current body',
          deepLink: '/today',
          dedupeKey: 'current-notification',
          scheduledAt: clock.now(),
          createdAt: clock.now(),
        },
      ],
    });
    await prisma.pushSubscription.createMany({
      data: [
        {
          userId: actor.userId,
          endpoint: 'https://push.example.test/expired',
          endpointFingerprint: 'd'.repeat(64),
          p256dh: 'expired-key',
          authSecret: 'expired-secret',
          revokedAt: clock.daysBefore(31),
          updatedAt: clock.daysBefore(31),
        },
        {
          userId: actor.userId,
          endpoint: 'https://push.example.test/current',
          endpointFingerprint: 'e'.repeat(64),
          p256dh: 'current-key',
          authSecret: 'current-secret',
          updatedAt: clock.now(),
        },
      ],
    });

    await expect(retention.runOnce()).resolves.toEqual({
      expiredSuggestions: 1,
      deletedConversationMessages: 1,
      deletedConversations: 1,
      deletedSessions: 1,
      deletedNotifications: 1,
      deletedPushSubscriptions: 1,
    });
    await expect(retention.runOnce()).resolves.toEqual({
      expiredSuggestions: 0,
      deletedConversationMessages: 0,
      deletedConversations: 0,
      deletedSessions: 0,
      deletedNotifications: 0,
      deletedPushSubscriptions: 0,
    });

    expect(
      await prisma.aiSuggestion.findUniqueOrThrow({
        where: { id: suggestion.id },
      }),
    ).toMatchObject({
      status: 'expired',
      inputContext: { expired: true },
      output: null,
      providerRequestId: null,
    });
    expect(
      await prisma.notification.count({ where: { userId: actor.userId } }),
    ).toBe(1);
    expect(
      await prisma.pushSubscription.count({ where: { userId: actor.userId } }),
    ).toBe(1);
  });
});
