/**
 * Shared disk-cache helpers for architecture/memory context lookup
 * when intelligence planes run in the out-of-process worker.
 */

import {
  ArchitectureContextCache,
  lookupCachedContextBlock,
} from '@singularity/architecture';
import { MemoryContextCache, lookupCachedPromptBlock } from '@singularity/memory';

const archCaches = new Map<string, ArchitectureContextCache>();
const memCaches = new Map<string, MemoryContextCache>();

function archCache(workspaceRoot: string): ArchitectureContextCache {
  let cache = archCaches.get(workspaceRoot);
  if (!cache) {
    cache = new ArchitectureContextCache(workspaceRoot);
    archCaches.set(workspaceRoot, cache);
  }
  return cache;
}

function memCache(workspaceRoot: string): MemoryContextCache {
  let cache = memCaches.get(workspaceRoot);
  if (!cache) {
    cache = new MemoryContextCache(workspaceRoot);
    memCaches.set(workspaceRoot, cache);
  }
  return cache;
}

export function lookupRemoteArchitectureContext(workspaceRoot: string, task: string): string {
  try {
    return lookupCachedContextBlock(archCache(workspaceRoot), task);
  } catch {
    return '';
  }
}

export function lookupRemoteMemoryContext(workspaceRoot: string, projectId: string): string {
  try {
    return lookupCachedPromptBlock(memCache(workspaceRoot), projectId);
  } catch {
    return '';
  }
}
