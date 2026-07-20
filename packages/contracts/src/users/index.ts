import { z } from 'zod';

export const aiInterruptionLevelSchema = z.enum([
  'minimal',
  'balanced',
  'proactive',
]);

export const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a local time in HH:mm format.');

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Expected a valid IANA timezone.' },
  );

const preferencesShape = {
  timezone: timeZoneSchema,
  workdayStart: localTimeSchema,
  workdayEnd: localTimeSchema,
  primaryTaskLimit: z.number().int().min(1).max(5),
  secondaryTaskLimit: z.number().int().min(0).max(10),
  capacityWarningPercent: z.number().int().min(0).max(100),
  protectedHoursEnabled: z.boolean(),
  protectedHoursStart: localTimeSchema.nullable(),
  protectedHoursEnd: localTimeSchema.nullable(),
  notificationsEnabled: z.boolean(),
  morningPlanningReminder: z.boolean(),
  endOfDayReminder: z.boolean(),
  aiInterruptionLevel: aiInterruptionLevelSchema,
};

function minutes(value: string): number {
  const [hours, minutesValue] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutesValue ?? 0);
}

function validateRanges(
  value: {
    workdayStart?: string;
    workdayEnd?: string;
    protectedHoursEnabled?: boolean;
    protectedHoursStart?: string | null;
    protectedHoursEnd?: string | null;
  },
  context: z.RefinementCtx,
): void {
  if (
    value.workdayStart !== undefined &&
    value.workdayEnd !== undefined &&
    minutes(value.workdayStart) >= minutes(value.workdayEnd)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Workday start must be before workday end.',
      path: ['workdayEnd'],
    });
  }

  if (value.protectedHoursEnabled) {
    if (!value.protectedHoursStart || !value.protectedHoursEnd) {
      context.addIssue({
        code: 'custom',
        message: 'Protected-hour bounds are required when enabled.',
        path: ['protectedHoursStart'],
      });
    } else if (
      minutes(value.protectedHoursStart) >= minutes(value.protectedHoursEnd)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Protected-hour start must be before protected-hour end.',
        path: ['protectedHoursEnd'],
      });
    }
  }
}

export const userPreferencesSchema = z
  .object(preferencesShape)
  .strict()
  .superRefine(validateRanges);

export const updateUserPreferencesSchema = z
  .object(preferencesShape)
  .partial()
  .strict();

export type AiInterruptionLevel = z.infer<typeof aiInterruptionLevelSchema>;
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;
