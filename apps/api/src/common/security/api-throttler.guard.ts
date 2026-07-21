import {
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new HttpException(
      {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Try again shortly.',
        retryAfterSeconds: Math.max(1, Math.ceil(detail.timeToExpire / 1_000)),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
