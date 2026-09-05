export interface MemoryMetrics {
  memory_events_received: number;
  memory_events_dropped: number;
  memory_extraction_latency_ms_total: number;
  memory_extraction_count: number;
  memory_extraction_errors: number;
  memory_embeddings_generated: number;
  memory_embedding_latency_ms_total: number;
  memory_search_latency_ms_total: number;
  memory_search_count: number;
  memory_search_cache_hits: number;
  memory_search_cache_misses: number;
  memory_deduplication_count: number;
  memory_conflict_count: number;
  memory_consolidation_count: number;
  memory_queue_depth: number;
  memory_worker_active: number;
  memory_db_latency_ms_total: number;
  memory_db_count: number;
  memory_graph_latency_ms_total: number;
  memory_graph_count: number;
  memory_retries: number;
  memory_dlq: number;
  agent_tps_samples: number;
  agent_latency_ms_total: number;
}

export function createEmptyMemoryMetrics(): MemoryMetrics {
  return {
    memory_events_received: 0,
    memory_events_dropped: 0,
    memory_extraction_latency_ms_total: 0,
    memory_extraction_count: 0,
    memory_extraction_errors: 0,
    memory_embeddings_generated: 0,
    memory_embedding_latency_ms_total: 0,
    memory_search_latency_ms_total: 0,
    memory_search_count: 0,
    memory_search_cache_hits: 0,
    memory_search_cache_misses: 0,
    memory_deduplication_count: 0,
    memory_conflict_count: 0,
    memory_consolidation_count: 0,
    memory_queue_depth: 0,
    memory_worker_active: 0,
    memory_db_latency_ms_total: 0,
    memory_db_count: 0,
    memory_graph_latency_ms_total: 0,
    memory_graph_count: 0,
    memory_retries: 0,
    memory_dlq: 0,
    agent_tps_samples: 0,
    agent_latency_ms_total: 0,
  };
}

export class MemoryMetricsCollector {
  readonly metrics: MemoryMetrics = createEmptyMemoryMetrics();

  recordReceived(): void {
    this.metrics.memory_events_received += 1;
  }

  recordDropped(): void {
    this.metrics.memory_events_dropped += 1;
  }

  setQueueDepth(n: number): void {
    this.metrics.memory_queue_depth = n;
  }

  setWorkerActive(n: number): void {
    this.metrics.memory_worker_active = n;
  }

  recordExtraction(ms: number, error = false): void {
    this.metrics.memory_extraction_count += 1;
    this.metrics.memory_extraction_latency_ms_total += ms;
    if (error) {
      this.metrics.memory_extraction_errors += 1;
    }
  }

  recordEmbedding(ms: number): void {
    this.metrics.memory_embeddings_generated += 1;
    this.metrics.memory_embedding_latency_ms_total += ms;
  }

  recordSearch(ms: number, cacheHit: boolean): void {
    this.metrics.memory_search_count += 1;
    this.metrics.memory_search_latency_ms_total += ms;
    if (cacheHit) {
      this.metrics.memory_search_cache_hits += 1;
    } else {
      this.metrics.memory_search_cache_misses += 1;
    }
  }

  recordDedup(): void {
    this.metrics.memory_deduplication_count += 1;
  }

  recordConflict(): void {
    this.metrics.memory_conflict_count += 1;
  }

  recordConsolidation(): void {
    this.metrics.memory_consolidation_count += 1;
  }

  recordDb(ms: number): void {
    this.metrics.memory_db_count += 1;
    this.metrics.memory_db_latency_ms_total += ms;
  }

  recordGraph(ms: number): void {
    this.metrics.memory_graph_count += 1;
    this.metrics.memory_graph_latency_ms_total += ms;
  }

  recordRetry(): void {
    this.metrics.memory_retries += 1;
  }

  recordDlq(): void {
    this.metrics.memory_dlq += 1;
  }

  recordAgentTick(ms: number): void {
    this.metrics.agent_tps_samples += 1;
    this.metrics.agent_latency_ms_total += ms;
  }

  cacheHitRate(): number {
    const n =
      this.metrics.memory_search_cache_hits + this.metrics.memory_search_cache_misses;
    return n === 0 ? 0 : this.metrics.memory_search_cache_hits / n;
  }

  snapshot(): MemoryMetrics {
    return { ...this.metrics };
  }
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
