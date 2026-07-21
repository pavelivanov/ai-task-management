import { SlidingWindowRateLimiter } from './sliding-window-rate-limiter';

describe('SlidingWindowRateLimiter', () => {
  it('blocks at the configured limit and admits after the window', () => {
    const limiter = new SlidingWindowRateLimiter();

    expect(limiter.consume('actor', 2, 60_000, 1_000).allowed).toBe(true);
    expect(limiter.consume('actor', 2, 60_000, 2_000).allowed).toBe(true);
    expect(limiter.consume('actor', 2, 60_000, 3_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 58,
    });
    expect(limiter.consume('actor', 2, 60_000, 61_001).allowed).toBe(true);
  });

  it('does not share limits between actors', () => {
    const limiter = new SlidingWindowRateLimiter();

    limiter.consume('first', 1, 60_000, 1_000);
    expect(limiter.consume('first', 1, 60_000, 2_000).allowed).toBe(false);
    expect(limiter.consume('second', 1, 60_000, 2_000).allowed).toBe(true);
  });
});
