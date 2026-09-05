import type { MemoryRecord } from '../domain/memory.js';
import { nowIso, newVersionId, type MemoryVersion } from '../domain/memory.js';
import { sourceBeats } from '../domain/provenance.js';
import { entityOverlap } from './dedup.js';

function techs(text: string): Set<string> {
  const s = new Set<string>();
  const re =
    /\b(auth0|firebase|postgres(?:ql)?|mongodb|mysql|redis|kafka|celery|temporal)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = m[0].toLowerCase();
    s.add(n.startsWith('postgres') ? 'postgresql' : n);
  }
  return s;
}

export function detectsTechConflict(existingText: string, incomingText: string): boolean {
  const a = techs(existingText);
  const b = techs(incomingText);
  if (a.size === 0 || b.size === 0) {
    return false;
  }
  if ([...a].every((x) => b.has(x)) && [...b].every((x) => a.has(x))) {
    return false;
  }
  return true;
}

export function isConflict(existing: MemoryRecord, incoming: MemoryRecord): boolean {
  if (existing.project_id !== incoming.project_id || existing.status !== 'ACTIVE') {
    return false;
  }
  const decisionish =
    existing.type.includes('ARCHITECTURAL') ||
    incoming.type.includes('ARCHITECTURAL') ||
    existing.type === 'TECHNOLOGY_CHOICE' ||
    incoming.type === 'TECHNOLOGY_CHOICE' ||
    incoming.type === 'REJECTED_APPROACH';
  if (!decisionish) {
    return false;
  }
  const overlap =
    entityOverlap(existing.entities, incoming.entities) >= 0.3 ||
    detectsTechConflict(
      `${existing.title} ${existing.content}`,
      `${incoming.title} ${incoming.content}`,
    );
  return overlap && detectsTechConflict(`${existing.title} ${existing.content}`, `${incoming.title} ${incoming.content}`);
}

export function shouldSupersede(existing: MemoryRecord, incoming: MemoryRecord): boolean {
  if (!isConflict(existing, incoming)) {
    return false;
  }
  if (sourceBeats(incoming.source_type, existing.source_type)) {
    return true;
  }
  return incoming.confidence >= existing.confidence;
}

export function applySupersession(
  existing: MemoryRecord,
  incoming: MemoryRecord,
): { old: MemoryRecord; next: MemoryRecord; version: MemoryVersion } {
  const ts = nowIso();
  return {
    old: { ...existing, status: 'SUPERSEDED', updated_at: ts },
    next: { ...incoming, supersedes_id: existing.id, status: 'ACTIVE', updated_at: ts },
    version: {
      id: newVersionId(),
      memory_id: existing.id,
      content: existing.content,
      reason: existing.reason,
      status: existing.status,
      source_id: existing.source_id,
      created_at: ts,
    },
  };
}

export function findConflict(
  incoming: MemoryRecord,
  existing: MemoryRecord[],
): MemoryRecord | undefined {
  return existing.find((m) => m.id !== incoming.id && isConflict(m, incoming));
}
