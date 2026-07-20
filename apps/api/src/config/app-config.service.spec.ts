import { AppConfig } from './app-config.service';

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/app_test',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
  AUTH_ALLOWED_CALLBACK_URLS: 'http://localhost:3000/auth/google/callback',
  WEB_APP_URL: 'http://localhost:5173',
  WEB_ORIGINS: 'http://localhost:5173',
};

describe('AppConfig', () => {
  it('requires the configured callback to be explicitly allowlisted', () => {
    expect(
      () =>
        new AppConfig({
          ...validEnvironment,
          AUTH_ALLOWED_CALLBACK_URLS:
            'https://example.com/auth/google/callback',
        }),
    ).toThrow();
  });

  it('parses cookie and session defaults', () => {
    const config = new AppConfig(validEnvironment);

    expect(config.sessionCookieName).toBe('execution_session');
    expect(config.sessionTtlDays).toBe(30);
    expect(config.isProduction).toBe(false);
  });
});
