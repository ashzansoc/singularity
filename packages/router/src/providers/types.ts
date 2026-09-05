export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  /** Anthropic-style cache_control (passed through OpenRouter when present). */
  cache_control?: { type: 'ephemeral' };
  /** Opaque provider extras from Prompt Engine adapters. */
  providerExtras?: Record<string, unknown>;
}

export type ResponseFormat =
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: {
        name: string;
        strict?: boolean;
        schema: Record<string, unknown>;
      };
    };

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  signal?: AbortSignal;
  /** OpenAI / OpenRouter prompt cache key. */
  promptCacheKey?: string;
  /** Structured output when the provider supports it. */
  responseFormat?: ResponseFormat;
  /** Rate-gate lane options (interactive chat lane + bounded slot wait). */
  gateOptions?: import('../rateLimit.js').GateLlmOptions;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finishReason: string | null;
}

export interface ChatCompletionResult {
  id: string;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Provider-reported cached input tokens when available. */
    cachedPromptTokens?: number;
  };
  raw?: unknown;
}

export interface IModelProvider {
  readonly kind: 'openrouter' | 'local' | 'direct';
  chatCompletions(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
  /** Optional SSE delta stream. Providers without streaming omit this. */
  streamChatCompletions?(
    options: ChatCompletionOptions,
  ): AsyncIterable<ChatStreamEvent>;
}

export interface ChatStreamEvent {
  /** Incremental text content (empty for role/usage-only chunks). */
  delta?: string;
  /** Reasoning/thinking content when the model emits it separately. */
  reasoningDelta?: string;
  finishReason?: string | null;
  usage?: ChatCompletionResult['usage'];
  /** Raw provider chunk for advanced consumers. */
  raw?: unknown;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
