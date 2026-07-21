import {
  assistantSuggestionSchema,
  type AssistantSuggestion,
  type CreateAssistantSuggestion,
} from '@execution/contracts';

import { apiRequest, jsonBody } from '../../lib/api-client';

export function createAssistantSuggestion(
  input: CreateAssistantSuggestion,
): Promise<AssistantSuggestion> {
  return apiRequest('/assistant/suggestions', assistantSuggestionSchema, {
    method: 'POST',
    ...jsonBody(input),
  });
}

export function getAssistantSuggestion(
  id: string,
): Promise<AssistantSuggestion> {
  return apiRequest(
    `/assistant/suggestions/${encodeURIComponent(id)}`,
    assistantSuggestionSchema,
  );
}

export function acceptAssistantSuggestion(
  id: string,
  output?: Record<string, unknown>,
): Promise<AssistantSuggestion> {
  return apiRequest(
    `/assistant/suggestions/${encodeURIComponent(id)}/accept`,
    assistantSuggestionSchema,
    { method: 'POST', ...jsonBody(output ? { output } : {}) },
  );
}

export function rejectAssistantSuggestion(
  id: string,
): Promise<AssistantSuggestion> {
  return apiRequest(
    `/assistant/suggestions/${encodeURIComponent(id)}/reject`,
    assistantSuggestionSchema,
    { method: 'POST', ...jsonBody({ reason: 'not_now' }) },
  );
}
