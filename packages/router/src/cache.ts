import type { RouteDecision } from './types.js';

export interface CacheEntry {
  decision: RouteDecision;
  expiresAt: number;
}

export class InMemoryRouteCache {
  private readonly store = new Map<string, CacheEntry>();

  constructor(private readonly ttlMs: number = 60_000) {}

  get(key: string): RouteDecision | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return { ...entry.decision, fromCache: true };
  }

  set(key: string, decision: RouteDecision): void {
    this.store.set(key, {
      decision: { ...decision, fromCache: false },
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

/** Bucket prompt length so near-identical requests share a cache key. */
function promptLengthBucket(chars: number): number {
  if (chars < 200) {
    return 0;
  }
  if (chars < 1000) {
    return 1;
  }
  if (chars < 5000) {
    return 2;
  }
  if (chars < 20_000) {
    return 3;
  }
  return 4;
}

export function buildCacheKey(parts: {
  intent: string;
  mode: string;
  promptCharCount: number;
  hasImages: boolean;
  requiresTools: boolean;
  contextBucket: number;
}): string {
  return [
    parts.intent,
    parts.mode,
    promptLengthBucket(parts.promptCharCount),
    parts.hasImages ? '1' : '0',
    parts.requiresTools ? '1' : '0',
    parts.contextBucket,
  ].join('|');
}

/** Cache chat/autocomplete only; skip agent and tool-heavy requests. */
export function shouldCacheRoute(mode: string, requiresTools: boolean): boolean {
  if (mode === 'agent') {
    return false;
  }
  if (requiresTools) {
    return false;
  }
  return mode === 'chat' || mode === 'autocomplete' || mode === 'inline' || mode === 'terminal';
}
