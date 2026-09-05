export type {
  Tier,
  Intent,
  InteractionMode,
  ProviderKind,
  ToolPermissions,
  FallbackReason,
  RouteContext,
  RouteFeatures,
  ModelSpec,
  IntentClassification,
  ScoredCandidate,
  RouteDecision,
  RouteDecisionCache,
  RoutingEngineConfig,
  TelemetryEvent,
} from './types.js';

export { TIERS, tierIndex, nextTier } from './types.js';

export {
  TIER_PURPOSE,
  INTENT_DEFAULT_TIER,
  INTENT_TEMPERATURE,
  INTENT_MAX_TOKENS,
  INTENT_SYSTEM_HINT,
  resolveToolPermissions,
} from './tiers.js';

export {
  applySingularityBundledEnv,
  getGatewayApiKey,
  getTokenRouterApiKey,
  ensureFreshTokenRouterApiKey,
  getTokenRouterBaseUrl,
  getOpenRouterBaseUrl,
  getTokenRouterRequestHeaders,
  getOpenRouterApiKey,
  isOpenRouterApiKey,
  SINGULARITY_BUNDLED_ENV,
  OPENROUTER_DEFAULT_BASE_URL,
} from './bundledEnv.js';
export {
  readBetaAuth,
  writeBetaAuth,
  clearBetaAuth,
  ensureDeviceId,
  refreshBetaSessionIfNeeded,
  getBetaProxyAuthHeaders,
  fetchBetaQuota,
  isAllowedSingularityEmail,
  SINGULARITY_ALLOWED_EMAIL_DOMAIN,
  SINGULARITY_SUPABASE_URL,
  SINGULARITY_SUPABASE_ANON_KEY,
  SINGULARITY_LLM_PROXY_URL,
  type SingularityBetaAuth,
} from './betaAuth.js';
export { callWhenScore, capabilityFitScore, tagMatches } from './modelMatcher.js';
export type {
  SpeedClass,
  CostClass,
  ContextWindowClass,
  ModelVendor,
  ModelCapabilities,
  SubTier,
} from './types.js';
export { subTierIndex, contextClassToTokens } from './types.js';
export { extractFeatures, estimateOutputTokens } from './features.js';
export { RuleIntentClassifier } from './intent/classifier.js';
export { INTENT_RULES, applyIntentRules } from './intent/rules.js';
export {
  CapabilityFilter,
  buildRequirements,
  resolveMinTier,
  type CapabilityRequirements,
} from './filter.js';
export { scoreCandidates, SCORE_WEIGHTS } from './score.js';
export {
  InMemoryRouteCache,
  buildCacheKey,
  shouldCacheRoute,
} from './cache.js';
export { buildFallbackChain, escalateDecision } from './fallback.js';
export { createRoutingEngine, RoutingEngine } from './engine.js';
export {
  createLlmDecisionEngine,
  LlmDecisionEngine,
  DEFAULT_DECISION_MODEL,
  type LlmRouteRequest,
  type LlmRouteDecision,
  type LlmDecisionEngineConfig,
} from './llmDecision.js';

export {
  hashContent,
  estimateTokens,
  createSegmentedContext,
  updateContextSegments,
  type ContextSegmentId,
  type ContextSegment,
  type SegmentedContextState,
  type SegmentInput,
} from './contextSegments.js';

export {
  providerOf,
  parseTier,
  escalateCandidateIfNeeded,
  decideConversationSwitch,
  applySwitchToState,
  MIN_ACCEPT_CONFIDENCE,
  type TurnRouteCandidate,
  type ConversationTurnState,
  type SwitchAction,
  type SwitchDecision,
} from './conversationSwitch.js';

export type {
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionChoice,
  ChatCompletionResult,
  IModelProvider,
  ResponseFormat,
} from './providers/types.js';
export { ProviderError } from './providers/types.js';
export { OpenRouterProvider, type OpenRouterProviderConfig } from './providers/openrouter.js';
export { LocalProvider, type LocalProviderConfig } from './providers/local.js';
export { DirectProvider, type DirectVendor } from './providers/direct.js';
export { ModelAdapter, type ModelAdapterConfig } from './providers/adapter.js';
export {
  createSingularityAI,
  SingularityAI,
  type SingularityAIConfig,
  type SingularityCompleteRequest,
  type SingularityCompleteResult,
} from './runtime.js';

export {
  classifyTask,
  taskClassToIntent,
  type TaskClass,
  type TaskClassification,
} from './taskClassifier.js';

export {
  classifyAndRoute,
  routeWithSignals,
  applyRoutingPolicy,
  detectSafetyOverrides,
  parseRoutingSignals,
  warmupQwenClassifier,
  isQwenClassifierReady,
  disposeQwenClassifier,
  FLASH_MODEL_ID,
  PRO_MODEL_ID,
  LOCAL_CLASSIFIER_ID,
  EMPTY_ROUTING_SIGNALS,
  QWEN_CLASSIFIER_SYSTEM_PROMPT,
  type LocalRoutingDecision,
  type RoutingSignals,
} from './localRoutingClassifier/index.js';

export {
  decideFlashOrPro,
  coerceFlashOrPro,
  isNemotronRouterEnabled,
  NEMOTRON_ROUTER_MODEL,
  NEMOTRON_ROUTER_SYSTEM,
  FLASH_MODEL_ID as NEMOTRON_FLASH_MODEL_ID,
  PRO_MODEL_ID as NEMOTRON_PRO_MODEL_ID,
  type FlashProDecision,
} from './nemotronFlashPro/index.js';

export {
  FRONTEND_OWNER_MODEL_ID,
  FRONTEND_SYSTEM_HINT,
  detectSpecialty,
  specialtyFromContext,
  isFrontendSpecialty,
  type SpecialtyLane,
} from './specialty.js';

export {
  classifySpecialty,
  parseSpecialtyContent,
  decisionModelCoolingDown,
  resetDecisionModelHealth,
  type SpecialtyClassification,
  type SpecialtyClassifierConfig,
  type SpecialtySource,
} from './specialtyClassifier.js';

export {
  specialtyMemoKey,
  getSpecialtyMemo,
  setSpecialtyMemo,
  clearSpecialtyMemo,
} from './specialtyMemo.js';

export {
  computeBackoffMs,
  extractRetryAfterFromText,
  fetchWithRateRetry,
  gateLlmRequest,
  getRateGateConfig,
  getRateGateStats,
  noteRateLimited,
  parseRetryAfterMs,
  parseRetryAfterValue,
  rateLimitedUntilTs,
  resetRateGate,
  resetRateGateStats,
  setRateGateConfig,
  sleepAbortable,
  type RateGateConfig,
  type RateGateStats,
} from './rateLimit.js';

export {
  requestTracer,
  startTrace,
  hashPromptForTrace,
  computeMetrics,
  TRACE_PHASES,
  type TracePhase,
  type TracePhaseRecord,
  type RequestTraceRecord,
  type RequestTraceMetrics,
} from './telemetry/requestTrace.js';

/** Re-export prompt architecture surface for IDE / extension consumers. */
export {
  createPromptPipeline,
  runPromptPipeline,
  createPromptEngine,
  compilePrompt,
  normalizePromptIntent,
  segmentsForIntent,
  type BuilderUpdate,
  type CanonicalContext,
  type PromptIR,
  type PromptPipelineState,
  type PromptEngine,
  type PromptEngineDebugSnapshot,
  type RouteMetadata,
  type ContextEconomyReport,
  formatEconomyMarkdown,
  buildEconomyReport,
} from '@singularity/prompt';
