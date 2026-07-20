export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export interface IdentityProfile {
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface IdentityProvider {
  createAuthorizationUrl(input: { state: string; nonce: string }): string;
  exchangeAuthorizationCode(input: {
    code: string;
    expectedNonce: string;
  }): Promise<IdentityProfile>;
}
