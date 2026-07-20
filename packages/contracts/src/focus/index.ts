import { z } from 'zod';

import { taskSchema } from '../tasks/index.js';

const focusTextSchema = z.string().trim().min(1).max(5_000);

export const focusSessionStatusSchema = z.enum([
  'active',
  'paused',
  'waiting',
  'blocked',
  'completed',
  'stopped',
]);

export const focusSegmentTypeSchema = z.enum(['focused', 'paused', 'waiting']);

export const focusSessionSegmentSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().nonnegative(),
  type: focusSegmentTypeSchema,
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const focusSessionSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  status: focusSessionStatusSchema,
  version: z.number().int().positive(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).nullable(),
  initialIntent: z.string().nullable(),
  outcome: z.string().nullable(),
  interruptionReason: z.string().nullable(),
  focusedDurationSeconds: z.number().int().nonnegative(),
  activeSegmentStartedAt: z.iso.datetime({ offset: true }).nullable(),
  serverNow: z.iso.datetime({ offset: true }),
  segments: z.array(focusSessionSegmentSchema),
  task: taskSchema,
});

export const currentFocusSessionSchema = focusSessionSchema.nullable();

export const startFocusSessionSchema = z
  .object({
    taskId: z.uuid(),
    initialIntent: focusTextSchema.optional(),
  })
  .strict();

export const focusReasonSchema = z
  .object({ reason: focusTextSchema.optional() })
  .strict();

export const resumeFocusSessionSchema = z.object({}).strict();

export const completeFocusSessionSchema = z
  .object({ outcome: focusTextSchema })
  .strict();

export const stopFocusSessionSchema = z
  .object({
    reason: focusTextSchema.optional(),
    taskStatus: z.enum(['backlog', 'waiting', 'blocked']).default('backlog'),
  })
  .strict();

export const focusSessionIdParamSchema = z.uuid();

export const invalidationEventTypeSchema = z.enum([
  'focus.changed',
  'plan.changed',
  'suggestion.changed',
]);

export const invalidationEventSchema = z.object({
  id: z.uuid(),
  type: invalidationEventTypeSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  resourceId: z.uuid(),
  resourceVersion: z.number().int().positive(),
});

export type FocusSessionStatus = z.infer<typeof focusSessionStatusSchema>;
export type FocusSegmentType = z.infer<typeof focusSegmentTypeSchema>;
export type FocusSessionSegment = z.infer<typeof focusSessionSegmentSchema>;
export type FocusSession = z.infer<typeof focusSessionSchema>;
export type CurrentFocusSession = z.infer<typeof currentFocusSessionSchema>;
export type StartFocusSession = z.output<typeof startFocusSessionSchema>;
export type FocusReason = z.output<typeof focusReasonSchema>;
export type ResumeFocusSession = z.output<typeof resumeFocusSessionSchema>;
export type CompleteFocusSession = z.output<typeof completeFocusSessionSchema>;
export type StopFocusSession = z.output<typeof stopFocusSessionSchema>;
export type InvalidationEventType = z.infer<typeof invalidationEventTypeSchema>;
export type InvalidationEvent = z.infer<typeof invalidationEventSchema>;
