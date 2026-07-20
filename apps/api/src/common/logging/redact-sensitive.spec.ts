import { redactSensitive } from './redact-sensitive';

describe('redactSensitive', () => {
  it('redacts nested cookies and OAuth tokens without changing safe values', () => {
    expect(
      redactSensitive({
        headers: { cookie: 'raw-session', accept: 'application/json' },
        tokens: { access_token: 'raw-oauth-token' },
      }),
    ).toEqual({
      headers: { cookie: '[REDACTED]', accept: 'application/json' },
      tokens: { access_token: '[REDACTED]' },
    });
  });
});
