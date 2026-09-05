import { shortHash } from '../keys.js';
import type {
  Embedder,
  InteractionMode,
  SemanticCacheEntry,
  VectorStore,
} from '../types.js';
import { DEFAULT_SEMANTIC_THRESHOLD } from '../types.js';
import { HashEmbedder, InMemoryVectorStore } from '../storage/vector.js';

export interface SemanticQuery {
  promptNormalized: string;
  mode: InteractionMode;
  intent: string;
  fpBucket: string;
  workspaceId: string;
  templateVersion: string;
}

export class SemanticPromptCache {
  private readonly store: VectorStore<SemanticCacheEntry>;
  private readonly embedder: Embedder;
  private readonly threshold: number;
  private readonly ttlMs: number;

  constructor(opts?: {
    store?: VectorStore<SemanticCacheEntry>;
    embedder?: Embedder;
    threshold?: number;
    ttlMs?: number;
  }) {
    this.store = opts?.store ?? new InMemoryVectorStore<SemanticCacheEntry>();
    this.embedder = opts?.embedder ?? new HashEmbedder();
    this.threshold = opts?.threshold ?? DEFAULT_SEMANTIC_THRESHOLD;
    this.ttlMs = opts?.ttlMs ?? 60 * 60_000;
  }

  async query(q: SemanticQuery): Promise<SemanticCacheEntry | undefined> {
    const embedding = await Promise.resolve(this.embedder.embed(q.promptNormalized));
    const now = Date.now();
    const matches = this.store.search(embedding, {
      limit: 5,
      filter: (p) =>
        !p.tombstoned &&
        p.expiresAt > now &&
        p.workspaceId === q.workspaceId &&
        p.mode === q.mode &&
        p.intent === q.intent &&
        p.fpBucket === q.fpBucket &&
        p.templateVersion === q.templateVersion,
    });

    const best = matches[0];
    if (!best || best.score < this.threshold) {
      return undefined;
    }
    return best.payload;
  }

  async storeResponse(
    q: SemanticQuery,
    responseText: string,
    opts?: { confidence?: number; tokenEstimate?: number },
  ): Promise<string> {
    const embedding = await Promise.resolve(this.embedder.embed(q.promptNormalized));
    const now = Date.now();
    const id = `sem:${q.workspaceId}:${shortHash(
      q.promptNormalized + q.intent + q.fpBucket + q.templateVersion,
    )}`;
    const entry: SemanticCacheEntry = {
      id,
      embedding,
      mode: q.mode,
      intent: q.intent,
      fpBucket: q.fpBucket,
      workspaceId: q.workspaceId,
      templateVersion: q.templateVersion,
      responseText,
      confidence: opts?.confidence ?? 0.85,
      tombstoned: false,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      tokenEstimate: opts?.tokenEstimate ?? 0,
    };
    this.store.upsert(id, embedding, entry);
    return id;
  }

  tombstone(id: string): void {
    const row = this.store.get(id);
    if (!row) {
      return;
    }
    this.store.upsert(id, row.embedding, { ...row.payload, tombstoned: true });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
