import { z } from 'zod';

import {
  taskDueAtSchema,
  taskSchema,
  taskTitleSchema,
} from '../tasks/index.js';
import { localTimeSchema } from '../users/index.js';

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format.')
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    },
    { message: 'Expected a valid Gregorian date.' },
  );

export const dailyPlanStatusSchema = z.enum(['draft', 'active', 'closed']);
export const dailyPlanRoleSchema = z.enum(['primary', 'secondary', 'optional']);

export const planningWarningSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('MULTIPLE_PRIMARY'),
    data: z.object({ count: z.number().int(), limit: z.number().int() }),
  }),
  z.object({
    code: z.literal('TOO_MANY_SECONDARY'),
    data: z.object({ count: z.number().int(), limit: z.number().int() }),
  }),
  z.object({
    code: z.literal('MISSING_ESTIMATE'),
    data: z.object({ taskIds: z.array(z.uuid()) }),
  }),
  z.object({
    code: z.literal('OVER_CAPACITY'),
    data: z.object({
      availableMinutes: z.number().int().nonnegative(),
      scheduledMinutes: z.number().int().nonnegative(),
      thresholdPercent: z.number().nonnegative(),
    }),
  }),
]);

export const carryoverSignalSchema = z.object({
  taskId: z.uuid(),
  count: z.number().int().nonnegative(),
  level: z.enum(['warning', 'diagnosis', 'explicit_choice']).nullable(),
  resolution: z
    .object({
      action: z.enum(['break_down', 'postpone', 'archive', 'recommit']),
      resolvedAt: z.iso.datetime({ offset: true }),
    })
    .nullable()
    .optional(),
});

export const dailyPlanItemSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  role: dailyPlanRoleSchema,
  plannedStart: z.iso.datetime({ offset: true }).nullable(),
  plannedDurationMinutes: z.number().int().positive().nullable(),
  position: z.number().int().nonnegative(),
  addedDuringDay: z.boolean(),
  completedDuringDay: z.boolean(),
  task: taskSchema,
});

export const dailyPlanSchema = z.object({
  id: z.uuid(),
  date: localDateSchema,
  workdayStart: localTimeSchema,
  workdayEnd: localTimeSchema,
  status: dailyPlanStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  closedAt: z.iso.datetime({ offset: true }).nullable(),
  items: z.array(dailyPlanItemSchema),
  capacity: z.object({
    availableMinutes: z.number().int().nonnegative(),
    scheduledMinutes: z.number().int().nonnegative(),
    roleCounts: z.object({
      primary: z.number().int().nonnegative(),
      secondary: z.number().int().nonnegative(),
      optional: z.number().int().nonnegative(),
    }),
  }),
  warnings: z.array(planningWarningSchema),
  carryoverSignals: z.array(carryoverSignalSchema),
});

export const createTodayPlanSchema = z
  .object({
    status: z.enum(['draft', 'active']).default('active'),
  })
  .strict();

export const updateTodayPlanSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    status: z.enum(['draft', 'active']).optional(),
    workdayStart: localTimeSchema.optional(),
    workdayEnd: localTimeSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== undefined ||
      value.workdayStart !== undefined ||
      value.workdayEnd !== undefined,
    { message: 'At least one editable daily-plan field is required.' },
  );

export const addDailyPlanItemSchema = z
  .object({
    taskId: z.uuid(),
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
    expectedPlanVersion: z.number().int().positive().optional(),
  })
  .strict();

export const updateDailyPlanItemSchema = z
  .object({
    expectedPlanVersion: z.number().int().positive(),
    role: dailyPlanRoleSchema.optional(),
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
  .strict()
  .refine(
    (value) =>
      value.role !== undefined ||
      value.plannedStart !== undefined ||
      value.plannedDurationMinutes !== undefined ||
      value.position !== undefined,
    { message: 'At least one editable daily-plan item field is required.' },
  );

export const removeDailyPlanItemQuerySchema = z
  .object({
    expectedPlanVersion: z.coerce.number().int().positive(),
  })
  .strict();

export const closeDailyPlanSchema = z
  .object({
    expectedPlanVersion: z.number().int().positive().optional(),
  })
  .strict();

export const resolveCarryoverSchema = z
  .discriminatedUnion('action', [
    z
      .object({
        action: z.literal('break_down'),
        expectedPlanVersion: z.number().int().positive(),
        subtasks: z.array(taskTitleSchema).min(2).max(5),
      })
      .strict(),
    z
      .object({
        action: z.literal('postpone'),
        expectedPlanVersion: z.number().int().positive(),
        dueAt: taskDueAtSchema,
      })
      .strict(),
    z
      .object({
        action: z.literal('archive'),
        expectedPlanVersion: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        action: z.literal('recommit'),
        expectedPlanVersion: z.number().int().positive(),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (
      value.action === 'break_down' &&
      new Set(value.subtasks.map((title) => title.toLowerCase())).size !==
        value.subtasks.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Breakdown steps must be distinct.',
        path: ['subtasks'],
      });
    }
  });

export const dailyPlanItemIdParamSchema = z.uuid();

export type DailyPlanStatus = z.infer<typeof dailyPlanStatusSchema>;
export type DailyPlanRole = z.infer<typeof dailyPlanRoleSchema>;
export type PlanningWarning = z.infer<typeof planningWarningSchema>;
export type CarryoverSignal = z.infer<typeof carryoverSignalSchema>;
export type DailyPlanItem = z.infer<typeof dailyPlanItemSchema>;
export type DailyPlan = z.infer<typeof dailyPlanSchema>;
export type CreateTodayPlan = z.output<typeof createTodayPlanSchema>;
export type UpdateTodayPlan = z.output<typeof updateTodayPlanSchema>;
export type AddDailyPlanItem = z.output<typeof addDailyPlanItemSchema>;
export type UpdateDailyPlanItem = z.output<typeof updateDailyPlanItemSchema>;
export type RemoveDailyPlanItemQuery = z.output<
  typeof removeDailyPlanItemQuerySchema
>;
export type CloseDailyPlan = z.output<typeof closeDailyPlanSchema>;
export type ResolveCarryover = z.output<typeof resolveCarryoverSchema>;
