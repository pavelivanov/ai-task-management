import { Injectable } from '@nestjs/common';

import type { LlmProvider, LlmProviderResult } from './llm-provider';

@Injectable()
export class DisabledLlmProvider implements LlmProvider {
  generateStructured(): Promise<LlmProviderResult> {
    return Promise.resolve({
      kind: 'error',
      code: 'provider_disabled',
      retryable: false,
    });
  }
}
