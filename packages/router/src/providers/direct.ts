import {
  type ChatCompletionOptions,
  type ChatCompletionResult,
  type IModelProvider,
  ProviderError,
} from './types.js';

export type DirectVendor = 'anthropic' | 'openai' | 'gemini';

/**
 * Stub registry for direct provider APIs (Anthropic / OpenAI / Gemini).
 * Implemented as a placeholder so ModelAdapter can dispatch by vendor later.
 */
export class DirectProvider implements IModelProvider {
  readonly kind = 'direct' as const;

  constructor(private readonly vendor: DirectVendor = 'openai') {}

  async chatCompletions(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    throw new ProviderError(
      `Direct ${this.vendor} provider is not implemented in MVP. Use OpenRouter or LocalProvider. Model=${options.model}`,
    );
  }
}
