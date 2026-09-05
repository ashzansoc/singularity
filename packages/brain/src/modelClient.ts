/**
 * OpenAI-compatible Brain model client — independent of chat routing.
 * One Brain LLM. No agent swarm.
 */

import type { BrainConfig, ReasoningMode } from './types.js';
import { brainModelConfigured } from './config.js';

export interface BrainChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface BrainModelResult {
  content: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  raw?: unknown;
}

export interface BrainModelClient {
  readonly configured: boolean;
  complete(messages: BrainChatMessage[], opts?: {
    mode?: ReasoningMode;
    maxTokens?: number;
    temperature?: number;
  }): Promise<BrainModelResult>;
}

export class OpenAiCompatibleBrainClient implements BrainModelClient {
  constructor(private cfg: BrainConfig, private fetchImpl: typeof fetch = fetch) {}

  get configured(): boolean {
    return brainModelConfigured(this.cfg);
  }

  async complete(messages: BrainChatMessage[], opts?: {
    mode?: ReasoningMode;
    maxTokens?: number;
    temperature?: number;
  }): Promise<BrainModelResult> {
    if (!this.configured) {
      throw new Error('Brain model not configured');
    }
    const base = this.cfg.model.baseUrl.replace(/\/$/, '');
    const url = `${base}/chat/completions`;
    const effort = opts?.mode === 'ultrathink' ? this.cfg.reasoning.ultrathink : this.cfg.reasoning.default;
    const body: Record<string, unknown> = {
      model: this.cfg.model.model,
      messages,
      temperature: opts?.temperature ?? 0.2,
      max_tokens: opts?.maxTokens ?? this.cfg.maxTokensPerCall,
    };
    // Pass reasoning effort when the upstream API understands it (ignored otherwise).
    if (effort) {
      body.reasoning_effort = effort;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.model.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.model.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Brain model HTTP ${res.status}: ${text.slice(0, 400)}`);
      }
      const json = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const content = json.choices?.[0]?.message?.content ?? '';
      return {
        content,
        usage: {
          promptTokens: json.usage?.prompt_tokens,
          completionTokens: json.usage?.completion_tokens,
          totalTokens: json.usage?.total_tokens,
        },
        raw: json,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Test double — returns scripted replies without network. */
export class MockBrainModelClient implements BrainModelClient {
  constructor(private replies: string[] | ((messages: BrainChatMessage[]) => string) = ['{"tool":"brain.noAction","args":{"reason":"nothing meaningful"}}']) {}

  readonly configured = true;
  private i = 0;

  async complete(messages: BrainChatMessage[]): Promise<BrainModelResult> {
    const content = typeof this.replies === 'function'
      ? this.replies(messages)
      : (this.replies[this.i++] ?? this.replies[this.replies.length - 1] ?? '');
    return { content, usage: { totalTokens: 64 } };
  }
}

/** Adapter so extraction can reuse the same Brain model (still one LLM). */
export function brainLlmFromClient(client: BrainModelClient): { complete(prompt: string): Promise<string> } {
  return {
    complete: async (prompt: string) => {
      if (!client.configured) {
        throw new Error('Brain model not configured');
      }
      const r = await client.complete([
        { role: 'system', content: 'Extract durable structured knowledge. Return JSON only when asked.' },
        { role: 'user', content: prompt },
      ], { mode: 'default', temperature: 0.1 });
      return r.content;
    },
  };
}
