/** Schema version prefix for durable keys. */
export const CACHE_SCHEMA_VERSION = 1 as const;

/** Default semantic cosine similarity threshold. */
export const DEFAULT_SEMANTIC_THRESHOLD = 0.92;

/** Intents safe for exact / semantic response reuse when otherwise restricted. */
export const CACHEABLE_INTENTS = [
  'DOCUMENTATION',
  'EXPLAIN',
  'REVIEW',
  'SUMMARY',
] as const;

export type CacheableIntent = (typeof CACHEABLE_INTENTS)[number];

export type InteractionMode = 'chat' | 'agent' | 'inline' | 'autocomplete' | 'terminal';

export type CacheLayer = 'L1' | 'L2' | 'L3' | 'L4' | 'L7' | 'L8';

export type ProviderKind = 'openrouter' | 'local' | 'direct' | 'anthropic' | 'openai' | 'gemini';

export type InvalidationScope =
  | 'file_save'
  | 'branch_switch'
  | 'dependency_change'
  | 'template_change'
  | 'provider_change'
  | 'settings_change'
  | 'workspace_change';

export interface ContextFingerprintInput {
  openFiles: string[];
  activeUri?: string;
  selectionHash?: string;
  diagnosticsHash?: string;
  gitDiffHash?: string;
  terminalTailHash?: string;
  clipboardHash?: string;
  imageIds?: string[];
  toolOutputHashes?: string[];
  settingsVersion: string;
  branch: string;
  workspaceId: string;
  memoryDigest?: string;
  depsVersion?: string;
}

export interface CacheEntryMeta {
  layer: CacheLayer;
  workspaceId: string;
  createdAt: number;
  expiresAt: number;
  confidence?: number;
  tokenEstimate?: number;
  [key: string]: unknown;
}

export interface DurableRecord {
  key: string;
  value: string;
  expiresAt: number;
  meta: CacheEntryMeta;
}

export interface ResponseCacheEntry {
  key: string;
  modelId: string;
  promptNormalized: string;
  fingerprint: string;
  templateVersion: string;
  responseText: string;
  confidence: number;
  createdAt: number;
  expiresAt: number;
  tokenEstimate: number;
  workspaceId: string;
}

export interface SemanticCacheEntry {
  id: string;
  embedding: number[];
  mode: InteractionMode;
  intent: string;
  fpBucket: string;
  workspaceId: string;
  templateVersion: string;
  responseText: string;
  confidence: number;
  tombstoned: boolean;
  createdAt: number;
  expiresAt: number;
  tokenEstimate: number;
}

export interface PrefixHints {
  prefixHash: string;
  prefixVersion: string;
  providerKind: ProviderKind;
  /** Anthropic-style cache_control marker. */
  cacheControl?: { type: 'ephemeral' };
  /** OpenAI-compatible prompt_cache_key. */
  promptCacheKey?: string;
}

export interface RoutingDecisionLike {
  modelId: string;
  tier?: string;
  intent?: string;
  fromCache?: boolean;
  [key: string]: unknown;
}

export interface RoutingStats {
  routeKey: string;
  workspaceId: string;
  decision: RoutingDecisionLike;
  latencyMs: number[];
  costUsd: number;
  qualityScore: number | null;
  failures: number;
  timeouts: number;
  updatedAt: number;
  expiresAt: number;
}

export interface CacheRequest {
  prompt: string;
  mode: InteractionMode;
  intent: string;
  modelId: string;
  temperature: number;
  context: ContextFingerprintInput;
  templateVersion?: string;
  providerKind?: ProviderKind;
  requiresTools?: boolean;
  cacheable?: boolean;
  forceCacheable?: boolean;
  /** Soft routing key parts when integrating with router. */
  hasImages?: boolean;
}

export interface CacheHit {
  hit: true;
  layer: 'L3' | 'L4';
  responseText: string;
  confidence: number;
  tokenEstimate: number;
  fingerprint: string;
  key: string;
  routeKey: string;
  prefixHints: PrefixHints;
  allowSemantic: boolean;
  cacheable: true;
}

export interface CacheMiss {
  hit: false;
  fingerprint: string;
  key: string;
  prefixHints: PrefixHints;
  routeKey: string;
  allowSemantic: boolean;
  cacheable: boolean;
}

export type CacheLookupResult = CacheHit | CacheMiss;

export interface WriteThroughPayload {
  responseText: string;
  tokenEstimate: number;
  confidence?: number;
  /** Optional routing decision to persist. */
  routingDecision?: RoutingDecisionLike;
  latencyMs?: number;
  costUsd?: number;
  qualityScore?: number;
  outcome?: 'success' | 'failure' | 'timeout';
}

export interface CacheManagerConfig {
  workspaceId: string;
  /** Durable store directory; if omitted, durable data is in-memory only. */
  durableDir?: string;
  responseTtlMs?: number;
  routingTtlMs?: number;
  semanticTtlMs?: number;
  semanticThreshold?: number;
  maxMemoryEntries?: number;
  refreshAfterMs?: number;
  enableBackgroundRefresh?: boolean;
  templateVersion?: string;
  prefixVersion?: string;
  embedder?: Embedder;
}

export interface Embedder {
  embed(text: string): Promise<number[]> | number[];
  dimensions?: number;
}

export interface VectorMatch<T> {
  id: string;
  score: number;
  payload: T;
}

export interface VectorStore<T> {
  upsert(id: string, embedding: number[], payload: T): void;
  get(id: string): { embedding: number[]; payload: T } | undefined;
  delete(id: string): void;
  search(
    embedding: number[],
    opts: { limit: number; filter?: (payload: T) => boolean },
  ): VectorMatch<T>[];
  size: number;
  clear(): void;
}

export interface KvStore {
  get(key: string): DurableRecord | undefined;
  set(record: DurableRecord): void;
  delete(key: string): void;
  clear(): void;
  keys(prefix?: string): string[];
  size: number;
}
