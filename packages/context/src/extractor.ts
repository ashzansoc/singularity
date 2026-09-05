/**
 * ContextExtractor abstraction — rest of Singularity never imports LangExtract.
 */

import type {
  ExtractionResult,
  ProjectState,
  SourceMetadata,
} from './types.js';

export interface ExtractOptions {
  text: string;
  source_metadata?: SourceMetadata;
  /** Compact summary of existing state for conflict/supersession awareness. */
  existing_state?: ProjectState | null;
  /** Complexity hint for model selection. */
  complexity?: 'simple' | 'complex' | 'large_document';
  timeout_ms?: number;
}

export interface ContextExtractor {
  extract(options: ExtractOptions): Promise<ExtractionResult>;
}

/** No-op extractor used when LangExtract is disabled. */
export class NoopContextExtractor implements ContextExtractor {
  async extract(_options: ExtractOptions): Promise<ExtractionResult> {
    return {
      delta: {},
      raw_item_count: 0,
      latency_ms: 0,
      used_fallback: true,
      error: 'context extractor disabled',
    };
  }
}
