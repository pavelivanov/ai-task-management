import {
  type CurrentFocusSession,
  currentFocusSessionSchema,
  type FocusSession,
  focusSessionSchema,
} from '@execution/contracts';

import { apiRequest, jsonBody } from '../../lib/api-client';

export function getCurrentFocus(): Promise<CurrentFocusSession> {
  return apiRequest('/focus/current', currentFocusSessionSchema);
}

export function startFocus(input: {
  taskId: string;
  initialIntent?: string;
}): Promise<FocusSession> {
  return apiRequest('/focus/start', focusSessionSchema, {
    method: 'POST',
    ...jsonBody(input),
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
