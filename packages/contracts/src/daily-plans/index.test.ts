import { describe, expect, it } from 'vitest';

import {
  addDailyPlanItemSchema,
  createTodayPlanSchema,
  localDateSchema,
  resolveCarryoverSchema,
  updateDailyPlanItemSchema,
} from './index.js';

describe('daily plan contracts', () => {
  it('defaults a new today plan to active', () => {
    expect(createTodayPlanSchema.parse({})).toEqual({ status: 'active' });
  });

  it.each(['2026-07-20', '2024-02-29'])('accepts local date %s', (date) => {
    expect(localDateSchema.parse(date)).toBe(date);
  });

  it.each(['2026-02-30', '20-07-2026', 'not-a-date'])(
    'rejects invalid local date %s',
    (date) => {
      expect(() => localDateSchema.parse(date)).toThrow();
    },
  );

  it('bounds planned durations and positions', () => {
    expect(
      addDailyPlanItemSchema.parse({
        taskId: '85b6d95c-1533-45ca-abda-36746c26cb1c',
      }),
    ).toMatchObject({ role: 'optional' });
    expect(() =>
      addDailyPlanItemSchema.parse({
        taskId: '85b6d95c-1533-45ca-abda-36746c26cb1c',
        plannedDurationMinutes: 0,
      }),
    ).toThrow();
  });

  it('requires optimistic version and a real item mutation', () => {
    expect(() =>
      updateDailyPlanItemSchema.parse({ expectedPlanVersion: 1 }),
    ).toThrow();
    expect(
      updateDailyPlanItemSchema.parse({
        expectedPlanVersion: 1,
        position: 0,
      }),
    ).toEqual({ expectedPlanVersion: 1, position: 0 });
  });

  it('validates explicit carryover resolutions', () => {
    expect(
      resolveCarryoverSchema.parse({
        action: 'break_down',
        expectedPlanVersion: 7,
        subtasks: ['Define the first step', 'Complete the first step'],
      }),
    ).toMatchObject({ action: 'break_down', expectedPlanVersion: 7 });
    expect(() =>
      resolveCarryoverSchema.parse({
        action: 'break_down',
        expectedPlanVersion: 7,
        subtasks: ['Only one step'],
      }),
    ).toThrow();
    expect(() =>
      resolveCarryoverSchema.parse({
        action: 'break_down',
        expectedPlanVersion: 7,
        subtasks: ['Same step', 'same step'],
      }),
    ).toThrow();
    expect(() =>
      resolveCarryoverSchema.parse({
        action: 'postpone',
        expectedPlanVersion: 7,
        dueAt: '2026-07-30',
      }),
    ).toThrow();
  });
});
