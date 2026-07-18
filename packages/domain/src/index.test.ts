import { describe, expect, it } from 'vitest';

import { normalizeMinutes } from './index.js';

describe('normalizeMinutes', () => {
  it('rounds finite values and prevents negative durations', () => {
    expect(normalizeMinutes(12.6)).toBe(13);
    expect(normalizeMinutes(-4)).toBe(0);
  });
});
