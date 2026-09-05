/**
 * Embedding provider for the Brain.
 *
 * Prefers an OpenAI-compatible /embeddings endpoint (the TokenRouter gateway
 * exposes one) and silently falls back to a deterministic local hash embedder
 * so semantic search still works fully offline. Vectors are stored packed as
 * Float32 blobs; the dimension is fixed at creation time of the store.
 */

export interface BrainEmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly model: string;
  readonly dimensions: number;
}

/** Deterministic bag-of-features hashing embedder (no network, stable). */
export class HashBrainEmbedder implements BrainEmbeddingProvider {
  readonly model = 'hash-v1';
  constructor(readonly dimensions = 256) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s._/-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    for (const tok of tokens) {
      const h = fnv1a(tok);
      v[h % this.dimensions] += 1;
      v[(h >>> 8) % this.dimensions] += 0.5;
      // bigrams give a little context sensitivity
      for (let i = 0; i < tok.length - 2; i++) {
        const bg = fnv1a(tok.slice(i, i + 3));
        v[bg % this.dimensions] += 0.25;
      }
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface GatewayEmbedderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number;
}

/**
 * OpenAI-compatible embeddings via the gateway. Falls back to the local hash
 * embedder whenever the endpoint or key is unavailable, so ingestion never
 * blocks on network availability.
 */
export class GatewayBrainEmbedder implements BrainEmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private readonly fallback = new HashBrainEmbedder(256);

  constructor(private opts: GatewayEmbedderOptions = {}) {
    this.model = opts.model ?? 'text-embedding-3-small';
    this.dimensions = this.fallback.dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) {
      return [];
    }
    const { apiKey, baseUrl } = this.opts;
    if (!apiKey || !baseUrl) {
      return this.fallback.embed(texts);
    }
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        throw new Error(`brain embed ${res.status}`);
      }
      const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      const data = json.data ?? [];
      if (data.length !== texts.length) {
        throw new Error('brain embed length mismatch');
      }
      return data.map((d) => normalizeTo(d.embedding, this.dimensions));
    } catch {
      return this.fallback.embed(texts);
    }
  }
}

/** Pad/trim provider vectors to the store's fixed dimension and unit-normalize. */
function normalizeTo(v: number[], dim: number): number[] {
  const out = v.length >= dim ? v.slice(0, dim) : [...v, ...new Array<number>(dim - v.length).fill(0)];
  const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1;
  return out.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
  }
  return dot;
}
