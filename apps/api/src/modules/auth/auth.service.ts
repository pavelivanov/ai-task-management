import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@execution/contracts';
import { createHash, randomBytes } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';
import { AppConfig } from '../../config/app-config.service';
import { type Clock, CLOCK } from './clock';
import {
  type IdentityProfile,
  type IdentityProvider,
  IDENTITY_PROVIDER,
} from './identity-provider';

export interface SessionMetadata {
  userAgent: string | null;
}

export interface LoginResult {
  user: AuthenticatedUser;
  sessionToken: string;
  expiresAt: Date;
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toAuthenticatedUser(user: {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  timezone: string;
}): AuthenticatedUser {
  return user;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_PROVIDER)
    private readonly identityProvider: IdentityProvider,
  ) {}

  createAuthorizationUrl(input: { state: string; nonce: string }): string {
    return this.identityProvider.createAuthorizationUrl(input);
  }

  async completeGoogleLogin(input: {
    code: string;
    expectedNonce: string;
    currentSessionToken: string | null;
    metadata: SessionMetadata;
  }): Promise<LoginResult> {
    const profile = await this.identityProvider.exchangeAuthorizationCode({
      code: input.code,
      expectedNonce: input.expectedNonce,
    });
    if (!profile.emailVerified) {
      throw new UnauthorizedException({
        code: 'UNVERIFIED_GOOGLE_EMAIL',
        message: 'A verified Google email is required.',
      });
    }

    return this.createSessionForIdentity(
      profile,
      input.currentSessionToken,
      input.metadata,
    );
  }

  async authenticate(sessionToken: string): Promise<AuthenticatedUser | null> {
    const now = this.clock.now();
    const session = await this.prisma.authSession.findFirst({
      where: {
        tokenHash: hashOpaqueToken(sessionToken),
        revokedAt: null,
        expiresAt: { gt: now },
        user: {
          disabledAt: null,
          deletionRequestedAt: null,
        },
      },
      include: { user: true },
    });
    if (!session) return null;

    if (now.getTime() - session.lastUsedAt.getTime() >= 5 * 60 * 1000) {
      await this.prisma.authSession.update({
        where: { id: session.id },
        data: { lastUsedAt: now },
      });
    }

    return toAuthenticatedUser(session.user);
  }

  async revokeSession(sessionToken: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: {
        tokenHash: hashOpaqueToken(sessionToken),
        revokedAt: null,
      },
      data: { revokedAt: this.clock.now() },
    });
  }

  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.prisma.authSession.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: this.clock.now() } },
          { revokedAt: { not: null } },
        ],
      },
    });
    return result.count;
  }

  private async createSessionForIdentity(
    profile: IdentityProfile,
    currentSessionToken: string | null,
    metadata: SessionMetadata,
  ): Promise<LoginResult> {
    const now = this.clock.now();
    const expiresAt = new Date(
      now.getTime() + this.config.sessionTtlDays * 24 * 60 * 60 * 1000,
    );
    const sessionToken = randomBytes(32).toString('base64url');
    const normalizedEmail = profile.email.trim().toLowerCase();

    const user = await this.prisma.$transaction(async (transaction) => {
      const identity = await transaction.authIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: 'google',
            providerSubject: profile.subject,
          },
        },
      });

      let userId: string;
      if (identity) {
        userId = identity.userId;
        const emailOwner = await transaction.user.findUnique({
          where: { email: normalizedEmail },
        });
        if (emailOwner && emailOwner.id !== userId) {
          throw this.identityLinkRequired();
        }
        await transaction.authIdentity.update({
          where: { id: identity.id },
          data: { emailAtLink: normalizedEmail },
        });
      } else {
        const emailOwner = await transaction.user.findUnique({
          where: { email: normalizedEmail },
        });
        if (emailOwner) {
          throw this.identityLinkRequired();
        }

        const created = await transaction.user.create({
          data: {
            email: normalizedEmail,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
            preferences: { create: {} },
            identities: {
              create: {
                provider: 'google',
                providerSubject: profile.subject,
                emailAtLink: normalizedEmail,
              },
            },
          },
        });
        userId = created.id;
      }

      const updatedUser = await transaction.user.update({
        where: { id: userId },
        data: {
          email: normalizedEmail,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        },
      });

      if (currentSessionToken) {
        await transaction.authSession.updateMany({
          where: {
            tokenHash: hashOpaqueToken(currentSessionToken),
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
      }

      await transaction.authSession.create({
        data: {
          userId,
          tokenHash: hashOpaqueToken(sessionToken),
          expiresAt,
          lastUsedAt: now,
          userAgent: inputLength(metadata.userAgent, 512),
        },
      });

      return updatedUser;
    });

    return {
      user: toAuthenticatedUser(user),
      sessionToken,
      expiresAt,
    };
  }

  private identityLinkRequired(): ConflictException {
    return new ConflictException({
      code: 'IDENTITY_LINK_REQUIRED',
      message: 'This email is already linked to another identity.',
    });
  }
}

function inputLength(value: string | null, maximum: number): string | null {
  return value ? value.slice(0, maximum) : null;
}
