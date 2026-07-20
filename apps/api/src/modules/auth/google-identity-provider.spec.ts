import { AppConfig } from '../../config/app-config.service';
import { GoogleIdentityProvider } from './google-identity-provider';

describe('GoogleIdentityProvider', () => {
  it('creates an authorization-code URL with identity scopes, state, and nonce', () => {
    const provider = new GoogleIdentityProvider(
      new AppConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:password@localhost:5432/app_test',
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
        AUTH_ALLOWED_CALLBACK_URLS:
          'http://localhost:3000/auth/google/callback',
        WEB_APP_URL: 'http://localhost:5173',
        WEB_ORIGINS: 'http://localhost:5173',
      }),
    );

    const url = new URL(
      provider.createAuthorizationUrl({
        state: 'state-value',
        nonce: 'nonce-value',
      }),
    );
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-value');
    expect(url.searchParams.get('nonce')).toBe('nonce-value');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'openid',
      'email',
      'profile',
    ]);
  });
});
