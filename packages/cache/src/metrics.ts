import type { CacheLayer } from './types.js';

export interface LayerCounters {
  hits: number;
  misses: number;
  tokensSaved: number;
}

export class CacheMetrics {
  private readonly layers = new Map<CacheLayer, LayerCounters>();
  private writes = 0;
  private invalidations = 0;

  private ensure(layer: CacheLayer): LayerCounters {
    let c = this.layers.get(layer);
    if (!c) {
      c = { hits: 0, misses: 0, tokensSaved: 0 };
      this.layers.set(layer, c);
    }
    return c;
  }

  recordHit(layer: CacheLayer, tokenEstimate = 0): void {
    const c = this.ensure(layer);
    c.hits += 1;
    c.tokensSaved += tokenEstimate;
  }

  recordMiss(layer: CacheLayer): void {
    this.ensure(layer).misses += 1;
  }

  recordWrite(): void {
    this.writes += 1;
  }

  recordInvalidation(): void {
    this.invalidations += 1;
  }

  hitRate(layer: CacheLayer): number {
    const c = this.layers.get(layer);
    if (!c) {
      return 0;
    }
    const total = c.hits + c.misses;
    return total === 0 ? 0 : c.hits / total;
  }

  snapshot(): {
    layers: Record<string, LayerCounters>;
    writes: number;
    invalidations: number;
    totalTokensSaved: number;
  } {
    const layers: Record<string, LayerCounters> = {};
    let totalTokensSaved = 0;
    for (const [k, v] of this.layers) {
      layers[k] = { ...v };
      totalTokensSaved += v.tokensSaved;
    }
    return {
      layers,
      writes: this.writes,
      invalidations: this.invalidations,
      totalTokensSaved,
    };
  }

  reset(): void {
    this.layers.clear();
    this.writes = 0;
    this.invalidations = 0;
  }
}
