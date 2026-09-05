export {
  CACHE_SCHEMA_VERSION,
  CACHEABLE_INTENTS,
  DEFAULT_SEMANTIC_THRESHOLD,
} from './types.js';
export type {
  CacheEntryMeta,
  CacheHit,
  CacheLayer,
  CacheLookupResult,
  CacheManagerConfig,
  CacheMiss,
  CacheRequest,
  CacheableIntent,
  ContextFingerprintInput,
  DurableRecord,
  Embedder,
  InteractionMode,
  InvalidationScope,
  KvStore,
  PrefixHints,
  ProviderKind,
  ResponseCacheEntry,
  RoutingDecisionLike,
  RoutingStats,
  SemanticCacheEntry,
  VectorMatch,
  VectorStore,
  WriteThroughPayload,
} from './types.js';

export {
  buildResponseCacheKey,
  buildRouteCacheKey,
  fingerprintBucket,
  normalizePrompt,
  sha256,
  shortHash,
} from './keys.js';
export {
  buildContextFingerprint,
  buildBlockFingerprints,
  aggregateBlockFingerprint,
} from './fingerprint.js';
export type {
  ContextBlockFingerprint,
  ContextBlockFingerprintInput,
} from './fingerprint.js';
export {
  FingerprintHistoryStore,
} from './layers/fingerprint-history.js';
export type {
  BlockFingerprintRecord,
  FingerprintSnapshot,
} from './layers/fingerprint-history.js';
export { CacheMetrics } from './metrics.js';
export { InvalidationController } from './invalidation.js';
export type { InvalidationEvent, VersionState } from './invalidation.js';

export { MemoryStore } from './storage/memory.js';
export { SqliteStore } from './storage/sqlite.js';
export { HashEmbedder, InMemoryVectorStore } from './storage/vector.js';

export { ContextCache } from './layers/context.js';
export { PromptPrefixCache } from './layers/prompt-prefix.js';
export { SemanticPromptCache } from './layers/semantic.js';
export type { SemanticQuery } from './layers/semantic.js';
export { ResponseCache } from './layers/response.js';
export { RoutingCache, createRoutingCacheAdapter } from './layers/routing.js';

export { InMemoryMemoryHub } from './memory/hub.js';
export type { MemoryHub, MemoryNamespace, MemoryRecord } from './memory/hub.js';

export { CacheManager, createCacheManager } from './manager.js';
