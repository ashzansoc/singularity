/**
 * Observability for the Context Engine (no secrets / project content).
 */

export interface ContextEngineMetrics {
  extraction_count: number;
  extraction_latency_ms_total: number;
  extraction_failures: number;
  extraction_tokens_in: number;
  extraction_tokens_out: number;
  structured_items_created: number;
  structured_items_updated: number;
  structured_items_superseded: number;
  context_retrieval_latency_ms_total: number;
  context_retrieval_count: number;
  raw_context_tokens: number;
  retrieved_context_tokens: number;
  estimated_token_reduction: number;
}

export function createEmptyMetrics(): ContextEngineMetrics {
  return {
    extraction_count: 0,
    extraction_latency_ms_total: 0,
    extraction_failures: 0,
    extraction_tokens_in: 0,
    extraction_tokens_out: 0,
    structured_items_created: 0,
    structured_items_updated: 0,
    structured_items_superseded: 0,
    context_retrieval_latency_ms_total: 0,
    context_retrieval_count: 0,
    raw_context_tokens: 0,
    retrieved_context_tokens: 0,
    estimated_token_reduction: 0,
  };
}

export class MetricsCollector {
  readonly metrics: ContextEngineMetrics = createEmptyMetrics();

  recordExtraction(opts: {
    ok: boolean;
    latency_ms: number;
    input_tokens?: number;
    output_tokens?: number;
  }): void {
    this.metrics.extraction_count += 1;
    this.metrics.extraction_latency_ms_total += opts.latency_ms;
    if (!opts.ok) {
      this.metrics.extraction_failures += 1;
    }
    this.metrics.extraction_tokens_in += opts.input_tokens ?? 0;
    this.metrics.extraction_tokens_out += opts.output_tokens ?? 0;
  }

  recordMerge(opts: {
    created: number;
    updated: number;
    superseded: number;
  }): void {
    this.metrics.structured_items_created += opts.created;
    this.metrics.structured_items_updated += opts.updated;
    this.metrics.structured_items_superseded += opts.superseded;
  }

  recordRetrieval(opts: {
    latency_ms: number;
    raw_tokens: number;
    retrieved_tokens: number;
  }): void {
    this.metrics.context_retrieval_count += 1;
    this.metrics.context_retrieval_latency_ms_total += opts.latency_ms;
    this.metrics.raw_context_tokens += opts.raw_tokens;
    this.metrics.retrieved_context_tokens += opts.retrieved_tokens;
    const saved = Math.max(0, opts.raw_tokens - opts.retrieved_tokens);
    this.metrics.estimated_token_reduction += saved;
  }

  snapshot(): ContextEngineMetrics {
    return { ...this.metrics };
  }
}

/** Rough token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
