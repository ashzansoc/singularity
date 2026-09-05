import type { Intent, ModelSpec, RouteFeatures, ScoredCandidate, Tier } from './types.js';
import { tierIndex } from './types.js';
import { recommendedRank, TIER_RECOMMENDED_MODELS } from './models/catalog.js';
import { callWhenScore, capabilityFitScore } from './modelMatcher.js';

/** Weights: quality includes capability fit; callWhen is first-class. */
export const SCORE_WEIGHTS = {
  quality: 0.3,
  cost: 0.15,
  latency: 0.15,
  reliability: 0.1,
  preference: 0.05,
  callWhen: 0.25,
} as const;

const TIER_QUALITY_PRIOR: Record<string, number> = {
  T0: 0.55,
  T1: 0.7,
  T2: 0.75,
  T3: 0.82,
  T4: 0.8,
  T5: 0.92,
  T6: 0.96,
};

const COST_CLASS_SCORE: Record<string, number> = {
  very_low: 1,
  low: 0.75,
  medium: 0.45,
  high: 0.15,
};

const SPEED_SCORE: Record<string, number> = {
  ultra_fast: 1,
  fast: 0.8,
  balanced: 0.55,
  premium: 0.3,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function costScore(model: ModelSpec, maxBlendedCost: number): number {
  const classScore = COST_CLASS_SCORE[model.capabilities.cost] ?? 0.5;
  const blended = model.costPer1MInput * 0.3 + model.costPer1MOutput * 0.7;
  if (maxBlendedCost <= 0 || blended <= 0) {
    return 1;
  }
  const relative = clamp01(1 - blended / maxBlendedCost);
  return clamp01(0.5 * classScore + 0.5 * relative);
}

function latencyScore(model: ModelSpec): number {
  return SPEED_SCORE[model.capabilities.speed] ?? clamp01(1 - model.latencyMsP50 / 2000);
}

function qualityScore(model: ModelSpec, intent: Intent, features: RouteFeatures): number {
  const specific = model.qualityByIntent[intent];
  const base = typeof specific === 'number' ? specific : (TIER_QUALITY_PRIOR[model.tier] ?? 0.7);
  const fit = capabilityFitScore(model, features, intent);
  return clamp01(0.55 * base + 0.45 * fit);
}

function recommendationBoost(modelId: string, targetTier: Tier): number {
  const list = TIER_RECOMMENDED_MODELS[targetTier];
  if (!list.includes(modelId)) {
    return 0;
  }
  const rank = recommendedRank(modelId, targetTier);
  return clamp01(1 - rank * 0.15);
}

export interface ScoreOptions {
  intent: Intent;
  features: RouteFeatures;
  targetTier?: Tier;
  userPreferenceModelIds?: string[];
  /** When true (e.g. confidence < 0.4), boost T6 frontier models. */
  lowConfidence?: boolean;
}

export function scoreCandidates(models: ModelSpec[], options: ScoreOptions): ScoredCandidate[] {
  if (models.length === 0) {
    return [];
  }

  const maxBlended = Math.max(
    ...models.map((m) => m.costPer1MInput * 0.3 + m.costPer1MOutput * 0.7),
    0.01,
  );
  const prefs = new Set(options.userPreferenceModelIds ?? []);
  const targetTier = options.targetTier ?? 'T1';

  const scored = models.map((model): ScoredCandidate => {
    const quality = qualityScore(model, options.intent, options.features);
    const cost = costScore(model, maxBlended);
    const latency = latencyScore(model);
    const reliability = clamp01(model.reliability);
    const userPref = prefs.has(model.id) ? 1 : 0;
    const rec = recommendationBoost(model.id, targetTier);
    let preference = clamp01(Math.max(userPref, rec));
    if (options.lowConfidence && (model.tier === 'T6' || model.subTier.startsWith('T6'))) {
      preference = 1;
    }

    const callWhen = clamp01((callWhenScore(model, options.features, options.intent) + 1) / 2);

    const score =
      SCORE_WEIGHTS.quality * quality +
      SCORE_WEIGHTS.cost * cost +
      SCORE_WEIGHTS.latency * latency +
      SCORE_WEIGHTS.reliability * reliability +
      SCORE_WEIGHTS.preference * preference +
      SCORE_WEIGHTS.callWhen * callWhen;

    return {
      model,
      score,
      breakdown: { quality, cost, latency, reliability, preference, callWhen },
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const ra = recommendedRank(a.model.id, targetTier);
    const rb = recommendedRank(b.model.id, targetTier);
    if (ra !== rb) {
      return ra - rb;
    }
    const tierDiff = tierIndex(a.model.tier) - tierIndex(b.model.tier);
    if (tierDiff !== 0) {
      return tierDiff;
    }
    return a.model.costPer1MInput - b.model.costPer1MInput;
  });

  return scored;
}
