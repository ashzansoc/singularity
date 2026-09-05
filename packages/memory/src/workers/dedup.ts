import type { MemoryRecord } from '../domain/memory.js';
import { tokenize, jaccard } from '../retrieval/ranker.js';
import { cosine } from '../storage/vector.js';
import type { MemoryEmbeddingRow } from '../storage/repository.js';

export function entityOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) {
    return 0;
  }
  const bs = new Set(b.map((x) => x.toLowerCase()));
  let n = 0;
  for (const x of a) {
    if (bs.has(x.toLowerCase())) {
      n += 1;
    }
  }
  return n / Math.max(a.length, b.length);
}

export function isDuplicate(a: MemoryRecord, b: MemoryRecord, embA?: number[], embB?: number[]): boolean {
  if (a.project_id !== b.project_id) {
    return false;
  }
  if (a.type !== b.type && !(relatedTypes(a.type, b.type))) {
    return false;
  }
  const kw = jaccard(tokenize(a.content), tokenize(b.content));
  const ent = entityOverlap(a.entities, b.entities);
  const vec = embA && embB ? cosine(embA, embB) : 0;
  return kw >= 0.5 || (ent >= 0.5 && kw >= 0.2) || (vec >= 0.92 && kw >= 0.2);
}

function relatedTypes(a: string, b: string): boolean {
  const group = new Set(['FACT', 'TECHNOLOGY_CHOICE', 'ARCHITECTURAL_DECISION', 'PROJECT_CONVENTION']);
  return group.has(a) && group.has(b);
}

export function findDuplicate(
  candidate: MemoryRecord,
  existing: MemoryRecord[],
  embeddings: MemoryEmbeddingRow[],
): MemoryRecord | undefined {
  const candEmb = embeddings.find((e) => e.memory_id === candidate.id)?.embedding;
  for (const m of existing) {
    if (m.id === candidate.id || m.status !== 'ACTIVE') {
      continue;
    }
    const emb = embeddings.find((e) => e.memory_id === m.id)?.embedding;
    if (isDuplicate(candidate, m, candEmb, emb)) {
      return m;
    }
  }
  return undefined;
}
