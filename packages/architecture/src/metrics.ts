export interface ArchitectureMetrics {
  architecture_event_queue_depth: number;
  architecture_processing_latency_ms_total: number;
  architecture_processing_count: number;
  adr_extraction_latency_ms_total: number;
  adr_extraction_count: number;
  embedding_latency_ms_total: number;
  embedding_count: number;
  sqlite_latency_ms_total: number;
  sqlite_count: number;
  architecture_context_cache_hits: number;
  architecture_context_cache_misses: number;
  architecture_context_generation_time_ms_total: number;
  events_dropped: number;
  events_retried: number;
  coding_request_latency_with_architecture_ms_total: number;
  coding_request_latency_without_architecture_ms_total: number;
  coding_request_count_with_architecture: number;
  coding_request_count_without_architecture: number;
  production_events_received: number;
  production_events_processed: number;
  production_events_failed: number;
  production_events_correlated: number;
  production_events_unmatched: number;
  production_queue_lag: number;
  production_processing_latency_ms_total: number;
  production_graph_write_failures: number;
  architecture_drift_scans_total: number;
  architecture_drift_findings_total: number;
  architecture_drift_scan_latency_ms_total: number;
  reactive_debug_jobs_total: number;
  reactive_debug_job_latency_ms_total: number;
  correlations_created_total: number;
  impact_analysis_queued_total: number;
  impact_analysis_completed_total: number;
  impact_analysis_failed_total: number;
  impact_analysis_duration_ms_total: number;
  impact_analysis_cache_hits: number;
  impact_analysis_cache_misses: number;
  impact_analysis_affected_symbols: number;
  impact_analysis_affected_services: number;
  impact_analysis_severity_low: number;
  impact_analysis_severity_medium: number;
  impact_analysis_severity_high: number;
  impact_analysis_severity_critical: number;
  risk_assessments_total: number;
  risk_assessments_by_level_low: number;
  risk_assessments_by_level_medium: number;
  risk_assessments_by_level_high: number;
  risk_assessments_by_level_critical: number;
  risk_assessment_latency_ms_total: number;
  risk_assessment_failures: number;
  risk_assessment_staleness: number;
  risk_factor_distribution: Record<string, number>;
  risk_recomputation_total: number;
  risk_cache_hits: number;
  risk_cache_misses: number;
  risk_cache_hit_rate: number;
}

export function createEmptyArchitectureMetrics(): ArchitectureMetrics {
  return {
    architecture_event_queue_depth: 0,
    architecture_processing_latency_ms_total: 0,
    architecture_processing_count: 0,
    adr_extraction_latency_ms_total: 0,
    adr_extraction_count: 0,
    embedding_latency_ms_total: 0,
    embedding_count: 0,
    sqlite_latency_ms_total: 0,
    sqlite_count: 0,
    architecture_context_cache_hits: 0,
    architecture_context_cache_misses: 0,
    architecture_context_generation_time_ms_total: 0,
    events_dropped: 0,
    events_retried: 0,
    coding_request_latency_with_architecture_ms_total: 0,
    coding_request_latency_without_architecture_ms_total: 0,
    coding_request_count_with_architecture: 0,
    coding_request_count_without_architecture: 0,
    production_events_received: 0,
    production_events_processed: 0,
    production_events_failed: 0,
    production_events_correlated: 0,
    production_events_unmatched: 0,
    production_queue_lag: 0,
    production_processing_latency_ms_total: 0,
    production_graph_write_failures: 0,
    architecture_drift_scans_total: 0,
    architecture_drift_findings_total: 0,
    architecture_drift_scan_latency_ms_total: 0,
    reactive_debug_jobs_total: 0,
    reactive_debug_job_latency_ms_total: 0,
    correlations_created_total: 0,
    impact_analysis_queued_total: 0,
    impact_analysis_completed_total: 0,
    impact_analysis_failed_total: 0,
    impact_analysis_duration_ms_total: 0,
    impact_analysis_cache_hits: 0,
    impact_analysis_cache_misses: 0,
    impact_analysis_affected_symbols: 0,
    impact_analysis_affected_services: 0,
    impact_analysis_severity_low: 0,
    impact_analysis_severity_medium: 0,
    impact_analysis_severity_high: 0,
    impact_analysis_severity_critical: 0,
    risk_assessments_total: 0,
    risk_assessments_by_level_low: 0,
    risk_assessments_by_level_medium: 0,
    risk_assessments_by_level_high: 0,
    risk_assessments_by_level_critical: 0,
    risk_assessment_latency_ms_total: 0,
    risk_assessment_failures: 0,
    risk_assessment_staleness: 0,
    risk_factor_distribution: {},
    risk_recomputation_total: 0,
    risk_cache_hits: 0,
    risk_cache_misses: 0,
    risk_cache_hit_rate: 0,
  };
}

export class ArchitectureMetricsCollector {
  readonly metrics: ArchitectureMetrics = createEmptyArchitectureMetrics();

  setQueueDepth(n: number): void {
    this.metrics.architecture_event_queue_depth = n;
  }

  recordProcessing(latency_ms: number): void {
    this.metrics.architecture_processing_count += 1;
    this.metrics.architecture_processing_latency_ms_total += latency_ms;
  }

  recordExtraction(latency_ms: number): void {
    this.metrics.adr_extraction_count += 1;
    this.metrics.adr_extraction_latency_ms_total += latency_ms;
  }

  recordEmbedding(latency_ms: number): void {
    this.metrics.embedding_count += 1;
    this.metrics.embedding_latency_ms_total += latency_ms;
  }

  recordSqlite(latency_ms: number): void {
    this.metrics.sqlite_count += 1;
    this.metrics.sqlite_latency_ms_total += latency_ms;
  }

  recordCacheHit(): void {
    this.metrics.architecture_context_cache_hits += 1;
  }

  recordCacheMiss(): void {
    this.metrics.architecture_context_cache_misses += 1;
  }

  recordContextGeneration(latency_ms: number): void {
    this.metrics.architecture_context_generation_time_ms_total += latency_ms;
  }

  recordDropped(): void {
    this.metrics.events_dropped += 1;
  }

  recordRetry(): void {
    this.metrics.events_retried += 1;
  }

  recordProductionReceived(): void {
    this.metrics.production_events_received += 1;
  }

  recordProductionProcessed(latency_ms: number, correlated: boolean): void {
    this.metrics.production_events_processed += 1;
    this.metrics.production_processing_latency_ms_total += latency_ms;
    if (correlated) {
      this.metrics.production_events_correlated += 1;
    } else {
      this.metrics.production_events_unmatched += 1;
    }
  }

  recordProductionFailed(): void {
    this.metrics.production_events_failed += 1;
  }

  recordProductionGraphWriteFailure(): void {
    this.metrics.production_graph_write_failures += 1;
  }

  setProductionQueueLag(n: number): void {
    this.metrics.production_queue_lag = n;
  }

  recordCorrelationCreated(): void {
    this.metrics.correlations_created_total += 1;
  }

  recordDriftScan(latency_ms: number, findings: number): void {
    this.metrics.architecture_drift_scans_total += 1;
    this.metrics.architecture_drift_scan_latency_ms_total += latency_ms;
    this.metrics.architecture_drift_findings_total += findings;
  }

  recordReactiveDebug(latency_ms: number): void {
    this.metrics.reactive_debug_jobs_total += 1;
    this.metrics.reactive_debug_job_latency_ms_total += latency_ms;
  }

  recordImpactQueued(): void {
    this.metrics.impact_analysis_queued_total += 1;
  }

  recordImpactCompleted(
    latency_ms: number,
    extra?: { symbols?: number; services?: number; severity?: string },
  ): void {
    this.metrics.impact_analysis_completed_total += 1;
    this.metrics.impact_analysis_duration_ms_total += latency_ms;
    if (extra?.symbols != null) {
      this.metrics.impact_analysis_affected_symbols += extra.symbols;
    }
    if (extra?.services != null) {
      this.metrics.impact_analysis_affected_services += extra.services;
    }
    const sev = extra?.severity;
    if (sev === 'low') {
      this.metrics.impact_analysis_severity_low += 1;
    } else if (sev === 'medium') {
      this.metrics.impact_analysis_severity_medium += 1;
    } else if (sev === 'high') {
      this.metrics.impact_analysis_severity_high += 1;
    } else if (sev === 'critical') {
      this.metrics.impact_analysis_severity_critical += 1;
    }
  }

  recordImpactFailed(): void {
    this.metrics.impact_analysis_failed_total += 1;
  }

  recordImpactCacheHit(): void {
    this.metrics.impact_analysis_cache_hits += 1;
  }

  recordImpactCacheMiss(): void {
    this.metrics.impact_analysis_cache_misses += 1;
  }

  recordRiskQueued(): void {
    this.metrics.risk_assessments_total += 1;
  }

  recordRiskCompleted(latency_ms: number, extra?: { level?: string; factors?: string[] }): void {
    this.metrics.risk_assessment_latency_ms_total += latency_ms;
    const lvl = extra?.level?.toLowerCase();
    if (lvl === 'low') {
      this.metrics.risk_assessments_by_level_low += 1;
    } else if (lvl === 'medium') {
      this.metrics.risk_assessments_by_level_medium += 1;
    } else if (lvl === 'high') {
      this.metrics.risk_assessments_by_level_high += 1;
    } else if (lvl === 'critical') {
      this.metrics.risk_assessments_by_level_critical += 1;
    }
    for (const t of extra?.factors ?? []) {
      this.metrics.risk_factor_distribution[t] = (this.metrics.risk_factor_distribution[t] ?? 0) + 1;
    }
  }

  recordRiskFailed(): void {
    this.metrics.risk_assessment_failures += 1;
  }

  recordRiskStale(): void {
    this.metrics.risk_assessment_staleness += 1;
  }

  recordRiskRecompute(): void {
    this.metrics.risk_recomputation_total += 1;
  }

  recordRiskCacheHit(): void {
    this.metrics.risk_cache_hits += 1;
  }

  recordRiskCacheMiss(): void {
    this.metrics.risk_cache_misses += 1;
  }

  recordCodingLatency(opts: { withArchitecture: boolean; latency_ms: number }): void {
    if (opts.withArchitecture) {
      this.metrics.coding_request_count_with_architecture += 1;
      this.metrics.coding_request_latency_with_architecture_ms_total +=
        opts.latency_ms;
    } else {
      this.metrics.coding_request_count_without_architecture += 1;
      this.metrics.coding_request_latency_without_architecture_ms_total +=
        opts.latency_ms;
    }
  }

  cacheHitRate(): number {
    const hits = this.metrics.architecture_context_cache_hits;
    const miss = this.metrics.architecture_context_cache_misses;
    const n = hits + miss;
    return n === 0 ? 0 : hits / n;
  }

  snapshot(): ArchitectureMetrics {
    const hits = this.metrics.risk_cache_hits;
    const miss = this.metrics.risk_cache_misses;
    const n = hits + miss;
    this.metrics.risk_cache_hit_rate = n === 0 ? 0 : hits / n;
    return { ...this.metrics, risk_factor_distribution: { ...this.metrics.risk_factor_distribution } };
  }
}

/** Rough token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
