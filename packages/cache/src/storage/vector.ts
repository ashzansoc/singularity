import type { Embedder, VectorMatch, VectorStore } from '../types.js';
import { sha256 } from '../keys.js';

function cosine(a: number[], b: number[]): number {
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

interface VectorRow<T> {
  embedding: number[];
  payload: T;
}

/**
 * Brute-force in-memory vector store for L3 MVP.
 */
export class InMemoryVectorStore<T> implements VectorStore<T> {
  private readonly rows = new Map<string, VectorRow<T>>();

  upsert(id: string, embedding: number[], payload: T): void {
    this.rows.set(id, { embedding: [...embedding], payload });
  }

  get(id: string): { embedding: number[]; payload: T } | undefined {
    const row = this.rows.get(id);
    if (!row) {
      return undefined;
    }
    return { embedding: row.embedding, payload: row.payload };
  }

  delete(id: string): void {
    this.rows.delete(id);
  }

  search(
    embedding: number[],
    opts: { limit: number; filter?: (payload: T) => boolean },
  ): VectorMatch<T>[] {
    const matches: VectorMatch<T>[] = [];
    for (const [id, row] of this.rows) {
      if (opts.filter && !opts.filter(row.payload)) {
        continue;
      }
      matches.push({
        id,
        score: cosine(embedding, row.embedding),
        payload: row.payload,
      });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, opts.limit);
  }

  get size(): number {
    return this.rows.size;
  }

  clear(): void {
    this.rows.clear();
  }
}

/**
 * Deterministic hash-based embedder for tests and offline stubs.
 * Not suitable for production semantic quality.
 */
export class HashEmbedder implements Embedder {
  constructor(readonly dimensions: number = 32) {}

  embed(text: string): number[] {
    const out = new Array<number>(this.dimensions).fill(0);
    const hex = sha256(text);
    for (let i = 0; i < this.dimensions; i++) {
      const byte = Number.parseInt(hex.slice((i * 2) % 64, ((i * 2) % 64) + 2), 16);
      out[i] = (byte / 255) * 2 - 1;
    }
    // L2 normalize
    let norm = 0;
    for (const v of out) {
      norm += v * v;
    }
    norm = Math.sqrt(norm) || 1;
    return out.map((v) => v / norm);
  }
}
