import type { ModelSpec, ProviderKind } from '../types.js';
import { DirectProvider } from './direct.js';
import { LocalProvider } from './local.js';
import { OpenRouterProvider, type OpenRouterProviderConfig } from './openrouter.js';
import {
  type ChatCompletionOptions,
  type ChatCompletionResult,
  type ChatStreamEvent,
  type IModelProvider,
  ProviderError,
} from './types.js';

export interface ModelAdapterConfig {
  openrouter?: OpenRouterProviderConfig;
  localEcho?: boolean;
}

/**
 * Dispatches chat completions to the provider implied by ModelSpec.provider.
 */
export class ModelAdapter {
  private readonly providers: Record<ProviderKind, IModelProvider>;

  constructor(config: ModelAdapterConfig = {}) {
    this.providers = {
      openrouter: new OpenRouterProvider(config.openrouter),
      local: new LocalProvider({ echo: config.localEcho }),
      direct: new DirectProvider('openai'),
    };
  }

  getProvider(kind: ProviderKind): IModelProvider {
    return this.providers[kind];
  }

  /** Provider registered for a specific model id (by its spec's provider kind). */
  providerOf(modelId: string): IModelProvider | undefined {
    const kind = inferProviderKindForModelId(modelId);
    return this.providers[kind];
  }

  async complete(
    model: ModelSpec,
    options: Omit<ChatCompletionOptions, 'model'>,
  ): Promise<ChatCompletionResult> {
    const provider = this.providers[model.provider];
    if (!provider) {
      throw new ProviderError(`No provider registered for ${model.provider}`);
    }
    return provider.chatCompletions({ ...options, model: model.id });
  }

  async *streamComplete(
    model: ModelSpec,
    options: Omit<ChatCompletionOptions, 'model'>,
  ): AsyncIterable<ChatStreamEvent> {
    const provider = this.providers[model.provider];
    if (!provider) {
      throw new ProviderError(`No provider registered for ${model.provider}`);
    }
    if (!provider.streamChatCompletions) {
      // Provider has no streaming — degrade to a single-delta buffered result.
      const result = await provider.chatCompletions({ ...options, model: model.id });
      const text = result.choices[0]?.message.content ?? '';
      yield { delta: text, finishReason: result.choices[0]?.finishReason ?? null, usage: result.usage };
      return;
    }
    yield* provider.streamChatCompletions({ ...options, model: model.id });
  }
}

function inferProviderKindForModelId(modelId: string): ProviderKind {
  if (/^local:/i.test(modelId) || /localhost|127\.0\.0\.1/.test(modelId)) {
    return 'local';
  }
  return 'openrouter';
}
