import {
  FLASH_MODEL_ID,
  LOCAL_CLASSIFIER_ID,
  RISK_SIGNAL_KEYS,
  type LocalRoutingDecision,
  type RiskSignalKey,
  type RoutingSignals,
} from './schema.js';

export interface PolicyResult {
  modelId: typeof FLASH_MODEL_ID;
  reason: string;
  risk_signals: RiskSignalKey[];
}

/**
 * Deterministic Flash/Pro policy. Qwen signals are advisory input only.
 */
export function applyRoutingPolicy(signals: RoutingSignals): PolicyResult {
  const risk_signals = RISK_SIGNAL_KEYS.filter((k) => signals[k]);
  const hits: string[] = [];

  if (signals.security_related) {
    hits.push('security_related=true');
  }
  if (signals.financial_related) {
    hits.push('financial_related=true');
  }
  if (signals.data_integrity_related) {
    hits.push('data_integrity_related=true');
  }
  if (signals.investigation_required) {
    hits.push('investigation_required=true');
  }
  if (signals.architecture_related) {
    hits.push('architecture_related=true');
  }
  if (signals.ambiguity === 'high') {
    hits.push('ambiguity=high');
  }
  if (signals.complexity === 'high') {
    hits.push('complexity=high');
  }
  if (signals.verification_required && signals.complexity !== 'low') {
    hits.push('verification_required=true');
  }
  if (
    signals.production_related
    && (signals.complexity === 'high' || signals.ambiguity !== 'low')
  ) {
    hits.push('production_related=true');
  }

  // DeepSeek V4 Pro is disabled — always Flash-0731.
  return {
    modelId: FLASH_MODEL_ID,
    reason: hits.length > 0 ? `flash-only:${hits.join(',')}` : 'deterministic-low-risk',
    risk_signals,
  };
}

export function decisionFromPolicy(
  signals: RoutingSignals,
  policy: PolicyResult,
  extra: Pick<LocalRoutingDecision, 'fallback' | 'latency_ms' | 'source'>,
): LocalRoutingDecision {
  return {
    router: LOCAL_CLASSIFIER_ID,
    intent: signals.intent,
    complexity: signals.complexity,
    risk_signals: policy.risk_signals,
    scope: signals.scope,
    final_model: policy.modelId,
    routing_reason: policy.reason,
    fallback: extra.fallback,
    latency_ms: extra.latency_ms,
    signals,
    source: extra.source,
  };
}
