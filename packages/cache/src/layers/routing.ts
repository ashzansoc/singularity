import type { KvStore, RoutingDecisionLike, RoutingStats } from '../types.js';
import { MemoryStore } from '../storage/memory.js';

const MAX_LATENCY_SAMPLES = 32;

export class RoutingCache {
  private readonly store: KvStore;
  private readonly ttlMs: number;

  constructor(opts?: { store?: KvStore; ttlMs?: number }) {
    this.store = opts?.store ?? new MemoryStore(1024);
    this.ttlMs = opts?.ttlMs ?? 60_000;
  }

  get(routeKey: string): RoutingStats | undefined {
    const rec = this.store.get(routeKey);
    if (!rec) {
      return undefined;
    }
    try {
      const stats = JSON.parse(rec.value) as RoutingStats;
      return {
        ...stats,
        decision: { ...stats.decision, fromCache: true },
      };
    } catch {
      this.store.delete(routeKey);
      return undefined;
    }
  }

  setDecision(
    routeKey: string,
    workspaceId: string,
    decision: RoutingDecisionLike,
  ): RoutingStats {
    const existing = this.getRaw(routeKey);
    const now = Date.now();
    const stats: RoutingStats = {
      routeKey,
      workspaceId,
      decision: { ...decision, fromCache: false },
      latencyMs: existing?.latencyMs ?? [],
      costUsd: existing?.costUsd ?? 0,
      qualityScore: existing?.qualityScore ?? null,
      failures: existing?.failures ?? 0,
      timeouts: existing?.timeouts ?? 0,
      updatedAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.persist(stats);
    return stats;
  }

  recordOutcome(
    routeKey: string,
    workspaceId: string,
    outcome: {
      decision?: RoutingDecisionLike;
      latencyMs?: number;
      costUsd?: number;
      qualityScore?: number;
      kind?: 'success' | 'failure' | 'timeout';
    },
  ): RoutingStats {
    const existing = this.getRaw(routeKey);
    const now = Date.now();
    const latencyMs = [...(existing?.latencyMs ?? [])];
    if (typeof outcome.latencyMs === 'number') {
      latencyMs.push(outcome.latencyMs);
      while (latencyMs.length > MAX_LATENCY_SAMPLES) {
        latencyMs.shift();
      }
    }

    const stats: RoutingStats = {
      routeKey,
      workspaceId,
      decision: outcome.decision
        ? { ...outcome.decision, fromCache: false }
        : (existing?.decision ?? { modelId: 'unknown' }),
      latencyMs,
      costUsd: (existing?.costUsd ?? 0) + (outcome.costUsd ?? 0),
      qualityScore:
        outcome.qualityScore !== undefined
          ? outcome.qualityScore
          : (existing?.qualityScore ?? null),
      failures: (existing?.failures ?? 0) + (outcome.kind === 'failure' ? 1 : 0),
      timeouts: (existing?.timeouts ?? 0) + (outcome.kind === 'timeout' ? 1 : 0),
      updatedAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.persist(stats);
    return stats;
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private getRaw(routeKey: string): RoutingStats | undefined {
    const rec = this.store.get(routeKey);
    if (!rec) {
      return undefined;
    }
    try {
      return JSON.parse(rec.value) as RoutingStats;
    } catch {
      return undefined;
    }
  }

  private persist(stats: RoutingStats): void {
    this.store.set({
      key: stats.routeKey,
      value: JSON.stringify(stats),
      expiresAt: stats.expiresAt,
      meta: {
        layer: 'L7',
        workspaceId: stats.workspaceId,
        createdAt: stats.updatedAt,
        expiresAt: stats.expiresAt,
      },
    });
  }
}

/**
 * Adapter mirroring `@singularity/router` InMemoryRouteCache get/set/clear API.
 */
export function createRoutingCacheAdapter(cache: RoutingCache, workspaceId: string) {
  return {
    get(key: string): RoutingDecisionLike | undefined {
      return cache.get(key)?.decision;
    },
    set(key: string, decision: RoutingDecisionLike): void {
      cache.setDecision(key, workspaceId, decision);
    },
    clear(): void {
      cache.clear();
    },
    get size(): number {
      return cache.size;
    },
  };
}
