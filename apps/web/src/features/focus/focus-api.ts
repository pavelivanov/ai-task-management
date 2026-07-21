import {
  type CurrentFocusSession,
  type DailyPlan,
  dailyPlanSchema,
  currentFocusSessionSchema,
  type FocusSession,
  focusSessionSchema,
  type Task,
  taskSchema,
} from '@execution/contracts';

import { apiRequest, jsonBody } from '../../lib/api-client';

export function getCurrentFocus(): Promise<CurrentFocusSession> {
  return apiRequest('/focus/current', currentFocusSessionSchema);
}

export function startFocus(input: {
  taskId: string;
  initialIntent?: string;
  protectedHoursOverride?: boolean;
}): Promise<FocusSession> {
  return apiRequest('/focus/start', focusSessionSchema, {
    method: 'POST',
    ...jsonBody(input),
  });
}

export function scheduleAfterProtectedHours(
  taskId: string,
): Promise<DailyPlan> {
  return apiRequest('/focus/schedule-after-protected-hours', dailyPlanSchema, {
    method: 'POST',
    ...jsonBody({ taskId }),
  });
}

export function captureFocusDistraction(
  sessionId: string,
  title: string,
): Promise<Task> {
  return apiRequest(`/focus/${sessionId}/distractions`, taskSchema, {
    method: 'POST',
    ...jsonBody({ title }),
  });
}

export type FocusCommand =
  'pause' | 'resume' | 'wait' | 'block' | 'complete' | 'stop';

export function commandFocus(
  sessionId: string,
  command: FocusCommand,
  body: Record<string, unknown> = {},
): Promise<FocusSession> {
  return apiRequest(`/focus/${sessionId}/${command}`, focusSessionSchema, {
    method: 'POST',
    ...jsonBody(body),
  });
}
