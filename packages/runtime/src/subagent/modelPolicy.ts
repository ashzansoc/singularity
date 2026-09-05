/**
 * Map ModelPolicy → preferred tier / modelId for LlmPort.
 */

import type { Tier } from '@singularity/router';
import type { ModelPolicy, ModelStrategy } from './types.js';
import { strategyToTier } from './roleCatalog.js';

export interface ResolvedModelRouting {
  preferredTier: Tier;
  modelId?: string;
  temperature: number;
  intent?: string;
}

export function resolveModelRouting(policy?: ModelPolicy): ResolvedModelRouting {
  if (!policy) {
    return { preferredTier: 'T3', temperature: 0.2, intent: 'AGENT' };
  }

  const preferredTier =
    policy.preferredTier ?? strategyToTier(policy.strategy);
  const modelId =
    policy.strategy === 'custom'
      ? policy.preferredModels?.[0]
      : policy.preferredModels?.[0];

  return {
    preferredTier,
    modelId,
    temperature: temperatureForStrategy(policy.strategy),
    intent: intentForStrategy(policy.strategy),
  };
}

function temperatureForStrategy(strategy: ModelStrategy): number {
  switch (strategy) {
    case 'fast':
      return 0.1;
    case 'reasoning':
      return 0.2;
    case 'coding':
      return 0.15;
    case 'vision':
      return 0.2;
    case 'custom':
      return 0.2;
    case 'balanced':
    default:
      return 0.2;
  }
}

function intentForStrategy(strategy: ModelStrategy): string {
  switch (strategy) {
    case 'fast':
      return 'SEARCH';
    case 'reasoning':
      return 'ARCHITECTURE';
    case 'coding':
      return 'EDIT';
    case 'vision':
      return 'REVIEW';
    default:
      return 'AGENT';
  }
}
