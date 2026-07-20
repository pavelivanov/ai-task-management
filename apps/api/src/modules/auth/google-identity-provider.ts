import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

import { AppConfig } from '../../config/app-config.service';
import {
  type IdentityProfile,
  type IdentityProvider,
} from './identity-provider';

@Injectable()
export class GoogleIdentityProvider implements IdentityProvider {
  private readonly client: OAuth2Client;

  constructor(@Inject(AppConfig) private readonly config: AppConfig) {
    this.client = new OAuth2Client({
      clientId: config.googleClientId,
      clientSecret: config.googleClientSecret,
      redirectUri: config.googleCallbackUrl,
    });
  }

  createAuthorizationUrl(input: { state: string; nonce: string }): string {
    return this.client.generateAuthUrl({
      access_type: 'online',
      include_granted_scopes: false,
      nonce: input.nonce,
      prompt: 'select_account',
      scope: ['openid', 'email', 'profile'],
      state: input.state,
    });
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    expectedNonce: string;
  }): Promise<IdentityProfile> {
    const { tokens } = await this.client.getToken(input.code);
    if (!tokens.id_token) {
      throw this.invalidIdentity();
    }

    const ticket = await this.client.verifyIdToken({
      audience: this.config.googleClientId,
      idToken: tokens.id_token,
    });
    const payload = ticket.getPayload();

    if (
      !payload?.sub ||
      !payload.email ||
      payload.email_verified !== true ||
      payload.nonce !== input.expectedNonce
    ) {
      throw this.invalidIdentity();
    }

    return {
      subject: payload.sub,
      email: payload.email,
      emailVerified: true,
      displayName: payload.name ?? null,
      avatarUrl: payload.picture ?? null,
    };
  }

  private invalidIdentity(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'INVALID_GOOGLE_IDENTITY',
      message: 'Google identity verification failed.',
    });
  }
}
