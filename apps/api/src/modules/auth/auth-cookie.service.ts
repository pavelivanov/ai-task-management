import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import { AppConfig } from '../../config/app-config.service';

const oauthStateCookie = 'oauth_state';
const oauthNonceCookie = 'oauth_nonce';

function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;

    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }
  }
  return cookies;
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

@Injectable()
export class AuthCookieService {
  constructor(private readonly config: AppConfig) {}

  createOAuthSecrets(): { state: string; nonce: string } {
    return {
      state: randomBytes(32).toString('base64url'),
      nonce: randomBytes(32).toString('base64url'),
    };
  }

  setOAuthCookies(
    response: Response,
    secrets: { state: string; nonce: string },
  ): void {
    const options = this.oauthCookieOptions();
    response.cookie(oauthStateCookie, secrets.state, options);
    response.cookie(oauthNonceCookie, secrets.nonce, options);
  }

  clearOAuthCookies(response: Response): void {
    const options = this.oauthCookieOptions();
    response.clearCookie(oauthStateCookie, options);
    response.clearCookie(oauthNonceCookie, options);
  }

  readAndValidateOAuthCookies(
    request: Request,
    returnedState: string,
  ): { nonce: string } {
    const cookies = parseCookieHeader(request.headers.cookie);
    const expectedState = cookies.get(oauthStateCookie);
    const nonce = cookies.get(oauthNonceCookie);
    if (
      !expectedState ||
      !nonce ||
      !secureEqual(expectedState, returnedState)
    ) {
      throw new UnauthorizedException({
        code: 'OAUTH_STATE_MISMATCH',
        message: 'OAuth state validation failed.',
      });
    }
    return { nonce };
  }

  readSessionToken(request: Request): string | null {
    return (
      parseCookieHeader(request.headers.cookie).get(
        this.config.sessionCookieName,
      ) ?? null
    );
  }

  setSessionCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(this.config.sessionCookieName, token, {
      ...this.baseCookieOptions(),
      expires: expiresAt,
      path: '/',
    });
  }

  clearSessionCookie(response: Response): void {
    response.clearCookie(this.config.sessionCookieName, {
      ...this.baseCookieOptions(),
      path: '/',
    });
  }

  sessionCookieOptions(expiresAt: Date): CookieOptions {
    return {
      ...this.baseCookieOptions(),
      expires: expiresAt,
      path: '/',
    };
  }

  private oauthCookieOptions(): CookieOptions {
    return {
      ...this.baseCookieOptions(),
      maxAge: 10 * 60 * 1000,
      path: '/auth/google/callback',
    };
  }

  private baseCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.isProduction,
    };
  }
}
