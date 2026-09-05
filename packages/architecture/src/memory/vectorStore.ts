import { HashEmbedder } from '@singularity/cache';
import type { DecisionStore } from './decisionStore.js';

export interface Embedder {
  embed(text: string): number[] | Promise<number[]>;
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) {
    return 0;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class HashArchitectureEmbedder implements Embedder {
  private readonly inner = new HashEmbedder(64);

  embed(text: string): number[] {
    return this.inner.embed(text);
  }
}

export async function searchEmbeddings(
  store: DecisionStore,
  projectId: string,
  queryEmbedding: number[],
  limit = 8,
): Promise<Array<{ adr_id: string; score: number }>> {
  const rows = store.listEmbeddings(projectId);
  return rows
    .map((r) => ({ adr_id: r.adr_id, score: cosine(queryEmbedding, r.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
