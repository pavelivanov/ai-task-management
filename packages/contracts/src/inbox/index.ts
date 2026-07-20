import { z } from 'zod';

import {
  dailyPlanRoleSchema,
  dailyPlanSchema,
  localDateSchema,
} from '../daily-plans/index.js';
import {
  taskSchema,
  taskCategorySchema,
  taskDescriptionSchema,
  taskEstimateMinutesSchema,
  taskPrioritySchema,
  taskTitleSchema,
} from '../tasks/index.js';

export const captureInboxTaskSchema = z
  .object({
    title: taskTitleSchema,
    description: taskDescriptionSchema.optional(),
    category: taskCategorySchema.default('work'),
    priority: taskPrioritySchema.default('normal'),
    estimateMinutes: taskEstimateMinutesSchema.nullable().optional(),
  })
  .strict();

export const listInboxQuerySchema = z
  .object({
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const actionReasonSchema = z.string().trim().min(1).max(1_000).optional();

export const processInboxTaskSchema = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('accept'), reason: actionReasonSchema })
    .strict(),
  z
    .object({ action: z.literal('archive'), reason: actionReasonSchema })
    .strict(),
  z
    .object({ action: z.literal('cancel'), reason: actionReasonSchema })
    .strict(),
  z.object({ action: z.literal('delete') }).strict(),
  z
    .object({
      action: z.literal('schedule'),
      planDate: localDateSchema.optional(),
      role: dailyPlanRoleSchema.default('optional'),
      plannedStart: z.iso.datetime({ offset: true }).nullable().optional(),
      plannedDurationMinutes: z
        .number()
        .int()
        .min(1)
        .max(10_080)
        .nullable()
        .optional(),
      position: z.number().int().min(0).max(1_000).optional(),
    })
    .strict(),
]);

export const processInboxResultSchema = z.union([
  z.object({ deleted: z.literal(true) }),
  dailyPlanSchema,
  taskSchema,
]);

export type CaptureInboxTask = z.output<typeof captureInboxTaskSchema>;
export type ListInboxQuery = z.output<typeof listInboxQuerySchema>;
export type ProcessInboxTask = z.output<typeof processInboxTaskSchema>;
export type ProcessInboxResult = z.infer<typeof processInboxResultSchema>;
