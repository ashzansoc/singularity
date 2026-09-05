/**
 * Associate requirements with files using optional code search hits.
 * LangExtract does not search the repo — callers pass retrieval hits.
 */

import { newContextId, nowIso } from './ids.js';
import type { FileReference, ProjectState, Requirement } from './types.js';

export interface CodeHit {
  path: string;
  score?: number;
  reason?: string;
}

/**
 * Link active requirements to file paths from Singularity's code retrieval.
 */
export function associateRequirementsWithFiles(
  state: ProjectState,
  hits: CodeHit[],
  requirementIds?: string[],
): ProjectState {
  if (!hits.length) {
    return state;
  }
  const next = structuredClone(state);
  const reqs: Requirement[] = requirementIds?.length
    ? next.requirements.filter((r) => requirementIds.includes(r.id))
    : next.requirements.filter((r) => r.status === 'active');
  const now = nowIso();

  for (const hit of hits.slice(0, 24)) {
    const existing = next.important_files.find(
      (f) => f.path === hit.path && f.status === 'active',
    );
    const related = reqs.map((r) => r.id);
    if (existing) {
      existing.related_item_ids = [
        ...new Set([...existing.related_item_ids, ...related]),
      ];
      existing.reason = hit.reason ?? existing.reason;
      existing.updated_at = now;
    } else {
      const item: FileReference = {
        id: newContextId('file'),
        path: hit.path,
        reason: hit.reason ?? 'code retrieval',
        related_item_ids: related,
        status: 'active',
        confidence: hit.score ?? 0.7,
        confidence_category: 'medium',
        source_type: 'inferred',
        source: { type: 'code', file: hit.path },
        created_at: now,
        updated_at: now,
      };
      next.important_files.push(item);
    }
  }
  next.meta.version += 1;
  next.meta.last_updated = now;
  return next;
}
