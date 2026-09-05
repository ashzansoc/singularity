import { sha256 } from './keys.js';
import type { ContextFingerprintInput } from './types.js';

export interface ContextBlockFingerprintInput {
  blockId: string;
  role: string;
  content: string;
  tokenCount: number;
  cacheBreakpoint?: boolean;
}

export interface ContextBlockFingerprint {
  blockId: string;
  role: string;
  contentSha256: string;
  tokenCount: number;
  cacheBreakpoint?: boolean;
}

function sortedJoin(values: string[] | undefined): string {
  if (!values || values.length === 0) {
    return '';
  }
  return [...values].sort().join('\n');
}

/**
 * Build a stable context fingerprint for AI prompt inputs.
 * Format: `fp_v1:<sha256_hex>`
 */
export function buildContextFingerprint(input: ContextFingerprintInput): string {
  const canonical = [
    input.workspaceId,
    input.branch,
    input.settingsVersion,
    input.depsVersion ?? '',
    sortedJoin(input.openFiles),
    input.activeUri ?? '',
    input.selectionHash ?? '',
    input.diagnosticsHash ?? '',
    input.gitDiffHash ?? '',
    input.terminalTailHash ?? '',
    input.clipboardHash ?? '',
    sortedJoin(input.imageIds),
    sortedJoin(input.toolOutputHashes),
    input.memoryDigest ?? '',
  ].join('\0');

  return `fp_v1:${sha256(canonical)}`;
}

/** Per-block SHA256 fingerprints for context economy / diffing. */
export function buildBlockFingerprints(
  blocks: ContextBlockFingerprintInput[],
): ContextBlockFingerprint[] {
  return blocks.map((b) => ({
    blockId: b.blockId,
    role: b.role,
    contentSha256: sha256(b.content),
    tokenCount: b.tokenCount,
    cacheBreakpoint: b.cacheBreakpoint,
  }));
}

/** Aggregate fingerprint over an ordered list of block content hashes. */
export function aggregateBlockFingerprint(blocks: ContextBlockFingerprint[]): string {
  const canonical = blocks
    .map((b) => `${b.role}:${b.contentSha256}:${b.tokenCount}`)
    .join('\0');
  return `blocks_v1:${sha256(canonical)}`;
}
