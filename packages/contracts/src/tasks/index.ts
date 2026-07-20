import { z } from 'zod';

export const taskStatusSchema = z.enum([
  'inbox',
  'backlog',
  'planned',
  'in_progress',
  'waiting',
  'blocked',
  'completed',
  'cancelled',
  'archived',
]);

export const taskCategorySchema = z.enum(['work', 'personal']);
export const taskPrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);

export const taskEventTypeSchema = z.enum([
  'created',
  'updated',
  'scheduled',
  'unscheduled',
  'started',
  'paused',
  'resumed',
  'waiting',
  'blocked',
  'completed',
  'carried_over',
  'cancelled',
  'archived',
  'estimate_changed',
  'ai_suggestion_accepted',
]);

export const taskTitleSchema = z.string().trim().min(1).max(240);
export const taskDescriptionSchema = z.string().trim().max(10_000).nullable();
export const taskEstimateMinutesSchema = z.number().int().min(1).max(10_080);
export const taskDueAtSchema = z.iso.datetime({ offset: true });

const editableTaskShape = {
  title: taskTitleSchema,
  description: taskDescriptionSchema,
  category: taskCategorySchema,
  priority: taskPrioritySchema,
  estimateMinutes: taskEstimateMinutesSchema.nullable(),
  dueAt: taskDueAtSchema.nullable(),
  projectId: z.uuid().nullable(),
  parentTaskId: z.uuid().nullable(),
};

export const createTaskSchema = z
  .object({
    title: editableTaskShape.title,
    description: editableTaskShape.description.optional(),
    category: editableTaskShape.category.default('work'),
    priority: editableTaskShape.priority.default('normal'),
    estimateMinutes: editableTaskShape.estimateMinutes.optional(),
    dueAt: editableTaskShape.dueAt.optional(),
    projectId: editableTaskShape.projectId.optional(),
    parentTaskId: editableTaskShape.parentTaskId.optional(),
  })
  .strict();

export const updateTaskSchema = z
  .object(editableTaskShape)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one editable task field is required.',
  });

const pageLimitSchema = z.coerce.number().int().min(1).max(100).default(20);

export const listTasksQuerySchema = z
  .object({
    status: taskStatusSchema.optional(),
    category: taskCategorySchema.optional(),
    priority: taskPrioritySchema.optional(),
    projectId: z.uuid().optional(),
    cursor: z.uuid().optional(),
    limit: pageLimitSchema,
  })
  .strict();

export const transitionTaskSchema = z
  .object({
    reason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export const taskSchema = z.object({
  id: z.uuid(),
  title: taskTitleSchema,
  description: z.string().nullable(),
  category: taskCategorySchema,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  estimateMinutes: z.number().int().nullable(),
  dueAt: taskDueAtSchema.nullable(),
  projectId: z.uuid().nullable(),
  parentTaskId: z.uuid().nullable(),
  carryoverCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  createdAt: taskDueAtSchema,
  updatedAt: taskDueAtSchema,
  completedAt: taskDueAtSchema.nullable(),
});

export const taskEventSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  type: taskEventTypeSchema,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: taskDueAtSchema,
});

export const taskPageSchema = z.object({
  items: z.array(taskSchema),
  nextCursor: z.uuid().nullable(),
});

export const taskHistoryPageSchema = z.object({
  items: z.array(taskEventSchema),
  nextCursor: z.uuid().nullable(),
});

export const taskIdParamSchema = z.uuid();

export const taskHistoryQuerySchema = z
  .object({
    cursor: z.uuid().optional(),
    limit: pageLimitSchema,
  })
  .strict();

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskCategory = z.infer<typeof taskCategorySchema>;
export type TaskPriority = z.infer<typeof taskPrioritySchema>;
export type TaskEventType = z.infer<typeof taskEventTypeSchema>;
export type CreateTask = z.output<typeof createTaskSchema>;
export type UpdateTask = z.output<typeof updateTaskSchema>;
export type ListTasksQuery = z.output<typeof listTasksQuerySchema>;
export type TransitionTask = z.output<typeof transitionTaskSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TaskEvent = z.infer<typeof taskEventSchema>;
export type TaskPage = z.infer<typeof taskPageSchema>;
export type TaskHistoryQuery = z.output<typeof taskHistoryQuerySchema>;
export type TaskHistoryPage = z.infer<typeof taskHistoryPageSchema>;
