import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@execution/contracts';
import type { Request } from 'express';

import { SlidingWindowRateLimiter } from '../../common/security/sliding-window-rate-limiter';
import { AppConfig } from '../../config/app-config.service';

type AuthenticatedRequest = Request & { currentUser?: AuthenticatedUser };

@Injectable()
export class AssistantRequestRateLimitGuard implements CanActivate {
  private readonly limiter = new SlidingWindowRateLimiter();

  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.currentUser) {
      throw new UnauthorizedException({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required.',
      });
    }
    const decision = this.limiter.consume(
      request.currentUser.id,
      this.config.assistantRateLimitPerMinute,
      60_000,
    );
    if (!decision.allowed) {
      throw new HttpException(
        {
          code: 'ASSISTANT_RATE_LIMITED',
          message:
            'The assistant request limit was reached. Try again shortly.',
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
