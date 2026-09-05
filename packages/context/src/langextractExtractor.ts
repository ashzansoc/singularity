/**
 * LangExtract-backed ContextExtractor.
 * Talks only to the Python sidecar; never exposes LangExtract types.
 */

import type { ContextExtractor, ExtractOptions } from './extractor.js';
import { HeuristicContextExtractor } from './heuristicExtractor.js';
import { redactSecrets } from './redact.js';
import {
  LangExtractSidecarClient,
  type SidecarConfig,
} from './sidecarClient.js';
import type { ExtractionResult } from './types.js';

export interface LangExtractContextExtractorOptions {
  sidecar?: SidecarConfig;
  /** Fall back to heuristic extractor on failure (default true). */
  fallback?: boolean;
  /** Injected client for tests. */
  client?: LangExtractSidecarClient;
  /** Injected fallback extractor for tests. */
  fallbackExtractor?: ContextExtractor;
}

export class LangExtractContextExtractor implements ContextExtractor {
  private readonly client: LangExtractSidecarClient;
  private readonly fallback: boolean;
  private readonly fallbackExtractor: ContextExtractor;

  constructor(options: LangExtractContextExtractorOptions = {}) {
    this.client = options.client ?? new LangExtractSidecarClient(options.sidecar);
    this.fallback = options.fallback !== false;
    this.fallbackExtractor =
      options.fallbackExtractor ?? new HeuristicContextExtractor();
  }

  async extract(options: ExtractOptions): Promise<ExtractionResult> {
    const t0 = Date.now();
    const text = redactSecrets(options.text);
    const safeOptions = { ...options, text };

    try {
      const res = await this.client.extract(
        {
          text,
          source_metadata: options.source_metadata,
          complexity: options.complexity,
        },
        options.existing_state,
      );

      if (res.ok && res.delta) {
        return {
          delta: res.delta,
          raw_item_count: res.raw_item_count ?? 0,
          provider: res.provider ?? 'langextract',
          model: res.model,
          input_tokens: res.input_tokens,
          output_tokens: res.output_tokens,
          latency_ms: Date.now() - t0,
          used_fallback: false,
        };
      }

      if (!this.fallback) {
        return {
          delta: {},
          raw_item_count: 0,
          latency_ms: Date.now() - t0,
          used_fallback: false,
          error: res.error ?? 'langextract_failed',
        };
      }

      const fb = await this.fallbackExtractor.extract(safeOptions);
      return {
        ...fb,
        latency_ms: Date.now() - t0,
        used_fallback: true,
        error: res.error,
      };
    } catch (err) {
      if (!this.fallback) {
        return {
          delta: {},
          raw_item_count: 0,
          latency_ms: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      const fb = await this.fallbackExtractor.extract(safeOptions);
      return {
        ...fb,
        latency_ms: Date.now() - t0,
        used_fallback: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  dispose(): void {
    this.client.dispose();
  }
}
