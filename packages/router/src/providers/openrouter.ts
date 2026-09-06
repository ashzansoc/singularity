import { fetchWithRateRetry, parseRetryAfterMs } from '../rateLimit.js';
import {
  type ChatCompletionOptions,
  type ChatCompletionResult,
  type ChatStreamEvent,
  type IModelProvider,
  ProviderError,
} from './types.js';

export interface OpenRouterProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  siteUrl?: string;
  appName?: string;
}

/**
 * Thin OpenAI-compatible client for https://openrouter.ai/api/v1
 */
export class OpenRouterProvider implements IModelProvider {
  readonly kind = 'openrouter' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly siteUrl?: string;
  private readonly appName: string;

  constructor(config: OpenRouterProviderConfig = {}) {
    this.apiKey =
      config.apiKey ??
      process.env.OPENROUTER_API_KEY ??
      process.env.TOKENROUTER_API_KEY ??
      '';
    this.baseUrl = (
      config.baseUrl ??
      process.env.OPENROUTER_BASE_URL ??
      'https://openrouter.ai/api/v1'
    ).replace(/\/$/, '');
    this.fetchFn = config.fetch ?? fetch;
    this.siteUrl = config.siteUrl;
    this.appName = config.appName ?? 'Singularity';
  }

  async chatCompletions(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const viaProxy = this.baseUrl.includes('llm-proxy');
    if (!this.apiKey && !viaProxy) {
      throw new ProviderError(
        'OPENROUTER_API_KEY is not set',
      );
    }

    const headers = await this.requestHeaders(viaProxy);
    const body = this.requestBody(options, false);

    const res = await fetchWithRateRetry({
      initiate: () =>
        this.fetchFn(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: options.signal,
        }),
      // 429 bodies are consumed only on the rate-limited attempt; successful
      // responses are read once below.
      classify: async (r) => {
        if (r.status !== 429) {
          return { retry: false };
        }
        const bodyText = await r.text().catch(() => '');
        return { retry: true, status: 429, retryAfterMs: parseRetryAfterMs(r, bodyText) };
      },
      gateOptions: options.gateOptions,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new ProviderError(`AI gateway error ${res.status}`, res.status, text);
    }

    let json: OpenRouterChatResponse;
    try {
      json = JSON.parse(text) as OpenRouterChatResponse;
    } catch {
      throw new ProviderError('AI gateway returned invalid JSON', res.status, text);
    }

    return {
      id: json.id ?? 'unknown',
      model: json.model ?? options.model,
      choices: (json.choices ?? []).map((c, i) => ({
        index: c.index ?? i,
        message: {
          role: (c.message?.role as 'assistant') ?? 'assistant',
          content: c.message?.content ?? '',
        },
        finishReason: c.finish_reason ?? null,
      })),
      usage: normalizeUsage(json.usage),
      raw: json,
    };
  }

  /**
   * SSE streaming variant. Yields deltas as they arrive; the final chunk
   * carries usage when the gateway includes it. Falls back to a
   * non-streaming call if the gateway rejects `stream: true` mid-handshake.
   */
  async *streamChatCompletions(
    options: ChatCompletionOptions,
  ): AsyncIterable<ChatStreamEvent> {
    const viaProxy = this.baseUrl.includes('llm-proxy');
    if (!this.apiKey && !viaProxy) {
      throw new ProviderError(
        'OPENROUTER_API_KEY is not set',
      );
    }

    const headers = await this.requestHeaders(viaProxy);
    headers.Accept = 'text/event-stream';
    const body = this.requestBody(options, true);

    const res = await fetchWithRateRetry({
      initiate: () =>
        this.fetchFn(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: options.signal,
        }),
      // Retry only while the stream has not started — once the handshake is
      // OK and the body exists, the SSE loop below owns the response.
      classify: async (r) => {
        if (!(r.status === 429 && !r.body)) {
          return { retry: false };
        }
        const bodyText = await r.text().catch(() => '');
        return { retry: true, status: 429, retryAfterMs: parseRetryAfterMs(r, bodyText) };
      },
      gateOptions: options.gateOptions,
    });

    if (!res.ok || !res.body) {
      const text = res.body ? await res.text().catch(() => '') : '';
      throw new ProviderError(
        `AI gateway error ${res.status}`,
        res.status,
        text,
      );
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      // Gateway ignored stream:true — parse the single JSON response instead.
      const text = await res.text();
      let json: OpenRouterChatResponse;
      try {
        json = JSON.parse(text) as OpenRouterChatResponse;
      } catch {
        throw new ProviderError('AI gateway returned invalid JSON', res.status, text);
      }
      for (const choice of json.choices ?? []) {
        const content = choice.message?.content;
        if (content) {
          yield { delta: content };
        }
      }
      yield { finishReason: json.choices?.[0]?.finish_reason ?? null, usage: normalizeUsage(json.usage), raw: json };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    // Single-pass SSE line splitter: track a consumed offset instead of
    // re-slicing a growing buffer per line, so long streams stay O(total
    // bytes) rather than O(n²) string copies (matches the pass-through style
    // of the reference streaming harness).
    let buffer = '';
    let consumed = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        // Scan for line terminators starting after the already-consumed span.
        while ((nl = buffer.indexOf('\n', consumed)) >= 0) {
          const line = buffer.slice(consumed, nl).replace(/\r$/, '');
          consumed = nl + 1;
          const event = parseSseDataLine(line);
          if (event) {
            yield event;
          }
        }
        // Drop the fully-consumed prefix so `buffer` does not grow unboundedly;
        // `consumed` is relative to the new buffer, so reset it.
        if (consumed > 0) {
          buffer = buffer.slice(consumed);
          consumed = 0;
        }
      }
      const rest = buffer.slice(consumed).replace(/\r$/, '');
      if (rest.trim()) {
        const event = parseSseDataLine(rest);
        if (event) {
          yield event;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async requestHeaders(viaProxy: boolean): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': this.appName,
    };
    if (this.siteUrl) {
      headers['HTTP-Referer'] = this.siteUrl;
    }
    // Singularity LLM proxy headers when base URL is our Supabase function
    if (viaProxy) {
      try {
        const { readBetaAuth, SINGULARITY_SUPABASE_ANON_KEY } = await import('../betaAuth.js');
        const auth = readBetaAuth();
        if (auth?.accessToken) {
          headers.Authorization = `Bearer ${auth.accessToken}`;
        }
        if (auth?.deviceId) {
          headers['X-Singularity-Device-Id'] = auth.deviceId;
        }
        headers.apikey = SINGULARITY_SUPABASE_ANON_KEY;
      } catch {
        /* ignore */
      }
      if (!headers.Authorization || headers.Authorization === 'Bearer ') {
        throw new ProviderError(
          'Singularity beta login required. Restart Singularity and complete email sign-in.',
        );
      }
    }
    return headers;
  }

  private requestBody(options: ChatCompletionOptions, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages.map((m) => {
        const cacheControl =
          m.cache_control ??
          (m.providerExtras?.cache_control as { type: 'ephemeral' } | undefined);
        // Anthropic via OpenRouter: content parts with cache_control on system
        if (cacheControl && m.role === 'system') {
          return {
            role: m.role,
            content: [
              {
                type: 'text',
                text: m.content,
                cache_control: cacheControl,
              },
            ],
            ...(m.name ? { name: m.name } : {}),
          };
        }
        return {
          role: m.role,
          content: m.content,
          ...(m.name ? { name: m.name } : {}),
          ...(cacheControl ? { cache_control: cacheControl } : {}),
        };
      }),
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream,
    };
    if (stream) {
      body.stream_options = { include_usage: true };
    }
    if (options.promptCacheKey) {
      body.prompt_cache_key = options.promptCacheKey;
    }
    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }
    return body;
  }
}

function normalizeUsage(usage?: OpenRouterChatResponse['usage']): ChatCompletionResult['usage'] | undefined {
  if (!usage) {
    return undefined;
  }
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    cachedPromptTokens:
      usage.prompt_tokens_details?.cached_tokens ??
      usage.cache_read_input_tokens ??
      undefined,
  };
}

/** Parse one `data:` SSE line into a ChatStreamEvent; returns null for keepalives. */
export function parseSseDataLine(line: string): ChatStreamEvent | null {
  if (!line.startsWith('data:')) {
    return null;
  }
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') {
    return null;
  }
  let chunk: OpenRouterStreamChunk;
  try {
    chunk = JSON.parse(payload) as OpenRouterStreamChunk;
  } catch {
    return null;
  }
  const choice = chunk.choices?.[0];
  const delta = choice?.delta?.content ?? '';
  const reasoningDelta =
    (choice?.delta as { reasoning?: string } | undefined)?.reasoning ?? '';
  return {
    ...(delta ? { delta } : {}),
    ...(reasoningDelta ? { reasoningDelta } : {}),
    finishReason: choice?.finish_reason ?? null,
    ...(chunk.usage ? { usage: normalizeUsage(chunk.usage) } : {}),
    raw: chunk,
  };
}

interface OpenRouterStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: OpenRouterChatResponse['usage'];
}

interface OpenRouterChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: { role?: string; content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cache_read_input_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}
