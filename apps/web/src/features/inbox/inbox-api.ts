import {
  type CaptureInboxTask,
  type ProcessInboxResult,
  type ProcessInboxTask,
  processInboxResultSchema,
  type Task,
  type TaskPage,
  taskPageSchema,
  taskSchema,
} from '@execution/contracts';

import { apiRequest, jsonBody } from '../../lib/api-client';

export function listInbox(limit = 50): Promise<TaskPage> {
  return apiRequest(`/inbox?limit=${limit}`, taskPageSchema);
}

export function captureInbox(input: CaptureInboxTask): Promise<Task> {
  return apiRequest('/inbox/capture', taskSchema, {
    method: 'POST',
    ...jsonBody(input),
  });
}

export function processInbox(
  taskId: string,
  input: ProcessInboxTask,
): Promise<ProcessInboxResult> {
  return apiRequest(`/inbox/${taskId}/process`, processInboxResultSchema, {
    method: 'POST',
    ...jsonBody(input),
  });
}
