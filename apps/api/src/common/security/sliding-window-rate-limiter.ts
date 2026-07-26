export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly starts = new Map<string, number[]>();

  constructor(private readonly maximumTrackedKeys = 10_000) {}

  consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): RateLimitDecision {
    const cutoff = now - windowMs;
    const recent = (this.starts.get(key) ?? []).filter(
      (startedAt) => startedAt > cutoff,
    );

    if (recent.length >= limit) {
      this.starts.set(key, recent);
      this.prune(cutoff);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((recent[0]! + windowMs - now) / 1_000),
        ),
      };
    }

    recent.push(now);
    this.starts.delete(key);
    this.starts.set(key, recent);
    this.prune(cutoff);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(cutoff: number): void {
    for (const [key, starts] of this.starts) {
      if (starts.at(-1)! <= cutoff) this.starts.delete(key);
    }
    if (this.starts.size <= this.maximumTrackedKeys) return;

    while (this.starts.size > this.maximumTrackedKeys) {
      const oldest = this.starts.keys().next().value as string | undefined;
      if (!oldest) break;
      this.starts.delete(oldest);
    }
  }
}
