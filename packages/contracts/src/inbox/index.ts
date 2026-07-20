import { z } from 'zod';

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
]);

export const processInboxResultSchema = z.union([
  z.object({ deleted: z.literal(true) }),
  taskSchema,
]);

export type CaptureInboxTask = z.output<typeof captureInboxTaskSchema>;
export type ListInboxQuery = z.output<typeof listInboxQuerySchema>;
export type ProcessInboxTask = z.output<typeof processInboxTaskSchema>;
export type ProcessInboxResult = z.infer<typeof processInboxResultSchema>;
