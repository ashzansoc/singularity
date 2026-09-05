/**
 * Configurable correlation / retention windows. No hardcoded lookbacks in callers.
 */

export interface CorrelationPolicy {
  deploymentLookbackMs: number;
  metricLookbackMs: number;
  incidentWindowMs: number;
  maxPayloadBytes: number;
  retentionRawMs: number;
  retentionEvidenceMs: number;
  matchFloor: number;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function envMs(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) {
    return fallback;
  }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const DEFAULT_CORRELATION_POLICY: CorrelationPolicy = {
  deploymentLookbackMs: 30 * 60 * 1000,
  metricLookbackMs: 30 * 60 * 1000,
  incidentWindowMs: 30 * 60 * 1000,
  maxPayloadBytes: 64 * 1024,
  retentionRawMs: 7 * DAY,
  retentionEvidenceMs: 90 * DAY,
  matchFloor: 0.25,
};

export function readCorrelationPolicy(overrides?: Partial<CorrelationPolicy>): CorrelationPolicy {
  const base: CorrelationPolicy = {
    deploymentLookbackMs: envMs(
      'PRODUCTION_DEPLOYMENT_LOOKBACK_MS',
      DEFAULT_CORRELATION_POLICY.deploymentLookbackMs,
    ),
    metricLookbackMs: envMs(
      'PRODUCTION_METRIC_LOOKBACK_MS',
      DEFAULT_CORRELATION_POLICY.metricLookbackMs,
    ),
    incidentWindowMs: envMs(
      'PRODUCTION_INCIDENT_WINDOW_MS',
      DEFAULT_CORRELATION_POLICY.incidentWindowMs,
    ),
    maxPayloadBytes: envMs(
      'PRODUCTION_MAX_PAYLOAD_BYTES',
      DEFAULT_CORRELATION_POLICY.maxPayloadBytes,
    ),
    retentionRawMs: envMs(
      'PRODUCTION_RETENTION_RAW_MS',
      DEFAULT_CORRELATION_POLICY.retentionRawMs,
    ),
    retentionEvidenceMs: envMs(
      'PRODUCTION_RETENTION_EVIDENCE_MS',
      DEFAULT_CORRELATION_POLICY.retentionEvidenceMs,
    ),
    matchFloor: DEFAULT_CORRELATION_POLICY.matchFloor,
  };
  return { ...base, ...overrides };
}

export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export function confidenceBand(score: number): ConfidenceBand {
  if (score >= 0.8) {
    return 'HIGH';
  }
  if (score >= 0.5) {
    return 'MEDIUM';
  }
  if (score >= 0.25) {
    return 'LOW';
  }
  return 'UNKNOWN';
}
