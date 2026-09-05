/**
 * Hybrid Brain search: vector cosine + label matching + one-hop graph
 * expansion, re-ranked by importance/recency. Supports metadata filters.
 */

import type { BrainEntity } from './types.js';
import type { SearchFilters, SearchResult } from './types.js';
import type { BrainStore } from './store.js';
import { cosine } from './embeddings.js';

export interface SearchDeps {
  store: BrainStore;
  embed: (texts: string[]) => Promise<number[][]>;
}

export async function brainSearch(query: string, deps: SearchDeps, filters?: SearchFilters): Promise<SearchResult[]> {
  const limit = filters?.limit ?? 12;
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const [queryVec] = await deps.embed([trimmed]);
  const scored = new Map<string, SearchResult>();

  // 1) Vector pass over embedded entities.
  const embedded = deps.store.allEntitiesWithEmbeddings();
  for (const { entity, embedding } of embedded) {
    if (!passesFilters(entity, filters)) {
      continue;
    }
    const sim = cosine(queryVec ?? [], embedding);
    if (sim > 0.12) {
      scored.set(entity.id, {
        entity,
        score: sim,
        snippet: entity.description,
        via: 'vector',
      });
    }
  }

  // 2) Label/token pass — catches exact names even when embeddings are hash-based.
  const tokens = trimmed.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  for (const entity of topEntityPool(deps.store, filters)) {
    const label = entity.label.toLowerCase();
    let hit = 0;
    for (const t of tokens) {
      if (label === t || label.includes(t)) {
        hit += t === label ? 1 : 0.6;
      }
    }
    if (hit > 0) {
      const existing = scored.get(entity.id);
      const score = Math.min(1.4, hit);
      if (existing) {
        existing.score = Math.max(existing.score, score);
      } else {
        scored.set(entity.id, { entity, score, snippet: entity.description, via: 'label' });
      }
    }
  }

  // 3) Graph expansion: pull in strong neighbors of the top hits.
  const top = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 5);
  for (const hit of top) {
    for (const n of deps.store.neighborsOf(hit.entity.id)) {
      if (scored.has(n.entity.id) || !passesFilters(n.entity, filters)) {
        continue;
      }
      scored.set(n.entity.id, {
        entity: n.entity,
        score: hit.score * 0.55 * n.rel.confidence,
        snippet: n.entity.description,
        via: 'graph',
      });
    }
  }

  const now = Date.now();
  return [...scored.values()]
    .map((r) => ({
      ...r,
      score: r.score * (0.6 + 0.4 * r.entity.importance) * recencyBoost(r.entity.lastSeenAt, now),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function topEntityPool(store: BrainStore, filters?: SearchFilters): BrainEntity[] {
  // Label scan over the most relevant slice of the graph keeps this cheap.
  return store.topEntities(filters?.projectId ? 4000 : 1500, filters);
}

function passesFilters(entity: BrainEntity, filters?: SearchFilters): boolean {
  if (!filters) {
    return true;
  }
  if (filters.types?.length && !filters.types.includes(entity.type)) {
    return false;
  }
  if (filters.since !== undefined && entity.lastSeenAt < filters.since) {
    return false;
  }
  if (filters.until !== undefined && entity.lastSeenAt > filters.until) {
    return false;
  }
  if (filters.clusters?.length) {
    const cluster = entity.cluster ?? '';
    if (!filters.clusters.includes(cluster)) {
      return false;
    }
  }
  return true;
}

/** Half-life of ~45 days; knowledge touched recently ranks a bit higher. */
function recencyBoost(lastSeenAt: number, now: number): number {
  const days = Math.max(0, (now - lastSeenAt) / 86_400_000);
  return Math.pow(0.5, days / 45) * 0.3 + 0.7;
}
