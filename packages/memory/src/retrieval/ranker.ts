import type { MemoryRecord } from '../domain/memory.js';
import { sourceQuality } from '../domain/provenance.js';
import type { RankerWeights } from '../config/settings.js';
import { DEFAULT_RANKER_WEIGHTS } from '../config/settings.js';
import { cosine } from '../storage/vector.js';
import type { MemoryEmbeddingRow } from '../storage/repository.js';

export interface RankInputs {
  memory: MemoryRecord;
  semantic: number;
  graph_relevance: number;
  now?: number;
  weights?: RankerWeights;
  sourcePriority?: Record<string, number>;
}

export class MemoryRanker {
  constructor(
    private readonly weights: RankerWeights = DEFAULT_RANKER_WEIGHTS,
    private readonly sourcePriority?: Record<string, number>,
  ) {}

  score(input: RankInputs): number {
    const w = input.weights ?? this.weights;
    const now = input.now ?? Date.now();
    const ageDays =
      (now - Date.parse(input.memory.updated_at || input.memory.created_at)) / 86_400_000;
    const recency = Math.exp(-Math.max(0, ageDays) / 30);
    const src = sourceQuality(input.memory.source_type, input.sourcePriority ?? this.sourcePriority);
    return (
      w.semantic * input.semantic +
      w.importance * input.memory.importance +
      w.confidence * input.memory.confidence +
      w.graph_relevance * input.graph_relevance +
      w.recency * recency +
      w.source_quality * src
    );
  }
}

export function keywordScore(query: string, memory: MemoryRecord): number {
  const q = tokenize(query);
  const blob = `${memory.title} ${memory.content} ${memory.reason} ${memory.entities.join(' ')}`.toLowerCase();
  let hit = 0;
  for (const t of q) {
    if (blob.includes(t)) {
      hit += 1;
    }
  }
  return q.size ? hit / q.size : 0;
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9.+#-]+/)
      .filter((t) => t.length > 2),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) {
      inter += 1;
    }
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface HybridHit {
  memory: MemoryRecord;
  score: number;
}

export function hybridRank(opts: {
  query: string;
  queryEmbedding: number[];
  memories: MemoryRecord[];
  embeddings: MemoryEmbeddingRow[];
  graphScores?: Map<string, number>;
  ranker: MemoryRanker;
  historical?: boolean;
  limit?: number;
}): HybridHit[] {
  const vecMap = new Map(
    opts.embeddings.map((e) => [e.memory_id, cosine(opts.queryEmbedding, e.embedding)]),
  );
  const hits: HybridHit[] = [];
  for (const memory of opts.memories) {
    if (!opts.historical && memory.status !== 'ACTIVE') {
      continue;
    }
    if (memory.scope === 'WORKING') {
      continue;
    }
    const kw = keywordScore(opts.query, memory);
    const vec = vecMap.get(memory.id) ?? 0;
    const semantic = Math.max(kw, vec);
    const graph = opts.graphScores?.get(memory.id) ?? 0;
    const score = opts.ranker.score({ memory, semantic, graph_relevance: graph });
    hits.push({ memory, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, opts.limit ?? 10);
}
