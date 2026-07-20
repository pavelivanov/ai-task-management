import { describe, expect, it } from 'vitest';

import {
  analyzePlan,
  availableWorkMinutes,
  carryoverSignalForCount,
  localDateForInstant,
  orderPlanningItems,
  validateLocalDate,
  type PlanningItem,
} from './index.js';

function item(id: string, override: Partial<PlanningItem> = {}): PlanningItem {
  return {
    id,
    taskId: `task-${id}`,
    role: 'optional',
    position: 0,
    plannedDurationMinutes: null,
    taskEstimateMinutes: null,
    ...override,
  };
}

describe('daily planning capacity', () => {
  it('computes wall-clock availability and exact capacity without a warning', () => {
    expect(availableWorkMinutes('09:00', '17:00')).toBe(480);
    const result = analyzePlan('09:00', '17:00', [
      item('a', { plannedDurationMinutes: 300 }),
      item('b', { taskEstimateMinutes: 180 }),
    ]);
    expect(result.scheduledMinutes).toBe(480);
    expect(result.warnings).toEqual([]);
  });

  it('returns coded role, estimate, and meaningful capacity warnings', () => {
    const result = analyzePlan(
      '09:00',
      '10:00',
      [
        item('a', { role: 'primary', plannedDurationMinutes: 30 }),
        item('b', { role: 'primary', taskEstimateMinutes: 40 }),
        item('c', { role: 'secondary' }),
        item('d', { role: 'secondary', plannedDurationMinutes: 10 }),
        item('e', { role: 'secondary', plannedDurationMinutes: 10 }),
      ],
      { overCapacityPercent: 10 },
    );
    expect(result.scheduledMinutes).toBe(90);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'MULTIPLE_PRIMARY',
      'TOO_MANY_SECONDARY',
      'MISSING_ESTIMATE',
      'OVER_CAPACITY',
    ]);
  });

  it('keeps items stable by position then id', () => {
    expect(
      orderPlanningItems([
        item('c', { position: 1 }),
        item('b', { position: 0 }),
        item('a', { position: 1 }),
      ]).map((entry) => entry.id),
    ).toEqual(['b', 'a', 'c']);
  });

  it.each([
    ['17:00', '09:00'],
    ['09:00', '09:00'],
    ['25:00', '26:00'],
  ])('rejects invalid or overnight workday bounds %s-%s', (start, end) => {
    expect(() => availableWorkMinutes(start, end)).toThrow(RangeError);
  });
});

describe('local dates and carryover thresholds', () => {
  it.each([
    ['UTC', '2026-07-20T00:30:00.000Z', '2026-07-20'],
    ['Europe/Moscow', '2026-07-19T22:30:00.000Z', '2026-07-20'],
    ['America/Los_Angeles', '2026-07-20T02:30:00.000Z', '2026-07-19'],
    ['America/New_York', '2026-03-08T06:30:00.000Z', '2026-03-08'],
    ['America/New_York', '2026-11-01T05:30:00.000Z', '2026-11-01'],
  ])('resolves %s instants to deterministic local dates', (zone, iso, date) => {
    expect(localDateForInstant(new Date(iso), zone)).toBe(date);
  });

  it('validates real Gregorian dates', () => {
    expect(validateLocalDate('2026-02-28')).toBe('2026-02-28');
    expect(() => validateLocalDate('2026-02-30')).toThrow(RangeError);
  });

  it.each([
    [0, null],
    [1, null],
    [2, 'warning'],
    [3, 'diagnosis'],
    [4, 'diagnosis'],
    [5, 'explicit_choice'],
  ] as const)('maps %i carryovers to %s', (count, signal) => {
    expect(carryoverSignalForCount(count)).toBe(signal);
  });

  it('supports configured thresholds and rejects invalid ordering', () => {
    expect(
      carryoverSignalForCount(4, {
        warning: 3,
        diagnosis: 4,
        explicitChoice: 6,
      }),
    ).toBe('diagnosis');
    expect(() =>
      carryoverSignalForCount(2, {
        warning: 3,
        diagnosis: 2,
        explicitChoice: 5,
      }),
    ).toThrow(RangeError);
  });
});
