export interface MemorySettings {
  memory_enabled: boolean;
  extraction_enabled: boolean;
  vector_search_enabled: boolean;
  graph_enabled: boolean;
  context_enabled: boolean;
  mem0_enabled: boolean;
  consolidation_enabled: boolean;
  database_url?: string;
  redis_url?: string;
  neo4j_uri?: string;
  neo4j_user?: string;
  neo4j_password?: string;
  mem0_api_key?: string;
  mem0_base_url: string;
  llm_max_concurrency: number;
  queue_max: number;
  snapshot_token_budget: number;
  snapshot_top_k: number;
  embedding_dimensions: number;
  retry_delays_ms: number[];
  ranker: RankerWeights;
  source_priority: Record<string, number>;
}

export interface RankerWeights {
  semantic: number;
  importance: number;
  confidence: number;
  graph_relevance: number;
  recency: number;
  source_quality: number;
}

function envBool(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') {
    return defaultValue;
  }
  return !/^(0|false|off|no)$/i.test(v.trim());
}

function envNum(name: string, defaultValue: number): number {
  const v = process.env[name];
  if (!v) {
    return defaultValue;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

export const DEFAULT_RANKER_WEIGHTS: RankerWeights = {
  semantic: 0.35,
  importance: 0.2,
  confidence: 0.15,
  graph_relevance: 0.15,
  recency: 0.1,
  source_quality: 0.05,
};

export const DEFAULT_SOURCE_PRIORITY: Record<string, number> = {
  HUMAN: 1,
  ADR: 0.9,
  DOCUMENT: 0.75,
  CODE: 0.65,
  AGENT: 0.45,
  CONVERSATION: 0.35,
  SYSTEM: 0.3,
  TEST: 0.55,
  CI: 0.5,
  COMMIT: 0.7,
  PULL_REQUEST: 0.7,
};

export function readMemorySettings(overrides?: Partial<MemorySettings>): MemorySettings {
  const base: MemorySettings = {
    memory_enabled: envBool('MEMORY_ENGINE_ENABLED', true),
    extraction_enabled: envBool('MEMORY_EXTRACTION_ENABLED', true),
    vector_search_enabled: envBool('MEMORY_VECTOR_SEARCH_ENABLED', true),
    graph_enabled: envBool('MEMORY_GRAPH_ENABLED', true),
    context_enabled: envBool('MEMORY_CONTEXT_ENABLED', true),
    mem0_enabled: envBool('MEMORY_MEM0_ENABLED', Boolean(process.env.MEM0_API_KEY)),
    consolidation_enabled: envBool('MEMORY_CONSOLIDATION_ENABLED', true),
    database_url: process.env.MEMORY_DATABASE_URL || undefined,
    redis_url: process.env.MEMORY_REDIS_URL || undefined,
    neo4j_uri: process.env.NEO4J_URI || undefined,
    neo4j_user: process.env.NEO4J_USER || undefined,
    neo4j_password: process.env.NEO4J_PASSWORD || undefined,
    mem0_api_key: process.env.MEM0_API_KEY || undefined,
    mem0_base_url: process.env.MEM0_BASE_URL || 'https://api.mem0.ai',
    llm_max_concurrency: Math.max(1, envNum('MEMORY_LLM_MAX_CONCURRENCY', 10)),
    queue_max: Math.max(64, envNum('MEMORY_QUEUE_MAX', 20_000)),
    snapshot_token_budget: envNum('MEMORY_SNAPSHOT_TOKEN_BUDGET', 4000),
    snapshot_top_k: envNum('MEMORY_SNAPSHOT_TOP_K', 8),
    embedding_dimensions: envNum('MEMORY_EMBEDDING_DIMENSIONS', 64),
    retry_delays_ms: [1000, 5000, 30_000, 120_000],
    ranker: { ...DEFAULT_RANKER_WEIGHTS },
    source_priority: { ...DEFAULT_SOURCE_PRIORITY },
  };
  return { ...base, ...overrides, ranker: { ...base.ranker, ...overrides?.ranker } };
}

export function isMemoryActive(settings?: MemorySettings): boolean {
  return (settings ?? readMemorySettings()).memory_enabled;
}
