import { buildContextFingerprint } from '../fingerprint.js';
import type { ContextFingerprintInput, KvStore } from '../types.js';
import { MemoryStore } from '../storage/memory.js';

export class ContextCache {
  private readonly store: KvStore;

  constructor(store?: KvStore) {
    this.store = store ?? new MemoryStore(256);
  }

  fingerprint(input: ContextFingerprintInput): string {
    const fp = buildContextFingerprint(input);
    const now = Date.now();
    this.store.set({
      key: `fpmeta:${input.workspaceId}:${fp}`,
      value: fp,
      expiresAt: now + 60_000,
      meta: {
        layer: 'L1',
        workspaceId: input.workspaceId,
        createdAt: now,
        expiresAt: now + 60_000,
      },
    });
    return fp;
  }

  clear(): void {
    this.store.clear();
  }
}
