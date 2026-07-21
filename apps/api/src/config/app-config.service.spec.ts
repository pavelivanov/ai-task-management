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
    expect(config.accountDeletionReauthMinutes).toBe(10);
    expect(config.requestBodyLimitKb).toBe(64);
    expect(config.trustProxyHops).toBe(0);
    expect(config.apiRateLimitPerMinute).toBe(300);
    expect(config.authRateLimitPerMinute).toBe(10);
    expect(config.isProduction).toBe(false);
    expect(config.carryoverWarningCount).toBe(2);
    expect(config.carryoverDiagnosisCount).toBe(3);
    expect(config.carryoverExplicitChoiceCount).toBe(5);
    expect(config.sseHeartbeatSeconds).toBe(15);
    expect(config.sseMaxSubscribersPerUser).toBe(5);
    expect(config.sseMaxSubscribersTotal).toBe(1_000);
    expect(config.e2eAuthEnabled).toBe(false);
    expect(config.notificationRetentionDays).toBe(90);
    expect(config.revokedPushRetentionDays).toBe(30);
    expect(config.retentionSweepIntervalMs).toBe(3_600_000);
  });

  it('requires strictly increasing carryover thresholds', () => {
    expect(
      () =>
        new AppConfig({
          ...validEnvironment,
          CARRYOVER_WARNING_COUNT: '3',
          CARRYOVER_DIAGNOSIS_COUNT: '3',
          CARRYOVER_EXPLICIT_CHOICE_COUNT: '5',
        }),
    ).toThrow();
  });

  it('rejects deterministic test authentication in production', () => {
    expect(
      () =>
        new AppConfig({
          ...validEnvironment,
          NODE_ENV: 'production',
          E2E_AUTH_ENABLED: 'true',
        }),
    ).toThrow();
  });
});
