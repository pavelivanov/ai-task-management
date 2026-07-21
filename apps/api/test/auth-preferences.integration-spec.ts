import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request, { type Response as SupertestResponse } from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/application';
import { PrismaService } from '../src/database/prisma.service';
import { hashOpaqueToken } from '../src/modules/auth/auth.service';
import { type Clock, CLOCK } from '../src/modules/auth/clock';
import {
  type IdentityProfile,
  type IdentityProvider,
  IDENTITY_PROVIDER,
} from '../src/modules/auth/identity-provider';
import { SessionCleanupScheduler } from '../src/modules/auth/session-cleanup.scheduler';

class FakeClock implements Clock {
  private current = new Date('2026-07-20T09:00:00.000Z');

  now(): Date {
    return new Date(this.current);
  }

  reset(): void {
    this.current = new Date('2026-07-20T09:00:00.000Z');
  }

  advanceDays(days: number): void {
    this.current = new Date(
      this.current.getTime() + days * 24 * 60 * 60 * 1000,
    );
  }
}

class FakeIdentityProvider implements IdentityProvider {
  readonly profiles = new Map<string, IdentityProfile>();
  lastNonce: string | null = null;

  createAuthorizationUrl(input: { state: string; nonce: string }): string {
    const url = new URL('https://accounts.example.test/authorize');
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    return url.toString();
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    expectedNonce: string;
  }): Promise<IdentityProfile> {
    this.lastNonce = input.expectedNonce;
    const profile = this.profiles.get(input.code);
    if (!profile) throw new Error('Unknown fake authorization code.');
    return profile;
  }
}

interface LoginSession {
  cookie: string;
  rawToken: string;
  userId: string;
}

function setCookies(response: SupertestResponse): string[] {
  return (
    (response.headers['set-cookie'] as unknown as string[] | undefined) ?? []
  );
}

function cookieHeader(cookies: string[]): string {
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function cookieValue(cookies: string[], name: string): string {
  const prefix = `${name}=`;
  const cookie = cookies.find((value) => value.startsWith(prefix));
  if (!cookie) throw new Error(`Cookie ${name} was not set.`);
  return cookie.slice(prefix.length).split(';')[0] ?? '';
}

describe('authentication and user preference boundaries', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let sessionCleanup: SessionCleanupScheduler;
  const clock = new FakeClock();
  const identityProvider = new FakeIdentityProvider();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(IDENTITY_PROVIDER)
      .useValue(identityProvider)
      .compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    sessionCleanup = app.get(SessionCleanupScheduler);
  });

  beforeEach(async () => {
    clock.reset();
    identityProvider.profiles.clear();
    identityProvider.lastNonce = null;
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  async function startLogin(): Promise<{
    cookies: string[];
    state: string;
    nonce: string;
  }> {
    const response = await request(app.getHttpServer())
      .get('/auth/google')
      .expect(302);
    const location = new URL(response.headers.location as string);
    return {
      cookies: setCookies(response),
      state: location.searchParams.get('state') ?? '',
      nonce: location.searchParams.get('nonce') ?? '',
    };
  }

  async function login(
    code: string,
    profile: IdentityProfile,
    currentCookie?: string,
  ): Promise<LoginSession> {
    identityProvider.profiles.set(code, profile);
    const started = await startLogin();
    const response = await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ code, state: started.state })
      .set(
        'Cookie',
        [cookieHeader(started.cookies), currentCookie]
          .filter(Boolean)
          .join('; '),
      )
      .set('User-Agent', 'integration-test-agent')
      .expect(303);

    const cookies = setCookies(response);
    const rawToken = cookieValue(cookies, 'execution_session');
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `execution_session=${rawToken}`)
      .expect(200);

    expect(identityProvider.lastNonce).toBe(started.nonce);
    return {
      cookie: `execution_session=${rawToken}`,
      rawToken,
      userId: me.body.id as string,
    };
  }

  const profileA: IdentityProfile = {
    subject: 'google-subject-a',
    email: 'User.A@Example.com',
    emailVerified: true,
    displayName: 'User A',
    avatarUrl: 'https://example.com/a.png',
  };

  const profileB: IdentityProfile = {
    subject: 'google-subject-b',
    email: 'user.b@example.com',
    emailVerified: true,
    displayName: 'User B',
    avatarUrl: null,
  };

  it('validates OAuth state before creating any identity', async () => {
    const started = await startLogin();

    await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ code: 'unused', state: 'x'.repeat(43) })
      .set('Cookie', cookieHeader(started.cookies))
      .expect(401)
      .expect({
        code: 'OAUTH_STATE_MISMATCH',
        message: 'OAuth state validation failed.',
      });

    expect(await prisma.user.count()).toBe(0);
  });

  it('creates a hashed opaque session and secure cookie contract', async () => {
    const session = await login('code-a', profileA);
    const stored = await prisma.authSession.findUniqueOrThrow({
      where: { tokenHash: hashOpaqueToken(session.rawToken) },
    });

    expect(stored.tokenHash).not.toBe(session.rawToken);
    expect(stored.userAgent).toBe('integration-test-agent');
    expect(
      await prisma.user.findUnique({ where: { id: session.userId } }),
    ).toMatchObject({
      email: 'user.a@example.com',
    });

    const started = await startLogin();
    identityProvider.profiles.set('cookie-check', profileA);
    const response = await request(app.getHttpServer())
      .get('/auth/google/callback')
      .query({ code: 'cookie-check', state: started.state })
      .set('Cookie', cookieHeader(started.cookies))
      .expect(303);
    const sessionCookie = setCookies(response).find((cookie) =>
      cookie.startsWith('execution_session='),
    );
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain('Path=/');
  });

  it('upserts a repeated Google subject and rotates the current session', async () => {
    const first = await login('repeat-code-1', profileA);
    const second = await login('repeat-code-2', profileA, first.cookie);

    expect(second.userId).toBe(first.userId);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.authIdentity.count()).toBe(1);
    expect(await prisma.authSession.count()).toBe(2);
    expect(await prisma.authSession.count({ where: { revokedAt: null } })).toBe(
      1,
    );
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', first.cookie)
      .expect(401);
  });

  it('rejects expired and revoked sessions and cleans them idempotently', async () => {
    const expired = await login('expires', profileA);
    clock.advanceDays(31);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', expired.cookie)
      .expect(401);

    expect(await sessionCleanup.run()).toBe(1);
    expect(await sessionCleanup.run()).toBe(0);

    clock.reset();
    const revoked = await login('revoked', profileA);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', revoked.cookie)
      .expect(204);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', revoked.cookie)
      .expect(401);
  });

  it('enforces authenticated, same-origin preference mutations', async () => {
    await request(app.getHttpServer())
      .patch('/users/me/preferences')
      .set('Origin', 'http://localhost:5173')
      .send({ timezone: 'UTC' })
      .expect(401);

    const session = await login('preferences', profileA);
    await request(app.getHttpServer())
      .patch('/users/me/preferences')
      .set('Cookie', session.cookie)
      .send({ timezone: 'UTC' })
      .expect(403)
      .expect({
        code: 'CSRF_ORIGIN_REJECTED',
        message: 'The request origin is not allowed.',
      });

    await request(app.getHttpServer())
      .patch('/users/me/preferences')
      .set('Cookie', session.cookie)
      .set('Origin', 'https://attacker.example')
      .send({ timezone: 'UTC' })
      .expect(403);
  });

  it('validates and persists only the authenticated user preferences', async () => {
    const userA = await login('preferences-a', profileA);
    const userB = await login('preferences-b', profileB);

    const response = await request(app.getHttpServer())
      .patch('/users/me/preferences')
      .set('Cookie', userA.cookie)
      .set('Origin', 'http://localhost:5173')
      .send({
        timezone: 'Europe/Moscow',
        workdayStart: '08:30',
        workdayEnd: '16:30',
        notificationsEnabled: true,
        aiInterruptionLevel: 'balanced',
      })
      .expect(200);
    expect(response.body).toMatchObject({
      timezone: 'Europe/Moscow',
      workdayStart: '08:30',
      workdayEnd: '16:30',
      notificationsEnabled: true,
      aiInterruptionLevel: 'balanced',
    });

    await request(app.getHttpServer())
      .patch('/users/me/preferences')
      .set('Cookie', userA.cookie)
      .set('Origin', 'http://localhost:5173')
      .send({ userId: userB.userId, timezone: 'UTC' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/users/me/preferences')
      .set('Cookie', userA.cookie)
      .set('Origin', 'http://localhost:5173')
      .send({ timezone: 'UTC+03:00' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/users/me/preferences')
      .set('Cookie', userA.cookie)
      .set('Origin', 'http://localhost:5173')
      .send({ workdayStart: '18:00', workdayEnd: '09:00' })
      .expect(400);

    const userBPreferences = await request(app.getHttpServer())
      .get('/users/me/preferences')
      .set('Cookie', userB.cookie)
      .expect(200);
    expect(userBPreferences.body).toMatchObject({
      timezone: 'UTC',
      workdayStart: '09:00',
      notificationsEnabled: false,
    });
  });

  it('enforces identity and session uniqueness in PostgreSQL', async () => {
    const session = await login('unique', profileA);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
    });

    await expect(
      prisma.authIdentity.create({
        data: {
          userId: user.id,
          provider: 'google',
          providerSubject: profileA.subject,
          emailAtLink: user.email,
        },
      }),
    ).rejects.toHaveProperty('code', 'P2002');
    await expect(
      prisma.authSession.create({
        data: {
          userId: user.id,
          tokenHash: hashOpaqueToken(session.rawToken),
          expiresAt: new Date('2030-01-01T00:00:00Z'),
        },
      }),
    ).rejects.toHaveProperty('code', 'P2002');
  });
});
