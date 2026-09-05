import type { DurableRecord, KvStore } from '../types.js';

/**
 * In-memory LRU key-value store for hot cache entries.
 */
export class MemoryStore implements KvStore {
  private readonly map = new Map<string, DurableRecord>();

  constructor(private readonly maxEntries: number = 1024) {}

  get(key: string): DurableRecord | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  set(record: DurableRecord): void {
    if (this.map.has(record.key)) {
      this.map.delete(record.key);
    }
    this.map.set(record.key, record);
    this.evict();
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  keys(prefix?: string): string[] {
    const out: string[] = [];
    for (const key of this.map.keys()) {
      if (!prefix || key.startsWith(prefix)) {
        out.push(key);
      }
    }
    return out;
  }

  get size(): number {
    return this.map.size;
  }

  private evict(): void {
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.map.delete(oldest);
    }
  }
}
