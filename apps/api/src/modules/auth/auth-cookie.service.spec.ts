import type { Response } from 'express';

import { AppConfig } from '../../config/app-config.service';
import { AuthCookieService } from './auth-cookie.service';

function config(nodeEnvironment: 'test' | 'production'): AppConfig {
  return new AppConfig({
    NODE_ENV: nodeEnvironment,
    DATABASE_URL: 'postgresql://user:password@localhost:5432/app_test',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
    AUTH_ALLOWED_CALLBACK_URLS: 'http://localhost:3000/auth/google/callback',
    WEB_APP_URL: 'http://localhost:5173',
    WEB_ORIGINS: 'http://localhost:5173',
  });
}

describe('AuthCookieService', () => {
  it('uses HttpOnly, same-site, path-scoped cookies', () => {
    const service = new AuthCookieService(config('production'));
    const options = service.sessionCookieOptions(
      new Date('2030-01-01T00:00:00Z'),
    );

    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
    });
  });

  it('rejects a mismatched OAuth state', () => {
    const service = new AuthCookieService(config('test'));
    const request = {
      headers: { cookie: 'oauth_state=expected; oauth_nonce=nonce' },
    };

    expect(() =>
      service.readAndValidateOAuthCookies(
        request as Parameters<
          AuthCookieService['readAndValidateOAuthCookies']
        >[0],
        'different',
      ),
    ).toThrow('OAuth state validation failed.');
  });

  it('never exposes raw cookie values through its options API', () => {
    const response = { cookie: jest.fn() } as unknown as Response;
    const service = new AuthCookieService(config('test'));
    service.setSessionCookie(
      response,
      'raw-token',
      new Date('2030-01-01T00:00:00Z'),
    );

    expect(response.cookie).toHaveBeenCalledWith(
      'execution_session',
      'raw-token',
      expect.objectContaining({ httpOnly: true }),
    );
  });
});
