import { HashEmbedder } from '@singularity/cache';

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly model: string;
  readonly dimensions: number;
}

export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'hash';
  private readonly inner: HashEmbedder;

  constructor(readonly dimensions = 64) {
    this.inner = new HashEmbedder(dimensions);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.inner.embed(t));
  }
}

export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;

  constructor(opts: { model?: string; dimensions?: number; apiKey?: string; baseUrl?: string }) {
    this.model = opts.model ?? 'text-embedding-3-small';
    this.dimensions = opts.dimensions ?? 64;
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    this.baseUrl = opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  }

  private readonly apiKey?: string;
  private readonly baseUrl: string;

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      const fallback = new HashEmbeddingProvider(this.dimensions);
      return fallback.embed(texts);
    }
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`embed ${res.status}`);
      }
      const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      return (json.data ?? []).map((d) => d.embedding.slice(0, this.dimensions));
    } catch {
      const fallback = new HashEmbeddingProvider(this.dimensions);
      return fallback.embed(texts);
    }
  }
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
