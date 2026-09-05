/**
 * Level 3 — Context segmentation (router-facing mirror).
 * Full segment set aligns with @singularity/prompt Canonical Context.
 * Only changed segments are marked dirty; unchanged keep hash + token count.
 */

import { estimateTokens, hashContent } from '@singularity/prompt';

export type ContextSegmentId =
  | 'system'
  | 'repository'
  | 'conversation'
  | 'retrieval'
  | 'terminal'
  | 'diagnostics'
  | 'memory'
  | 'agent'
  | 'selection'
  | 'currentFile'
  | 'userPrompt'
  /** @deprecated Prefer userPrompt — kept for existing callers. */
  | 'currentPrompt';

export interface ContextSegment {
  id: ContextSegmentId;
  hash: string;
  version: number;
  tokenCount: number;
  /** True when content changed since the previous turn. */
  dirty: boolean;
  cacheKey?: string;
}

export interface SegmentedContextState {
  conversationId: string;
  segments: Record<ContextSegmentId, ContextSegment>;
  totalTokens: number;
  unchangedTokens: number;
  rebuiltTokens: number;
}

export interface SegmentInput {
  system?: string;
  repository?: string;
  conversation?: string;
  retrieval?: string;
  terminal?: string;
  diagnostics?: string;
  memory?: string;
  agent?: string;
  selection?: string;
  currentFile?: string;
  userPrompt?: string;
  /** @deprecated Prefer userPrompt. */
  currentPrompt?: string;
  /** Optional explicit token estimates (chars/4 fallback). */
  tokenEstimates?: Partial<Record<ContextSegmentId, number>>;
}

const SEGMENT_IDS: ContextSegmentId[] = [
  'system',
  'repository',
  'conversation',
  'retrieval',
  'terminal',
  'diagnostics',
  'memory',
  'agent',
  'selection',
  'currentFile',
  'userPrompt',
  'currentPrompt',
];

export { hashContent, estimateTokens };

function emptySegment(id: ContextSegmentId): ContextSegment {
  return { id, hash: '', version: 0, tokenCount: 0, dirty: true };
}

export function createSegmentedContext(conversationId: string): SegmentedContextState {
  const segments = Object.fromEntries(
    SEGMENT_IDS.map((id) => [id, emptySegment(id)]),
  ) as Record<ContextSegmentId, ContextSegment>;
  return {
    conversationId,
    segments,
    totalTokens: 0,
    unchangedTokens: 0,
    rebuiltTokens: 0,
  };
}

/**
 * Update segment hashes from structured context. Only dirty segments need rebuild
 * in a Context Builder; unchanged token counts are preserved for affinity/cache.
 */
export function updateContextSegments(
  prev: SegmentedContextState | undefined,
  conversationId: string,
  input: SegmentInput,
): SegmentedContextState {
  const base = prev?.conversationId === conversationId ? prev : createSegmentedContext(conversationId);
  const userPrompt = input.userPrompt ?? input.currentPrompt ?? '';
  const values: Record<ContextSegmentId, string> = {
    system: input.system ?? '',
    repository: input.repository ?? '',
    conversation: input.conversation ?? '',
    retrieval: input.retrieval ?? '',
    terminal: input.terminal ?? '',
    diagnostics: input.diagnostics ?? '',
    memory: input.memory ?? '',
    agent: input.agent ?? '',
    selection: input.selection ?? '',
    currentFile: input.currentFile ?? '',
    userPrompt,
    currentPrompt: userPrompt,
  };

  let unchangedTokens = 0;
  let rebuiltTokens = 0;
  let totalTokens = 0;
  const segments = { ...base.segments };

  for (const id of SEGMENT_IDS) {
    const content = values[id];
    const hash = hashContent(content);
    const tokens =
      input.tokenEstimates?.[id] ??
      (content ? estimateTokens(content) : 0);
    const prevSeg = base.segments[id];
    const dirty = !prevSeg || prevSeg.hash !== hash;
    const version = dirty ? (prevSeg?.version ?? 0) + 1 : prevSeg.version;
    segments[id] = {
      id,
      hash,
      version,
      tokenCount: tokens,
      dirty,
      cacheKey: dirty ? undefined : prevSeg.cacheKey ?? `${id}:${hash}`,
    };
    totalTokens += tokens;
    if (dirty) {
      rebuiltTokens += tokens;
    } else {
      unchangedTokens += tokens;
    }
  }

  return {
    conversationId,
    segments,
    totalTokens,
    unchangedTokens,
    rebuiltTokens,
  };
}
