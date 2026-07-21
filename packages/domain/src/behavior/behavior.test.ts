import { describe, expect, it } from 'vitest';

import {
  evaluateProtectedStart,
  isInsideProtectedHours,
  scheduleAfterProtectedHours,
  selectWaitingCandidates,
  triggerDedupeKey,
  zonedLocalDateTimeToInstant,
} from './index.js';

const hours = {
  now: new Date('2026-07-20T10:30:00.000Z'),
  timeZone: 'UTC',
  enabled: true,
  start: '10:00',
  end: '12:00',
};

describe('protected work hours', () => {
  it.each([
    ['inside', new Date('2026-07-20T10:00:00.000Z'), true],
    ['last minute', new Date('2026-07-20T11:59:00.000Z'), true],
    ['at end', new Date('2026-07-20T12:00:00.000Z'), false],
    ['outside', new Date('2026-07-20T09:59:00.000Z'), false],
  ])('%s resolves deterministically', (_label, now, expected) => {
    expect(isInsideProtectedHours({ ...hours, now })).toBe(expected);
  });

  it('warns for personal work but allows work, urgent, and planned admin', () => {
    expect(
      evaluateProtectedStart(hours, {
        category: 'personal',
        priority: 'normal',
        plannedPersonalAdmin: false,
      }).confirmationRequired,
    ).toBe(true);
    for (const task of [
      {
        category: 'work' as const,
        priority: 'normal' as const,
        plannedPersonalAdmin: false,
      },
      {
        category: 'personal' as const,
        priority: 'critical' as const,
        plannedPersonalAdmin: false,
      },
      {
        category: 'personal' as const,
        priority: 'normal' as const,
        plannedPersonalAdmin: true,
      },
    ]) {
      expect(evaluateProtectedStart(hours, task).confirmationRequired).toBe(
        false,
      );
    }
  });

  it('rejects overnight protected windows', () => {
    expect(() =>
      isInsideProtectedHours({ ...hours, start: '22:00', end: '06:00' }),
    ).toThrow(RangeError);
  });

  it.each([
    ['America/New_York', '2026-03-08', '03:30', '2026-03-08T07:30:00.000Z'],
    ['America/New_York', '2026-11-01', '03:30', '2026-11-01T08:30:00.000Z'],
    ['Europe/Moscow', '2026-07-20', '12:00', '2026-07-20T09:00:00.000Z'],
  ])('resolves %s %s across DST', (timeZone, date, time, expected) => {
    expect(
      zonedLocalDateTimeToInstant(date, time, timeZone).toISOString(),
    ).toBe(expected);
  });

  it('returns the protected end in the user timezone', () => {
    expect(scheduleAfterProtectedHours(hours).toISOString()).toBe(
      '2026-07-20T12:00:00.000Z',
    );
  });
});

describe('waiting suggestions', () => {
  const createdAt = new Date('2026-07-20T08:00:00.000Z');
  const task = (
    id: string,
    overrides: Partial<
      Parameters<typeof selectWaitingCandidates>[0][number]
    > = {},
  ) => ({
    id,
    category: 'work' as const,
    status: 'backlog',
    priority: 'normal' as const,
    estimateMinutes: 10,
    dueAt: null,
    createdAt,
    optionalPlanItem: false,
    ...overrides,
  });

  it('returns at most three fitting tasks in stable priority/due order', () => {
    const selected = selectWaitingCandidates(
      [
        task('d'),
        task('c', { priority: 'high' }),
        task('b', { dueAt: new Date('2026-07-21T00:00:00.000Z') }),
        task('a', { dueAt: new Date('2026-07-20T12:00:00.000Z') }),
      ],
      15,
      false,
    );
    expect(selected.map(({ id }) => id)).toEqual(['c', 'a', 'b']);
  });

  it('orders otherwise-equal candidates by the shortest estimate', () => {
    const selected = selectWaitingCandidates(
      [
        task('ten', { estimateMinutes: 10 }),
        task('five', { estimateMinutes: 5 }),
      ],
      15,
      false,
    );
    expect(selected.map(({ id }) => id)).toEqual(['five', 'ten']);
  });

  it('filters personal, oversized, blocked, and non-optional planned tasks', () => {
    const selected = selectWaitingCandidates(
      [
        task('work'),
        task('personal', { category: 'personal' }),
        task('large', { estimateMinutes: 60 }),
        task('blocked', { status: 'blocked' }),
        task('planned', { status: 'planned' }),
        task('optional', { status: 'planned', optionalPlanItem: true }),
      ],
      15,
      true,
    );
    expect(selected.map(({ id }) => id)).toEqual(['optional', 'work']);
  });

  it('builds stable trigger keys', () => {
    expect(triggerDedupeKey('morning', 'user', '2026-07-20')).toBe(
      'morning:user:2026-07-20',
    );
  });
});
