import type {
  CarryoverSignal as CarryoverSignalContract,
  DailyPlan,
} from '@execution/contracts';
import { analyzePlan } from '@execution/domain';

import type { Prisma } from '../../generated/prisma/client';
import { toTaskContract } from '../tasks/task-presenter';

export type StoredDailyPlanWithItems = Prisma.DailyPlanGetPayload<{
  include: { items: { include: { task: true } } };
}>;

export interface DailyPlanLimits {
  primaryLimit: number;
  secondaryLimit: number;
  overCapacityPercent: number;
}

export function formatLocalTime(value: Date): string {
  const hours = value.getUTCHours().toString().padStart(2, '0');
  const minutes = value.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function parseLocalTime(value: string): Date {
  const [hours, minutes] = value.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, hours ?? 0, minutes ?? 0));
}

export function databaseDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDatabaseDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function toDailyPlanContract(
  plan: StoredDailyPlanWithItems,
  limits: DailyPlanLimits,
): DailyPlan {
  const workdayStart = formatLocalTime(plan.workdayStart);
  const workdayEnd = formatLocalTime(plan.workdayEnd);
  const analysis = analyzePlan(
    workdayStart,
    workdayEnd,
    plan.items.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      role: item.role,
      position: item.position,
      plannedDurationMinutes: item.plannedDurationMinutes,
      taskEstimateMinutes: item.task.estimateMinutes,
    })),
    limits,
  );
  const itemById = new Map(plan.items.map((item) => [item.id, item]));
  const carryoverSignals = Array.isArray(plan.carryoverSignals)
    ? (plan.carryoverSignals as unknown as CarryoverSignalContract[])
    : [];

  return {
    id: plan.id,
    date: formatDatabaseDate(plan.date),
    workdayStart,
    workdayEnd,
    status: plan.status,
    version: plan.version,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
    closedAt: plan.closedAt?.toISOString() ?? null,
    items: analysis.orderedItems.map((ordered) => {
      const item = itemById.get(ordered.id);
      if (!item)
        throw new Error('Daily plan item disappeared while presenting.');
      return {
        id: item.id,
        taskId: item.taskId,
        role: item.role,
        plannedStart: item.plannedStart?.toISOString() ?? null,
        plannedDurationMinutes: item.plannedDurationMinutes,
        position: item.position,
        addedDuringDay: item.addedDuringDay,
        completedDuringDay: item.completedDuringDay,
        task: toTaskContract(item.task),
      };
    }),
    capacity: {
      availableMinutes: analysis.availableMinutes,
      scheduledMinutes: analysis.scheduledMinutes,
      roleCounts: analysis.roleCounts,
    },
    warnings: analysis.warnings,
    carryoverSignals,
  };
}
