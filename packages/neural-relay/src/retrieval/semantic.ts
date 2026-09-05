import { tokenize } from '../hash.js';
import type { IndexedFile, RepoIndexPort } from '../types.js';

/**
 * 64-dim FNV hash embedder — same algorithm as DefaultHashEmbedder
 * (`packages/prompt/src/embed/hashEmbedder.ts`). No new vector database.
 */
function hashEmbed(text: string, dim = 64): number[] {
  const vec = new Array(dim).fill(0);
  const toks = tokenize(text);
  for (const t of toks) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    vec[(h >>> 0) % dim] += 1;
  }
  let n = 0;
  for (const v of vec) {
    n += v * v;
  }
  const mag = Math.sqrt(n) || 1;
  return vec.map((v) => v / mag);
}

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}

/**
 * Stage 2 — hash-embedding semantic retrieval (parallel with stage 1).
 * If the index exposes IntelligenceEngine-backed search, prefer that.
 */
export function semanticRetrieve(
  index: RepoIndexPort,
  task: string,
  limit = 50,
): IndexedFile[] {
  if (index.semanticSearch) {
    const hits = index.semanticSearch(task, limit);
    if (hits.length) {
      return hits;
    }
  }
  const q = hashEmbed(task);
  const scored = index.listFileMetadata().map((f) => {
    const sim = cosine(
      q,
      hashEmbed(`${f.path}\n${f.summary}\n${f.symbols.join(' ')}`),
    );
    return { f, sim };
  });
  scored.sort((a, b) => b.sim - a.sim);
  return scored
    .filter((s) => s.sim > 0.05)
    .slice(0, limit)
    .map((s) => s.f);
}
