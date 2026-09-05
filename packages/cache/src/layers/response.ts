import type { KvStore, ResponseCacheEntry } from '../types.js';
import { MemoryStore } from '../storage/memory.js';

export class ResponseCache {
  private readonly store: KvStore;
  private readonly ttlMs: number;

  constructor(opts?: { store?: KvStore; ttlMs?: number }) {
    this.store = opts?.store ?? new MemoryStore(2048);
    this.ttlMs = opts?.ttlMs ?? 24 * 60 * 60_000;
  }

  get(key: string): ResponseCacheEntry | undefined {
    const rec = this.store.get(key);
    if (!rec) {
      return undefined;
    }
    try {
      return JSON.parse(rec.value) as ResponseCacheEntry;
    } catch {
      this.store.delete(key);
      return undefined;
    }
  }

  set(entry: Omit<ResponseCacheEntry, 'createdAt' | 'expiresAt'> & {
    createdAt?: number;
    expiresAt?: number;
  }): ResponseCacheEntry {
    const now = Date.now();
    const full: ResponseCacheEntry = {
      ...entry,
      createdAt: entry.createdAt ?? now,
      expiresAt: entry.expiresAt ?? now + this.ttlMs,
    };
    this.store.set({
      key: full.key,
      value: JSON.stringify(full),
      expiresAt: full.expiresAt,
      meta: {
        layer: 'L4',
        workspaceId: full.workspaceId,
        createdAt: full.createdAt,
        expiresAt: full.expiresAt,
        confidence: full.confidence,
        tokenEstimate: full.tokenEstimate,
      },
    });
    return full;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
