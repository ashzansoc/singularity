import { shortHash } from '../keys.js';

export type MemoryNamespace =
  | 'user'
  | 'project'
  | 'repository'
  | 'session'
  | 'agent'
  | 'benchmark'
  | 'failure';

export interface MemoryRecord {
  key: string;
  value: string;
  updatedAt: number;
}

/**
 * Persistent memory hubs are distinct from caches:
 * memory stores knowledge/preferences; cache stores reusable computation.
 */
export interface MemoryHub {
  get(namespace: MemoryNamespace, key: string): MemoryRecord | undefined;
  set(namespace: MemoryNamespace, key: string, value: string): void;
  delete(namespace: MemoryNamespace, key: string): void;
  list(namespace: MemoryNamespace): MemoryRecord[];
  /** Compact digest for inclusion in context fingerprints. */
  digest(namespaces?: MemoryNamespace[]): string;
  clear(namespace?: MemoryNamespace): void;
}

export class InMemoryMemoryHub implements MemoryHub {
  private readonly data = new Map<string, MemoryRecord>();

  private id(namespace: MemoryNamespace, key: string): string {
    return `${namespace}:${key}`;
  }

  get(namespace: MemoryNamespace, key: string): MemoryRecord | undefined {
    return this.data.get(this.id(namespace, key));
  }

  set(namespace: MemoryNamespace, key: string, value: string): void {
    this.data.set(this.id(namespace, key), {
      key,
      value,
      updatedAt: Date.now(),
    });
  }

  delete(namespace: MemoryNamespace, key: string): void {
    this.data.delete(this.id(namespace, key));
  }

  list(namespace: MemoryNamespace): MemoryRecord[] {
    const prefix = `${namespace}:`;
    const out: MemoryRecord[] = [];
    for (const [k, v] of this.data) {
      if (k.startsWith(prefix)) {
        out.push(v);
      }
    }
    return out;
  }

  digest(namespaces?: MemoryNamespace[]): string {
    const ns =
      namespaces ??
      (['user', 'project', 'session', 'agent', 'failure'] as MemoryNamespace[]);
    const parts: string[] = [];
    for (const n of ns) {
      for (const rec of this.list(n).sort((a, b) => a.key.localeCompare(b.key))) {
        parts.push(`${n}:${rec.key}=${rec.value}`);
      }
    }
    return parts.length === 0 ? '' : shortHash(parts.join('\0'));
  }

  clear(namespace?: MemoryNamespace): void {
    if (!namespace) {
      this.data.clear();
      return;
    }
    const prefix = `${namespace}:`;
    for (const k of [...this.data.keys()]) {
      if (k.startsWith(prefix)) {
        this.data.delete(k);
      }
    }
  }
}
