import { createRequire } from 'node:module';

export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; exp: number }>();

  constructor(private readonly ttlMs = 60_000) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) {
      return undefined;
    }
    if (Date.now() > hit.exp) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.map.set(key, { value, exp: Date.now() + this.ttlMs });
  }

  invalidate(prefix?: string): void {
    if (!prefix) {
      this.map.clear();
      return;
    }
    for (const k of this.map.keys()) {
      if (k.startsWith(prefix)) {
        this.map.delete(k);
      }
    }
  }
}

/** Optional Redis L2. Falls back to in-process if REDIS is unset or the client is missing. */
export class RedisL2 {
  private client?: { get: (k: string) => Promise<string | null>; set: (k: string, v: string, mode: string, ttl: number) => Promise<unknown> };

  constructor(private readonly url?: string) {}

  async get(key: string): Promise<string | undefined> {
    const c = await this.connect();
    if (!c) {
      return undefined;
    }
    try {
      return (await c.get(key)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: string, ttlSec = 60): Promise<void> {
    const c = await this.connect();
    if (!c) {
      return;
    }
    try {
      await c.set(key, value, 'EX', ttlSec);
    } catch {
      /* ignore */
    }
  }

  private async connect() {
    if (!this.url) {
      return undefined;
    }
    if (this.client) {
      return this.client;
    }
    try {
      const req = createRequire(import.meta.url);
      const Redis = req('ioredis') as new (url: string) => NonNullable<RedisL2['client']>;
      this.client = new Redis(this.url);
      return this.client;
    } catch {
      return undefined;
    }
  }
}
