import { describe, expect, it } from 'vitest';

import { updateUserPreferencesSchema, userPreferencesSchema } from './index.js';

const validPreferences = {
  timezone: 'Europe/Moscow',
  workdayStart: '09:00',
  workdayEnd: '17:00',
  primaryTaskLimit: 1,
  secondaryTaskLimit: 2,
  capacityWarningPercent: 10,
  protectedHoursEnabled: false,
  protectedHoursStart: null,
  protectedHoursEnd: null,
  notificationsEnabled: false,
  morningPlanningReminder: false,
  endOfDayReminder: false,
  aiInterruptionLevel: 'minimal' as const,
};

describe('user preference contracts', () => {
  it('accepts valid IANA timezones and ordered local times', () => {
    expect(userPreferencesSchema.parse(validPreferences)).toEqual(
      validPreferences,
    );
  });

  it.each([
    [{ timezone: 'UTC+03:00' }],
    [{ workdayStart: '18:00', workdayEnd: '09:00' }],
    [
      {
        protectedHoursEnabled: true,
        protectedHoursStart: null,
        protectedHoursEnd: null,
      },
    ],
  ])('rejects invalid preference ranges: %j', (override) => {
    expect(() =>
      userPreferencesSchema.parse({ ...validPreferences, ...override }),
    ).toThrow();
  });

  it('rejects unknown patch fields', () => {
    expect(() =>
      updateUserPreferencesSchema.parse({
        userId: 'e7e79a9d-82ce-4d50-a0e8-042b681e6ad7',
      }),
    ).toThrow();
  });
});
