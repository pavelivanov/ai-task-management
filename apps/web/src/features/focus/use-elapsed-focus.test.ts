import { describe, expect, it } from 'vitest';

import { elapsedFocusSeconds, formatElapsed } from './use-elapsed-focus';

describe('monotonic focus presentation', () => {
  it('advances an active server snapshot without timer writes', () => {
    expect(
      elapsedFocusSeconds(
        {
          identity: 'session:server-now',
          baseSeconds: 120,
          monotonicMilliseconds: 5_000,
          running: true,
        },
        68_250,
      ),
    ).toBe(183);
  });

  it('holds paused and waiting snapshots still', () => {
    expect(
      elapsedFocusSeconds(
        {
          identity: 'session:paused',
          baseSeconds: 840,
          monotonicMilliseconds: 1_000,
          running: false,
        },
        90_000,
      ),
    ).toBe(840);
  });

  it('resynchronizes from a replacement server anchor after drift', () => {
    const reconnected = {
      identity: 'session:new-server-now',
      baseSeconds: 905,
      monotonicMilliseconds: 100_000,
      running: true,
    };
    expect(elapsedFocusSeconds(reconnected, 102_999)).toBe(907);
    expect(formatElapsed(3_661)).toBe('01:01:01');
  });
});
