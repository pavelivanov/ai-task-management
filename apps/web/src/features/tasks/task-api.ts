import {
  type CreateTask,
  type Task,
  type TaskCategory,
  type TaskPage,
  type TaskStatus,
  taskPageSchema,
  taskSchema,
  type UpdateTask,
} from '@execution/contracts';

import { apiRequest, jsonBody } from '../../lib/api-client';

export interface TaskFilters {
  status?: TaskStatus;
  category?: TaskCategory;
  cursor?: string;
  limit?: number;
  projectId?: string;
}

export function taskFiltersKey(filters: TaskFilters): string {
  return new URLSearchParams(
    Object.entries(filters)
      .filter(
        (entry): entry is [string, string | number] => entry[1] !== undefined,
      )
      .map(([key, value]) => [key, String(value)]),
  ).toString();
}

export function listTasks(filters: TaskFilters): Promise<TaskPage> {
  return apiRequest(`/tasks?${taskFiltersKey(filters)}`, taskPageSchema);
}

export function createTask(input: CreateTask): Promise<Task> {
  return apiRequest('/tasks', taskSchema, {
    method: 'POST',
    ...jsonBody(input),
  });
}

export function updateTask(id: string, input: UpdateTask): Promise<Task> {
  return apiRequest(`/tasks/${id}`, taskSchema, {
    method: 'PATCH',
    ...jsonBody(input),
  });
}

export function transitionTask(
  id: string,
  action: 'archive' | 'complete',
): Promise<Task> {
  return apiRequest(`/tasks/${id}/${action}`, taskSchema, {
    method: 'POST',
    ...jsonBody({}),
  });
}
