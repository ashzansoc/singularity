import type { FallbackReason, ModelSpec, RouteDecision, ScoredCandidate } from './types.js';
import { nextTier, tierIndex } from './types.js';

/**
 * Build ordered fallback model ids: remaining same-tier (by score), then higher tiers.
 */
export function buildFallbackChain(
  winner: ModelSpec,
  scored: ScoredCandidate[],
  allModels: ModelSpec[],
): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([winner.id]);

  // Rest of scored candidates (already filtered & sorted)
  for (const c of scored) {
    if (!seen.has(c.model.id)) {
      chain.push(c.model.id);
      seen.add(c.model.id);
    }
  }

  // Escalate through higher tiers not already included
  let tier = nextTier(winner.tier);
  while (tier) {
    const tierModels = allModels
      .filter((m) => m.tier === tier && !seen.has(m.id))
      .sort((a, b) => a.costPer1MInput - b.costPer1MInput);
    for (const m of tierModels) {
      chain.push(m.id);
      seen.add(m.id);
    }
    tier = nextTier(tier);
  }

  return chain;
}

export function escalateDecision(
  decision: RouteDecision,
  models: ModelSpec[],
  reason: FallbackReason,
): RouteDecision | undefined {
  const nextId = decision.fallbackChain[0];
  if (!nextId) {
    return undefined;
  }

  const model = models.find((m) => m.id === nextId);
  if (!model) {
    return undefined;
  }

  const remaining = decision.fallbackChain.slice(1);
  return {
    ...decision,
    model,
    tier: model.tier,
    subTier: model.subTier,
    score: decision.score,
    candidates: [
      { modelId: model.id, score: decision.score, subTier: model.subTier },
      ...decision.candidates.filter((c) => c.modelId !== model.id),
    ],
    fallbackChain: remaining,
    fromCache: false,
    systemPromptHint: `${decision.systemPromptHint} [escalated:${reason}]`,
  };
}

export function canEscalateToTier(from: ModelSpec, to: ModelSpec): boolean {
  return tierIndex(to.tier) >= tierIndex(from.tier);
}
