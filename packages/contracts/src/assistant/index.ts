import { z } from 'zod';

import { dailyPlanRoleSchema, localDateSchema } from '../daily-plans/index.js';
import {
  taskCategorySchema,
  taskEstimateMinutesSchema,
  taskTitleSchema,
} from '../tasks/index.js';

export const assistantSuggestionTypeSchema = z.enum([
  'task_extraction',
  'daily_plan',
  'task_decomposition',
  'carryover_diagnosis',
  'outcome_summary',
]);

export const assistantSuggestionStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'accepted',
  'rejected',
  'expired',
]);

export const blockReasonSchema = z.enum([
  'unclear_next_step',
  'too_large',
  'missing_information',
  'fear_of_error',
  'low_value',
  'boring',
  'external_dependency',
  'other',
]);

export const assistantTaskReferenceSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
  })
  .strict();

const proposedTaskSchema = z
  .object({
    title: taskTitleSchema,
    category: taskCategorySchema,
    estimateMinutes: taskEstimateMinutesSchema.nullable(),
  })
  .strict();

export const taskExtractionOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    tasks: z.array(proposedTaskSchema).min(1).max(10),
  })
  .strict();

export const dailyPlanSuggestionOutputSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    date: localDateSchema,
    items: z
      .array(
        z
          .object({
            taskId: z.uuid(),
            taskVersion: z.number().int().positive(),
            role: dailyPlanRoleSchema,
            plannedDurationMinutes: taskEstimateMinutesSchema.nullable(),
          })
          .strict(),
      )
      .max(12),
    warnings: z
      .array(
        z
          .object({
            code: z.enum([
              'overloaded',
              'deadline_risk',
              'repeated_carryover',
              'missing_estimate',
            ]),
            taskId: z.uuid().nullable(),
            message: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(12),
    explanation: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const taskDecompositionOutputSchema = z
  .object({
    parentTaskId: z.uuid(),
    parentTaskVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1_000),
    subtasks: z
      .array(
        z
          .object({
            title: taskTitleSchema,
            estimateMinutes: taskEstimateMinutesSchema.nullable(),
          })
          .strict(),
      )
      .min(2)
      .max(12),
  })
  .strict();

export const carryoverDiagnosisOutputSchema = z
  .object({
    taskId: z.uuid(),
    taskVersion: z.number().int().positive(),
    question: z.string().trim().min(1).max(500),
    blockReason: blockReasonSchema,
    details: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const outcomeSummaryOutputSchema = z
  .object({
    reviewDate: localDateSchema,
    summary: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const assistantOutputByType = {
  task_extraction: taskExtractionOutputSchema,
  daily_plan: dailyPlanSuggestionOutputSchema,
  task_decomposition: taskDecompositionOutputSchema,
  carryover_diagnosis: carryoverDiagnosisOutputSchema,
  outcome_summary: outcomeSummaryOutputSchema,
} as const;

export const createAssistantSuggestionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('task_extraction'),
      sourceText: z.string().trim().min(1).max(10_000),
      idempotencyKey: z.string().trim().min(8).max(160).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('daily_plan'),
      date: localDateSchema.optional(),
      idempotencyKey: z.string().trim().min(8).max(160).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('task_decomposition'),
      taskId: z.uuid(),
      idempotencyKey: z.string().trim().min(8).max(160).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('carryover_diagnosis'),
      taskId: z.uuid(),
      idempotencyKey: z.string().trim().min(8).max(160).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('outcome_summary'),
      date: localDateSchema,
      idempotencyKey: z.string().trim().min(8).max(160).optional(),
    })
    .strict(),
]);

export const editAssistantSuggestionSchema = z
  .object({ output: z.record(z.string(), z.unknown()).optional() })
  .strict();

export const rejectAssistantSuggestionSchema = z
  .object({
    reason: z
      .enum(['not_useful', 'incorrect', 'not_now', 'other'])
      .default('not_useful'),
  })
  .strict();

const assistantOutputSchema = z.union([
  taskExtractionOutputSchema,
  dailyPlanSuggestionOutputSchema,
  taskDecompositionOutputSchema,
  carryoverDiagnosisOutputSchema,
  outcomeSummaryOutputSchema,
]);

export const assistantSuggestionSchema = z
  .object({
    id: z.uuid(),
    type: assistantSuggestionTypeSchema,
    status: assistantSuggestionStatusSchema,
    schemaVersion: z.string(),
    promptVersion: z.string(),
    version: z.number().int().positive(),
    output: assistantOutputSchema.nullable(),
    errorCode: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    acceptedAt: z.iso.datetime({ offset: true }).nullable(),
    rejectedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export const assistantSuggestionIdParamSchema = z.uuid();

export type AssistantSuggestionType = z.infer<
  typeof assistantSuggestionTypeSchema
>;
export type AssistantSuggestionStatus = z.infer<
  typeof assistantSuggestionStatusSchema
>;
export type BlockReason = z.infer<typeof blockReasonSchema>;
export type TaskExtractionOutput = z.infer<typeof taskExtractionOutputSchema>;
export type DailyPlanSuggestionOutput = z.infer<
  typeof dailyPlanSuggestionOutputSchema
>;
export type TaskDecompositionOutput = z.infer<
  typeof taskDecompositionOutputSchema
>;
export type CarryoverDiagnosisOutput = z.infer<
  typeof carryoverDiagnosisOutputSchema
>;
export type OutcomeSummaryOutput = z.infer<typeof outcomeSummaryOutputSchema>;
export type AssistantSuggestionOutput = z.infer<typeof assistantOutputSchema>;
export type CreateAssistantSuggestion = z.infer<
  typeof createAssistantSuggestionSchema
>;
export type EditAssistantSuggestion = z.infer<
  typeof editAssistantSuggestionSchema
>;
export type RejectAssistantSuggestion = z.output<
  typeof rejectAssistantSuggestionSchema
>;
export type AssistantSuggestion = z.infer<typeof assistantSuggestionSchema>;
