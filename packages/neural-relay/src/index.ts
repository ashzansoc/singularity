export {
  readNeuralRelayFlags,
  isNeuralRelayEnabled,
  DEFAULT_NEURAL_RELAY_MODEL,
  DEFAULT_CODING_MODEL,
  type NeuralRelayFlags,
  type NeuralRelayMode,
} from './flags.js';

export {
  roleBinding,
} from './roles.js';

export type {
  ModelRole,
  ModelRoleBinding,
  IndexedFile,
  ContextCandidate,
  RelevantFile,
  ContextResolution,
  ConfidenceAction,
  EgressEntry,
  BuiltContext,
  ContextExpansionRequest,
  NeuralRelayTokenMetrics,
  NeuralRelayQualityMetrics,
  NeuralRelayPerfMetrics,
  NeuralRelayCostMetrics,
  ExperimentRecord,
  AnalyzeContextOptions,
  AnalyzeContextResult,
  RelayPrepareResult,
  RepoIndexPort,
} from './types.js';

export { NeuralRelayStore, neuralRelayDir } from './store.js';
export {
  applyDeepSeekUsage,
  applyNeuralRelayResult,
  averageContextReduction,
  compactTokenCount,
  cumulativeDeepSeekRate,
  cumulativeRelayRate,
  emptyCacheStatusSnapshot,
  formatDeepSeekCacheBar,
  formatDeepSeekCacheTooltip,
  formatNeuralRelayBar,
  formatNeuralRelayTooltip,
  formatRatePercent,
  formatRequestTelemetryDebug,
  formatSavedBar,
  isDeepSeekModel,
  isNeuralRelayContextModel,
  setPhase,
  type CacheStatusSnapshot,
  type DeepSeekCacheSlice,
  type NeuralRelaySlice,
  type RequestPhase,
  type RequestTelemetry,
} from './metrics/cacheStatus.js';
export { estimateTokens, tokenize, languageFromPath, isCodeOrConfigPath, shouldIgnorePath } from './hash.js';
export { FilesystemRepoIndex } from './retrieval/filesystemIndex.js';
export { IntelligenceRepoIndex } from './retrieval/intelligenceIndex.js';
export {
  deterministicRetrieve,
  semanticRetrieve,
  rankCandidates,
} from './retrieval/pipeline.js';
export type { ContextIntelligenceModel } from './intelligence/ContextIntelligenceModel.js';
export {
  MLXProvider,
  LlamaCppProvider,
  OllamaProvider,
  VllmProvider,
} from './intelligence/ContextIntelligenceModel.js';
export { OpenRouterNemotronProvider } from './intelligence/OpenRouterNemotronProvider.js';
export {
  CONTEXT_RESOLUTION_JSON_SCHEMA,
  parseContextResolution,
  deterministicResolution,
} from './intelligence/schema.js';
export { confidenceAction } from './intelligence/confidence.js';
export {
  buildDeepSeekContext,
  renderDeepSeekPrompt,
  appendVolatileContext,
} from './builder/contextBuilder.js';
export {
  prepareNeuralRelayContext,
  applyContextExpansion,
} from './pipeline/orchestrator.js';
export { expandBuiltContext, expandFromVerifierFailure, pathsFromFailureOutput } from './pipeline/expansion.js';
export { costUsd, contextReduction, priceFor } from './metrics/pricing.js';
export {
  buildExperimentRecord,
  successCriteria,
} from './metrics/experimentLog.js';
export { logEgress, makeEgress } from './security/egressLog.js';
