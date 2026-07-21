import type {
  Task as TaskContract,
  TaskEvent as TaskEventContract,
} from '@execution/contracts';

import type {
  Task as StoredTask,
  TaskEvent as StoredTaskEvent,
} from '../../generated/prisma/client';

export function toTaskContract(task: StoredTask): TaskContract {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    category: task.category,
    status: task.status,
    priority: task.priority,
    estimateMinutes: task.estimateMinutes,
    dueAt: task.dueAt?.toISOString() ?? null,
    projectId: task.projectId,
    parentTaskId: task.parentTaskId,
    blockReason: task.blockReason,
    blockReasonDetails: task.blockReasonDetails,
    carryoverCount: task.carryoverCount,
    version: task.version,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

export function toTaskEventContract(event: StoredTaskEvent): TaskEventContract {
  const metadata =
    typeof event.metadata === 'object' &&
    event.metadata !== null &&
    !Array.isArray(event.metadata)
      ? (event.metadata as Record<string, unknown>)
      : {};

  return {
    id: event.id,
    taskId: event.taskId,
    type: event.type,
    metadata,
    createdAt: event.createdAt.toISOString(),
  };
}
