import { applyRoutingPolicy, decisionFromPolicy } from './policy.js';
import { parseRoutingSignals } from './parse.js';
import {
  EMPTY_ROUTING_SIGNALS,
  type LocalRoutingDecision,
  type RoutingSignals,
} from './schema.js';
import { applySafetyOverlay, detectSafetyOverrides } from './safety.js';
import { classifyWithQwenSidecar } from './sidecarClient.js';

export { warmupQwenClassifier, isQwenClassifierReady, disposeQwenClassifier } from './sidecarClient.js';
export { applyRoutingPolicy } from './policy.js';
export { detectSafetyOverrides } from './safety.js';
export { parseRoutingSignals } from './parse.js';
export {
  FLASH_MODEL_ID,
  PRO_MODEL_ID,
  LOCAL_CLASSIFIER_ID,
  EMPTY_ROUTING_SIGNALS,
  QWEN_CLASSIFIER_SYSTEM_PROMPT,
  type LocalRoutingDecision,
  type RoutingSignals,
} from './schema.js';

export interface ClassifyAndRouteOptions {
  /** Injected signals (tests). Skips the sidecar. */
  signals?: RoutingSignals;
  /** Skip sidecar even when no signals provided. */
  skipQwen?: boolean;
  timeoutMs?: number;
}

/**
 * Local perception → deterministic policy.
 * Never throws; failures fall back to safety+empty signals (caller may then
 * apply keyword routing).
 */
export async function classifyAndRoute(
  prompt: string,
  options: ClassifyAndRouteOptions = {},
): Promise<LocalRoutingDecision> {
  const started = Date.now();
  const safety = detectSafetyOverrides(prompt);

  if (options.signals) {
    const merged = applySafetyOverlay(options.signals, safety);
    const policy = applyRoutingPolicy(merged);
    return decisionFromPolicy(merged, policy, {
      fallback: false,
      latency_ms: Date.now() - started,
      source: 'qwen',
    });
  }

  if (options.skipQwen || process.env.SINGULARITY_QWEN_ROUTER !== '1') {
    const merged = applySafetyOverlay(EMPTY_ROUTING_SIGNALS, safety);
    const policy = applyRoutingPolicy(merged);
    return decisionFromPolicy(merged, policy, {
      fallback: true,
      latency_ms: Date.now() - started,
      source: safety.reasons.length ? 'safety' : 'rules',
    });
  }

  const sidecar = await classifyWithQwenSidecar(prompt, options.timeoutMs);
  if (!sidecar.ok || !sidecar.json) {
    const merged = applySafetyOverlay(EMPTY_ROUTING_SIGNALS, safety);
    const policy = applyRoutingPolicy(merged);
    const source =
      sidecar.error === 'timeout' ? 'timeout' : safety.reasons.length ? 'safety' : 'error';
    return decisionFromPolicy(merged, policy, {
      fallback: true,
      latency_ms: Date.now() - started,
      source,
    });
  }

  try {
    const parsed = parseRoutingSignals(sidecar.json);
    const merged = applySafetyOverlay(parsed, safety);
    const policy = applyRoutingPolicy(merged);
    return decisionFromPolicy(merged, policy, {
      fallback: false,
      latency_ms: Date.now() - started,
      source: 'qwen',
    });
  } catch {
    const merged = applySafetyOverlay(EMPTY_ROUTING_SIGNALS, safety);
    const policy = applyRoutingPolicy(merged);
    return decisionFromPolicy(merged, policy, {
      fallback: true,
      latency_ms: Date.now() - started,
      source: 'error',
    });
  }
}

/** Sync policy path used by unit tests (no sidecar). */
export function routeWithSignals(
  prompt: string,
  signals: RoutingSignals = EMPTY_ROUTING_SIGNALS,
): LocalRoutingDecision {
  const safety = detectSafetyOverrides(prompt);
  const merged = applySafetyOverlay(signals, safety);
  const policy = applyRoutingPolicy(merged);
  return decisionFromPolicy(merged, policy, {
    fallback: false,
    latency_ms: 0,
    source: 'qwen',
  });
}
