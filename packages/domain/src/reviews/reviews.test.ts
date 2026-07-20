import { describe, expect, it } from 'vitest';

import {
  localDateBoundsUtc,
  overlapDurationMilliseconds,
  startOfLocalDateUtc,
} from './index.js';

describe('daily review local-day bounds', () => {
  it.each([
    ['UTC', '2026-07-20', '2026-07-20T00:00:00.000Z'],
    ['Europe/Moscow', '2026-07-20', '2026-07-19T21:00:00.000Z'],
    ['America/Los_Angeles', '2026-07-20', '2026-07-20T07:00:00.000Z'],
  ])('resolves %s midnight for %s', (timezone, date, expected) => {
    expect(startOfLocalDateUtc(date, timezone).toISOString()).toBe(expected);
  });

  it.each([
    ['America/New_York', '2026-03-08', 23],
    ['America/New_York', '2026-11-01', 25],
    ['UTC', '2026-07-20', 24],
  ])('supports a %s %s day with %i hours', (timezone, date, hours) => {
    const bounds = localDateBoundsUtc(date, timezone);
    expect(bounds.end.getTime() - bounds.start.getTime()).toBe(
      hours * 60 * 60 * 1_000,
    );
  });
});

describe('daily review segment overlap', () => {
  const at = (iso: string) => new Date(iso);

  it('clips a focus segment across midnight', () => {
    expect(
      overlapDurationMilliseconds(
        at('2026-07-19T23:50:00.000Z'),
        at('2026-07-20T00:20:00.000Z'),
        at('2026-07-20T00:00:00.000Z'),
        at('2026-07-21T00:00:00.000Z'),
      ),
    ).toBe(20 * 60 * 1_000);
  });

  it('returns zero outside the day and rejects reversed bounds', () => {
    expect(
      overlapDurationMilliseconds(
        at('2026-07-19T22:00:00.000Z'),
        at('2026-07-19T23:00:00.000Z'),
        at('2026-07-20T00:00:00.000Z'),
        at('2026-07-21T00:00:00.000Z'),
      ),
    ).toBe(0);
    expect(() =>
      overlapDurationMilliseconds(
        at('2026-07-20T01:00:00.000Z'),
        at('2026-07-20T00:00:00.000Z'),
        at('2026-07-20T00:00:00.000Z'),
        at('2026-07-21T00:00:00.000Z'),
      ),
    ).toThrow(RangeError);
  });
});
