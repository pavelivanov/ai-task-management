import { z } from 'zod';

import { localDateSchema } from '../daily-plans/index.js';

export const dailyReviewSchema = z.object({
  id: z.uuid(),
  date: localDateSchema,
  primaryOutcomeCompleted: z.boolean(),
  focusedMinutes: z.number().int().nonnegative(),
  completedPlannedTasks: z.number().int().nonnegative(),
  completedUnplannedTasks: z.number().int().nonnegative(),
  carriedOverTasks: z.number().int().nonnegative(),
  focusSessions: z.number().int().nonnegative(),
  interruptionCount: z.number().int().nonnegative(),
  userReflection: z.string().nullable(),
  assistantSummary: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const dailyReviewDateParamSchema = localDateSchema;

export const updateDailyReviewSchema = z
  .object({
    userReflection: z.string().trim().min(1).max(10_000).nullable(),
  })
  .strict();

export type DailyReview = z.infer<typeof dailyReviewSchema>;
export type UpdateDailyReview = z.output<typeof updateDailyReviewSchema>;
