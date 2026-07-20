import { describe, expect, it } from 'vitest';

import { updateDailyReviewSchema } from './index.js';

describe('daily review contracts', () => {
  it('accepts a bounded reflection or explicit removal', () => {
    expect(
      updateDailyReviewSchema.parse({ userReflection: 'What worked today' }),
    ).toEqual({ userReflection: 'What worked today' });
    expect(updateDailyReviewSchema.parse({ userReflection: null })).toEqual({
      userReflection: null,
    });
  });

  it('rejects empty and unknown reflection input', () => {
    expect(() =>
      updateDailyReviewSchema.parse({ userReflection: ' ' }),
    ).toThrow();
    expect(() => updateDailyReviewSchema.parse({ score: 10 })).toThrow();
  });
});
