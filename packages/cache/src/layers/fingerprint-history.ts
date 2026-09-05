/**
 * Durable per-session / workspace fingerprint history for context diffing
 * and cache invalidation.
 */

import { SqliteStore } from '../storage/sqlite.js';
import type { DurableRecord } from '../types.js';

export interface BlockFingerprintRecord {
  blockId: string;
  role: string;
  contentSha256: string;
  tokenCount: number;
  cacheBreakpoint?: boolean;
}

export interface FingerprintSnapshot {
  sessionId: string;
  workspaceId: string;
  promptSha256: string;
  recordedAt: number;
  blocks: BlockFingerprintRecord[];
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class FingerprintHistoryStore {
  private readonly store: SqliteStore;
  private readonly workspaceId: string;

  constructor(opts: { workspaceId: string; dir?: string }) {
    this.workspaceId = opts.workspaceId;
    this.store = new SqliteStore({
      dir: opts.dir,
      filename: 'singularity-fingerprints.json',
    });
  }

  key(sessionId: string): string {
    return `fp:${this.workspaceId}:${sessionId}:latest`;
  }

  getLatest(sessionId: string): FingerprintSnapshot | undefined {
    const rec = this.store.get(this.key(sessionId));
    if (!rec) {
      return undefined;
    }
    try {
      return JSON.parse(rec.value) as FingerprintSnapshot;
    } catch {
      return undefined;
    }
  }

  record(snapshot: FingerprintSnapshot): void {
    const now = Date.now();
    const record: DurableRecord = {
      key: this.key(snapshot.sessionId),
      value: JSON.stringify({ ...snapshot, recordedAt: now }),
      expiresAt: now + TTL_MS,
      meta: {
        layer: 'L1',
        workspaceId: this.workspaceId,
        createdAt: now,
        expiresAt: now + TTL_MS,
      },
    };
    this.store.set(record);
  }

  /**
   * Compare current block fingerprints against the last snapshot.
   */
  diff(
    sessionId: string,
    blocks: BlockFingerprintRecord[],
  ): { unchanged: string[]; changed: string[]; added: string[] } {
    const prev = this.getLatest(sessionId);
    if (!prev) {
      return {
        unchanged: [],
        changed: blocks.map((b) => b.blockId),
        added: blocks.map((b) => b.blockId),
      };
    }
    const prevById = new Map(prev.blocks.map((b) => [b.blockId, b]));
    const unchanged: string[] = [];
    const changed: string[] = [];
    const added: string[] = [];
    for (const b of blocks) {
      const p = prevById.get(b.blockId);
      if (!p) {
        added.push(b.blockId);
        changed.push(b.blockId);
      } else if (p.contentSha256 === b.contentSha256) {
        unchanged.push(b.blockId);
      } else {
        changed.push(b.blockId);
      }
    }
    return { unchanged, changed, added };
  }
}
