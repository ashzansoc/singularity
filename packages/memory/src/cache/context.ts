import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ProjectSnapshot } from '../domain/snapshot.js';

function hashProject(projectId: string): string {
  return createHash('sha256').update(projectId).digest('hex').slice(0, 16);
}

function snapshotPath(dir: string, projectId: string): string {
  return join(dir, `${hashProject(projectId)}.json`);
}

/**
 * Disk + memory cache for coding-plane memory context lookup.
 * Extension host reads this when intelligence runs in the worker process.
 */
export class MemoryContextCache {
  private readonly mem = new Map<string, ProjectSnapshot>();
  readonly dir: string;

  constructor(workspaceRoot: string) {
    this.dir = join(workspaceRoot, '.singularity', 'memory', 'cache');
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  get(projectId: string): ProjectSnapshot | undefined {
    const hit = this.mem.get(projectId);
    if (hit) {
      return hit;
    }
    try {
      const p = snapshotPath(this.dir, projectId);
      if (!existsSync(p)) {
        return undefined;
      }
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as ProjectSnapshot;
      this.mem.set(projectId, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  set(projectId: string, snap: ProjectSnapshot): void {
    this.mem.set(projectId, snap);
    try {
      writeFileSync(snapshotPath(this.dir, projectId), JSON.stringify(snap));
    } catch {
      /* still in memory */
    }
  }
}

/** Coding-plane lookup: memory/disk cache only. Never searches SQLite/vectors. */
export function lookupCachedPromptBlock(cache: MemoryContextCache, projectId: string): string {
  try {
    return cache.get(projectId)?.prompt_block ?? '';
  } catch {
    return '';
  }
}
