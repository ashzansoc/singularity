/**
 * Context Intelligence via OpenRouter Nemotron 3 Nano (direct OpenRouter, not TokenRouter).
 */

import { DEFAULT_NEURAL_RELAY_MODEL } from '../flags.js';
import {
  getDirectOpenRouterApiKey,
  getDirectOpenRouterBaseUrl,
} from '../openrouterEnv.js';
import { estimateTokens } from '../hash.js';
import type {
  AnalyzeContextOptions,
  AnalyzeContextResult,
  ContextCandidate,
} from '../types.js';
import type { ContextIntelligenceModel } from './ContextIntelligenceModel.js';
import {
  CONTEXT_INTELLIGENCE_SYSTEM,
  CONTEXT_RESOLUTION_JSON_SCHEMA,
  emptyResolution,
  parseContextResolution,
} from './schema.js';

export interface OpenRouterNemotronProviderConfig {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function formatCandidates(cands: ContextCandidate[]): string {
  return cands
    .map((c, i) =>
      [
        `${i + 1}. ${c.path} [${c.language}] score=${c.score.toFixed(2)} reasons=${c.reasons.join(',')}`,
        `   symbols: ${c.symbols.slice(0, 12).join(', ') || '—'}`,
        `   imports: ${c.imports.slice(0, 8).join(', ') || '—'}`,
        `   importedBy: ${c.importedBy.slice(0, 6).join(', ') || '—'}`,
        `   tests: ${c.tests.slice(0, 4).join(', ') || '—'}`,
        `   summary: ${c.summary.slice(0, 180)}`,
        `   excerpt: ${c.excerpt.slice(0, 280).replace(/\s+/g, ' ')}`,
      ].join('\n'),
    )
    .join('\n');
}

export class OpenRouterNemotronProvider implements ContextIntelligenceModel {
  readonly id: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: OpenRouterNemotronProviderConfig = {}) {
    this.model = config.model ?? DEFAULT_NEURAL_RELAY_MODEL;
    this.id = this.model;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? getDirectOpenRouterBaseUrl()).replace(
      /\/$/,
      '',
    );
    this.fetchFn = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 20_000;
  }

  async analyzeContext(
    options: AnalyzeContextOptions,
  ): Promise<AnalyzeContextResult> {
    const started = Date.now();
    const apiKey = this.apiKey ?? getDirectOpenRouterApiKey();
    if (!apiKey) {
      return {
        resolution: emptyResolution(options.task),
        source: 'unavailable',
        inputTokens: 0,
        outputTokens: 0,
        ttftMs: 0,
        tokensPerSecond: 0,
        latencyMs: Date.now() - started,
      };
    }

    const user = [
      `TASK:\n${options.task}`,
      `CANDIDATES (${options.candidates.length}):`,
      formatCandidates(options.candidates),
    ].join('\n\n');

    const inputEst = estimateTokens(CONTEXT_INTELLIGENCE_SYSTEM + user);
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', () => controller.abort(), {
          once: true,
        });
      }
    }

    try {
      const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://singularity.local',
          'X-Title': 'Singularity Neural Relay',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 1_200,
          reasoning: { enabled: false, exclude: true },
          include_reasoning: false,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'context_resolution',
              strict: true,
              schema: CONTEXT_RESOLUTION_JSON_SCHEMA,
            },
          },
          messages: [
            { role: 'system', content: CONTEXT_INTELLIGENCE_SYSTEM },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });
      const text = await res.text();
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        return {
          resolution: emptyResolution(options.task),
          source: 'error',
          inputTokens: inputEst,
          outputTokens: 0,
          ttftMs: latencyMs,
          tokensPerSecond: 0,
          latencyMs,
          raw: text.slice(0, 400),
        };
      }
      const json = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
        };
      };
      const raw = String(json.choices?.[0]?.message?.content ?? '');
      const parsed = parseContextResolution(raw, options.task);
      const inTok = json.usage?.prompt_tokens ?? inputEst;
      const outTok = json.usage?.completion_tokens ?? estimateTokens(raw);
      const sec = Math.max(0.001, latencyMs / 1000);
      return {
        resolution: parsed ?? emptyResolution(options.task),
        source: parsed ? 'llm' : 'error',
        inputTokens: inTok,
        outputTokens: outTok,
        ttftMs: latencyMs,
        tokensPerSecond: outTok / sec,
        latencyMs,
        raw,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const msg = err instanceof Error ? err.message : String(err);
      const unavailable = /abort|timeout|fetch|network|ENOTFOUND/i.test(msg);
      return {
        resolution: emptyResolution(options.task),
        source: unavailable ? 'unavailable' : 'error',
        inputTokens: inputEst,
        outputTokens: 0,
        ttftMs: latencyMs,
        tokensPerSecond: 0,
        latencyMs,
        raw: msg,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
