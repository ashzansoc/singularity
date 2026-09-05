export type { ArchitectureFlags } from './flags.js';
export { readArchitectureFlags, isArchitectureMemoryActive } from './flags.js';
export {
  ArchitectureMetricsCollector,
  createEmptyArchitectureMetrics,
  estimateTokens,
  type ArchitectureMetrics,
} from './metrics.js';
export type * from './domain/adr/schema.js';
export {
  parseAdr,
  safeParseAdr,
  embedText,
  nowIso,
  AdrSchema,
  canTransition,
  transitionAdr,
  isActiveStatus,
  scoreConfidence,
  confidenceAction,
  inferFactorsFromText,
  applySupersession,
  classifySignificance,
  shouldEnterAdrPipeline,
  validateAdrDeep,
} from './domain/adr/index.js';
export {
  DOMAIN_EVENT_TYPES,
  createDomainEvent,
  eventTypeName,
  parseEventTypeName,
  LocalEventBuffer,
  type DomainEvent,
  type DomainEventType,
  type EventBus,
  type EventHandler,
} from './events/index.js';
export { InMemoryEventBus } from './events/memoryBus.js';
export { OutboxPublisher } from './events/outboxPublisher.js';
export {
  ArchitectureContextCache,
  lookupCachedContextBlock,
  guessEntities,
  CONTEXT_BUDGET_DEFAULT,
  CONTEXT_BUDGET_MAX,
  CONTEXT_BUDGET_CRITICAL,
} from './context/index.js';
export {
  ArchitectureSubsystem,
  createArchitectureSubsystem,
  createMemoryStore,
  architectureFacade,
} from './subsystem.js';
export { mountArchitectureRoutes } from './api/routes.js';
export { MemoryDecisionStore, SqliteDecisionStore, openDecisionStore } from './memory/sqliteStore.js';
export type { DecisionStore, Observation, StoredConflict, StoredDrift, StoredEvolution, StoredCorrelation, DriftStatus } from './memory/decisionStore.js';
export { detectDrift } from './workers/drift.js';
export { detectStructuralDrift, buildObservedGraph, parseDeclaredLayers } from './workers/observedGraph.js';
export { proposeEvolution } from './workers/evolution.js';
export { attachProductionEvidence } from './workers/production.js';
export {
  PRODUCTION_EVENT_TYPES,
  PRODUCTION_EVENT_ALIASES,
  parseProductionEvent,
  ingestProductionEvent,
  correlateProductionEvent,
  scoreAdrMatch,
  matchesAdr,
  GenericWebhookAdapter,
  FixtureAdapter,
  queryProductionMaterialized,
  ProductionIngestError,
  ProductionSeenSet,
  readCorrelationPolicy,
  buildReactiveDebugContext,
  readStoredDebugContext,
  redactRecord,
  type ProductionEvent,
  type ProductionEventAdapter,
  type ProductionEvidence,
  type CorrelationPolicy,
  type ReactiveDebugContext,
} from './production/index.js';
export { hybridSearch } from './memory/hybridRetrieve.js';
export type { GraphSink } from './graph/graphSink.js';
export { NoopGraphSink } from './graph/graphSink.js';
export type { MemorySink } from './graph/memorySink.js';
export { NoopMemorySink } from './graph/memorySink.js';
export type { GraphBackend } from './graph/backend.js';
export { MemoryGraphBackend } from './graph/memoryBackend.js';
export { JsonGraphBackend } from './graph/jsonBackend.js';
export { Neo4jGraphBackend, openGraphBackend } from './graph/neo4jBackend.js';
export { detectConflicts } from './graph/conflicts.js';
export { graphImpact } from './graph/impact.js';
export { projectAdrToGraph, serviceFromPath } from './graph/builder.js';
export type { ArchNode, ArchEdge, ArchNodeKind, ArchRelKind } from './graph/types.js';
export {
  IMPACT_ANALYSIS_VERSION,
  ingestImpactAnalysis,
  parseImpactRequest,
  impactFingerprint,
  scoreImpact,
  computeImpactAnalysis,
  runStoredImpactAnalysis,
  storedToResult,
  bumpArchitectureVersion,
  readArchitectureVersion,
  emptyCodeImpact,
  mergeCodeImpact,
  type CodeImpactProvider,
  type CodeImpactSlice,
  type ImpactAnalysisResult,
  type ImpactAnalysisRequest,
  type ImpactIngestResult,
  type ImpactRecommendation,
  type ImpactSeverity,
  type ImpactAnalysisStatus,
  type StoredImpactAnalysis,
} from './impact/index.js';
export {
  RISK_ASSESSMENT_VERSION,
  ingestRiskAssessment,
  parseRiskRequest,
  riskFingerprint,
  scoreMissionRisk,
  runStoredRiskAssessment,
  storedToRiskResult,
  applyFreshness,
  riskLevelFromScore,
  clampScore,
  DEFAULT_RISK_WEIGHTS,
  type RiskAssessment,
  type RiskAssessmentRequest,
  type RiskIngestResult,
  type RiskFactor,
  type RiskLevel,
  type RiskAssessmentStatus,
  type StoredRiskAssessment,
} from './risk/index.js';
