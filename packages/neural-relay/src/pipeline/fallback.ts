import type { ContextCandidate, ContextResolution, RepoIndexPort } from '../types.js';
import { deterministicResolution } from '../intelligence/schema.js';

/**
 * Tight ranked fallback — top-N candidates only. Prefer this over broader
 * context so the stable DeepSeek prefix stays cacheable across turns.
 */
export function tightContextResolution(
  task: string,
  candidates: ContextCandidate[],
  limit = 8,
): ContextResolution {
  const paths = candidates.slice(0, limit).map((c) => c.path);
  const res = deterministicResolution(task, paths);
  res.confidence = 0.55;
  res.task_understanding = `${task.slice(0, 200)} (tight retrieval)`;
  return res;
}

/** @deprecated Prefer {@link tightContextResolution} — kept for tests. */
export function broaderContextResolution(
  task: string,
  index: RepoIndexPort,
  candidates: ContextCandidate[],
  limit = 8,
): ContextResolution {
  const paths = candidates.slice(0, limit).map((c) => c.path);
  if (!paths.length) {
    const all = index.listFileMetadata().slice(0, limit).map((f) => f.path);
    return deterministicResolution(task, all);
  }
  return tightContextResolution(task, candidates, limit);
}

export function filterResolutionToIndex(
  resolution: ContextResolution,
  index: RepoIndexPort,
): ContextResolution {
  const known = new Set(index.listFileMetadata().map((f) => f.path));
  return {
    ...resolution,
    relevant_files: resolution.relevant_files.filter((f) => known.has(f.path)),
  };
}
