import type { Intent, ModelSpec, RouteFeatures, TelemetryEvent, Tier } from './types.js';
import { tierIndex } from './types.js';
import { INTENT_DEFAULT_TIER } from './tiers.js';
import { isModelEligibleForTier } from './models/catalog.js';

export interface CapabilityRequirements {
  minTier: Tier;
  contextTokens: number;
  requiresTools: boolean;
  requiresVision: boolean;
  requiresJson: boolean;
  requiresStreaming: boolean;
}

/**
 * Raise minimum tier when context or capabilities exceed cheap models.
 */
export function resolveMinTier(intent: Intent, features: RouteFeatures): Tier {
  let min = INTENT_DEFAULT_TIER[intent];

  // Long context → at least T4
  if (features.contextTokens > 128_000) {
    min = higherTier(min, 'T4');
  } else if (features.contextTokens > 64_000) {
    min = higherTier(min, 'T2');
  }

  // Multi-file / premium tasks already mapped; bump for docker/k8s in chat
  if (features.keywords.docker || features.keywords.kubernetes) {
    min = higherTier(min, 'T5');
  }

  // Performance analysis / security → T5
  if (features.keywords.performance || features.keywords.security) {
    min = higherTier(min, 'T5');
  }

  // Vision needs a vision-capable tier model (filter handles capability; tier floor T4+)
  if (features.hasImages) {
    min = higherTier(min, 'T4');
  }

  // Agent with tools prefers T1+
  if (features.mode === 'agent' || features.requiresTools) {
    min = higherTier(min, 'T1');
  }

  return min;
}

function higherTier(a: Tier, b: Tier): Tier {
  return tierIndex(a) >= tierIndex(b) ? a : b;
}

export function buildRequirements(intent: Intent, features: RouteFeatures): CapabilityRequirements {
  return {
    minTier: resolveMinTier(intent, features),
    contextTokens: features.contextTokens,
    requiresTools: features.requiresTools || features.mode === 'agent',
    requiresVision: features.hasImages,
    requiresJson: features.requiresJson,
    requiresStreaming: features.requiresStreaming,
  };
}

export class CapabilityFilter {
  constructor(private readonly onTelemetry?: (event: TelemetryEvent) => void) {}

  filter(models: ModelSpec[], requirements: CapabilityRequirements): ModelSpec[] {
    const passed = models.filter((m) => {
      if (!isModelEligibleForTier(m, requirements.minTier)) {
        return false;
      }
      if (m.maxContext < requirements.contextTokens) {
        return false;
      }
      if (requirements.requiresTools && !m.supportsTools) {
        return false;
      }
      if (requirements.requiresVision && !m.supportsVision) {
        return false;
      }
      if (requirements.requiresJson && !m.supportsJson) {
        return false;
      }
      if (requirements.requiresStreaming && !m.supportsStreaming) {
        return false;
      }
      return true;
    });

    this.onTelemetry?.({
      type: 'filter',
      timestamp: Date.now(),
      payload: {
        inputCount: models.length,
        outputCount: passed.length,
        minTier: requirements.minTier,
        requiresTools: requirements.requiresTools,
        requiresVision: requirements.requiresVision,
      },
    });

    return passed;
  }
}
