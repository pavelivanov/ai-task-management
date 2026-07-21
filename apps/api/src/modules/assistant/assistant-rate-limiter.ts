import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AppConfig } from '../../config/app-config.service';
import { type Clock, CLOCK } from '../auth/clock';

@Injectable()
export class AssistantRateLimiter {
  private readonly starts = new Map<string, number[]>();
  private readonly active = new Map<string, number>();

  constructor(
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async run<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const now = this.clock.now().getTime();
    const recent = (this.starts.get(userId) ?? []).filter(
      (startedAt) => now - startedAt < 60_000,
    );
    if (recent.length >= this.config.assistantRateLimitPerMinute) {
      throw new HttpException(
        {
          code: 'ASSISTANT_RATE_LIMITED',
          message:
            'The assistant request limit was reached. Try again shortly.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (
      (this.active.get(userId) ?? 0) >=
      this.config.assistantMaxConcurrencyPerUser
    ) {
      throw new HttpException(
        {
          code: 'ASSISTANT_CONCURRENCY_LIMIT',
          message: 'Another assistant request is still running.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.starts.set(userId, recent);
    this.active.set(userId, (this.active.get(userId) ?? 0) + 1);
    try {
      return await operation();
    } finally {
      const next = (this.active.get(userId) ?? 1) - 1;
      if (next === 0) this.active.delete(userId);
      else this.active.set(userId, next);
    }
  }
}
