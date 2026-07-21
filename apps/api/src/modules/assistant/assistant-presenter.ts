import {
  assistantOutputByType,
  type AssistantSuggestion,
} from '@execution/contracts';

import type { AiSuggestion as StoredSuggestion } from '../../generated/prisma/client';

export function toAssistantSuggestionContract(
  suggestion: StoredSuggestion,
): AssistantSuggestion {
  return {
    id: suggestion.id,
    type: suggestion.type,
    status: suggestion.status,
    schemaVersion: suggestion.schemaVersion,
    promptVersion: suggestion.promptVersion,
    version: suggestion.version,
    output:
      suggestion.output === null
        ? null
        : assistantOutputByType[suggestion.type].parse(suggestion.output),
    errorCode: suggestion.errorCode,
    createdAt: suggestion.createdAt.toISOString(),
    updatedAt: suggestion.updatedAt.toISOString(),
    acceptedAt: suggestion.acceptedAt?.toISOString() ?? null,
    rejectedAt: suggestion.rejectedAt?.toISOString() ?? null,
  };
}
