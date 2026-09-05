/**
 * Importance scoring for the semantic knowledge graph.
 *
 * Goals:
 * - Decisions / architecture / experiments rise naturally
 * - File leaves stay smaller
 * - Project root is NOT a visual hub (low type weight + degree soft-cap)
 * - Centrality emerges from meaningful degree, not star-wiring
 */

import type { BrainEntity } from './types.js';

const TYPE_WEIGHT: Record<string, number> = {
  decision: 0.95,
  architecture: 0.92,
  tradeoff: 0.88,
  experiment: 0.82,
  evaluation: 0.8,
  hypothesis: 0.75,
  learning: 0.85,
  lesson: 0.85,
  goal: 0.78,
  outcome: 0.75,
  constraint: 0.72,
  requirement: 0.7,
  solution: 0.72,
  service: 0.68,
  layer: 0.65,
  technology: 0.55,
  concept: 0.62,
  topic: 0.55,
  fact: 0.48,
  observation: 0.42,
  assumption: 0.55,
  bug: 0.6,
  preference: 0.5,
  person: 0.45,
  code: 0.38,
  document: 0.35,
  repository: 0.4,
  task: 0.5,
  plan: 0.55,
  change: 0.45,
  event: 0.3,
  experience: 0.45,
  conversation: 0.22,
  // Project is a root entity, not a visual hub.
  project: 0.28,
};

const HALF_LIFE_DAYS = 120;
/** Soft-cap so a star hub cannot dominate PageRank-like degree score. */
const DEGREE_SOFT_CAP = 18;

export function computeImportance(entity: BrainEntity, now = Date.now()): number {
  const cappedDegree = Math.min(entity.degree, DEGREE_SOFT_CAP);
  const degreeScore = Math.min(1, Math.log2(1 + cappedDegree) / 5);
  const typeScore = TYPE_WEIGHT[entity.type] ?? 0.5;
  const ageDays = Math.max(0, (now - entity.lastSeenAt) / 86_400_000);
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  const confidence = entity.confidence;

  // Authority boosts validated / decision knowledge over raw observations.
  const authorityBoost =
    entity.authority === 'validated' ? 0.12
      : entity.authority === 'decision' ? 0.1
        : entity.authority === 'fact' ? 0.05
          : entity.authority === 'hypothesis' ? 0.02
            : entity.authority === 'observation' ? -0.02
              : 0;

  const base =
    0.35 * degreeScore +
    0.35 * typeScore +
    0.15 * confidence +
    0.1 * recency +
    authorityBoost;

  // Floors for engineering-memory nodes so they stay findable.
  let floor = 0;
  if (entity.type === 'decision' || entity.type === 'architecture') {
    floor = 0.5;
  } else if (entity.type === 'learning' || entity.type === 'lesson' || entity.type === 'experiment') {
    floor = 0.42;
  } else if (entity.type === 'project') {
    // Hard ceiling so the project root never looks like the brain's center.
    return Math.min(0.42, Math.max(0.15, base));
  }

  return Math.min(1, Math.max(floor, base));
}

export function refreshImportance(entities: BrainEntity[], now = Date.now()): Array<BrainEntity & { importance: number }> {
  return entities.map((e) => ({ ...e, importance: computeImportance(e, now) }));
}
