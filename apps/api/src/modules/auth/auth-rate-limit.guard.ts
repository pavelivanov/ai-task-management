import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { SlidingWindowRateLimiter } from '../../common/security/sliding-window-rate-limiter';
import { AppConfig } from '../../config/app-config.service';

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly limiter = new SlidingWindowRateLimiter();

  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const tracker = request.ip || request.socket.remoteAddress || 'unknown';
    const decision = this.limiter.consume(
      tracker,
      this.config.authRateLimitPerMinute,
      60_000,
    );
    if (!decision.allowed) {
      throw new HttpException(
        {
          code: 'AUTH_RATE_LIMITED',
          message: 'Too many authentication attempts. Try again shortly.',
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
