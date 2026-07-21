import type {
  AssistantSuggestionOutput,
  AssistantSuggestionType,
} from '@execution/contracts';
import type { z } from 'zod';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface GenerateStructuredInput {
  type: AssistantSuggestionType;
  schema: z.ZodType<AssistantSuggestionOutput>;
  schemaName: string;
  promptVersion: string;
  instructions: string;
  context: Record<string, unknown>;
  timeoutMs: number;
  idempotencyKey: string;
}

export type LlmProviderResult =
  | {
      kind: 'success';
      data: AssistantSuggestionOutput;
      provider: string;
      model: string;
      requestId: string | null;
      usage: Record<string, number | null>;
    }
  | { kind: 'refusal'; code: 'provider_refusal'; message: string }
  | {
      kind: 'error';
      code:
        | 'provider_disabled'
        | 'provider_timeout'
        | 'provider_rate_limited'
        | 'provider_incomplete'
        | 'provider_invalid_output'
        | 'provider_unavailable';
      retryable: boolean;
    };

export interface LlmProvider {
  generateStructured(
    input: GenerateStructuredInput,
  ): Promise<LlmProviderResult>;
}
