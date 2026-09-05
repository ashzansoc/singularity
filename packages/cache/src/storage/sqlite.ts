import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DurableRecord, KvStore } from '../types.js';

interface SqliteDump {
  schemaVersion: number;
  records: DurableRecord[];
}

/**
 * Durable KV store with SQLite-compatible logical schema.
 * v1 persists JSON documents (zero native deps); swap to better-sqlite3 later.
 */
export class SqliteStore implements KvStore {
  private readonly map = new Map<string, DurableRecord>();
  private readonly filePath: string | undefined;
  private dirty = false;

  constructor(opts?: { dir?: string; filename?: string; schemaVersion?: number }) {
    if (opts?.dir) {
      mkdirSync(opts.dir, { recursive: true });
      this.filePath = join(opts.dir, opts.filename ?? 'singularity-cache.json');
      this.load();
    }
  }

  get(key: string): DurableRecord | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      this.dirty = true;
      this.flush();
      return undefined;
    }
    return entry;
  }

  set(record: DurableRecord): void {
    this.map.set(record.key, record);
    this.dirty = true;
    this.flush();
  }

  delete(key: string): void {
    if (this.map.delete(key)) {
      this.dirty = true;
      this.flush();
    }
  }

  clear(): void {
    this.map.clear();
    this.dirty = true;
    this.flush();
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

  /** Recover from truncated / corrupt file by resetting to empty. */
  recover(): void {
    try {
      this.load();
    } catch {
      this.map.clear();
      this.dirty = true;
      this.flush();
    }
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) {
      return;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      if (!raw.trim()) {
        return;
      }
      const dump = JSON.parse(raw) as SqliteDump;
      this.map.clear();
      const now = Date.now();
      for (const rec of dump.records ?? []) {
        if (rec.expiresAt > now) {
          this.map.set(rec.key, rec);
        }
      }
    } catch {
      // Corruption recovery: start empty, do not throw.
      this.map.clear();
    }
  }

  private flush(): void {
    if (!this.filePath || !this.dirty) {
      return;
    }
    const dump: SqliteDump = {
      schemaVersion: 1,
      records: [...this.map.values()],
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(dump), 'utf8');
    this.dirty = false;
  }
}
