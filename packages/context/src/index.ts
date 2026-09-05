/**
 * @singularity/context — Singularity Context Engine
 */

export type * from './types.js';
export {
  readContextEngineFlags,
  isContextEngineActive,
  type ContextEngineFlags,
} from './flags.js';
export { redactSecrets, containsLikelySecret } from './redact.js';
export { shouldExtract, preferSyncExtraction } from './relevance.js';
export {
  MetricsCollector,
  createEmptyMetrics,
  estimateTokens,
  type ContextEngineMetrics,
} from './metrics.js';
export {
  type ContextExtractor,
  type ExtractOptions,
  NoopContextExtractor,
} from './extractor.js';
export { HeuristicContextExtractor, heuristicExtract } from './heuristicExtractor.js';
export {
  LangExtractContextExtractor,
  type LangExtractContextExtractorOptions,
} from './langextractExtractor.js';
export {
  LangExtractSidecarClient,
  type SidecarConfig,
} from './sidecarClient.js';
export {
  mergeDelta,
  applyUserOverride,
  removeItem,
  emptyProjectState,
  type MergeStats,
} from './merge.js';
export { ProjectStateStore, contextDir } from './store.js';
export {
  getRelevantContext,
  estimateFullStateTokens,
  type RetrieveOptions,
} from './retrieval.js';
export {
  formatRelevantContextBlock,
  formatProjectSummary,
  formatVerificationChecklist,
} from './format.js';
export {
  ContextEngine,
  createContextEngine,
  type ContextEngineOptions,
  type IngestMessageResult,
} from './engine.js';
export {
  associateRequirementsWithFiles,
  type CodeHit,
} from './fileAssociation.js';

/**
 * Neural Relay — shared event fabric (single generic implementation formerly
 * triplicated across architecture/memory/outcome). Re-exported from the root
 * barrel so every consumer — including Node10-resolution hosts that cannot
 * read package.json `exports` subpaths — reaches it via `@singularity/context`.
 */
export {
  InMemoryRelayBus,
  RelayEventBuffer,
  RelayOutboxPublisher,
  newRelayEventId,
  parseRelayEventTypeName,
  relayEventTypeName,
  type EventFactory,
  type RelayBus,
  type RelayBufferOptions,
  type RelayEventLike,
  type RelayHandler,
  type RelayMetrics,
} from './relay/fabric.js';
