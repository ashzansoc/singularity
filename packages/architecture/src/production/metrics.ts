import type { ArchitectureMetricsCollector } from '../metrics.js';

/** Production Awareness counters live on ArchitectureMetricsCollector — never the Coding Agent. */
export function recordProductionReceived(metrics?: ArchitectureMetricsCollector): void {
  metrics?.recordProductionReceived();
}

export function recordProductionProcessed(
  metrics: ArchitectureMetricsCollector | undefined,
  latency_ms: number,
  correlated: boolean,
): void {
  metrics?.recordProductionProcessed(latency_ms, correlated);
}

export function recordProductionFailed(metrics?: ArchitectureMetricsCollector): void {
  metrics?.recordProductionFailed();
}

export function recordProductionGraphWriteFailure(metrics?: ArchitectureMetricsCollector): void {
  metrics?.recordProductionGraphWriteFailure();
}
