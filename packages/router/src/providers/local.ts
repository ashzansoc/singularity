import {
  type ChatCompletionOptions,
  type ChatCompletionResult,
  type IModelProvider,
  ProviderError,
} from './types.js';

export interface LocalProviderConfig {
  /** When true, returns an echo completion instead of throwing. */
  echo?: boolean;
}

/**
 * Stub local inference provider for multi-provider wiring / tests.
 */
export class LocalProvider implements IModelProvider {
  readonly kind = 'local' as const;

  constructor(private readonly config: LocalProviderConfig = {}) {}

  async chatCompletions(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    if (!this.config.echo) {
      throw new ProviderError(
        `Local provider is a stub. Start a local server or set echo:true for tests. Model=${options.model}`,
      );
    }

    const lastUser = [...options.messages].reverse().find((m) => m.role === 'user');
    return {
      id: `local-${Date.now()}`,
      model: options.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `[local echo] ${lastUser?.content ?? ''}`,
          },
          finishReason: 'stop',
        },
      ],
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    };
  }
}
