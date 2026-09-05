export {
  PRODUCTION_EVENT_TYPES,
  PRODUCTION_EVENT_ALIASES,
  PRODUCTION_FAMILY,
  ProductionEventSchema,
  ProductionIngestError,
  canonicalizeProductionEventType,
  isProductionEventType,
  parseProductionEvent,
  productionIdempotencyKey,
  domainEventFromProduction,
  productionEventFromDomain,
  type ProductionEvent,
  type ProductionEventType,
} from './schema.js';
export {
  PRODUCTION_EVIDENCE_TYPES,
  ProductionEvidenceSchema,
  evidenceForFamily,
  correlatedEvidence,
  type ProductionEvidence,
  type ProductionEvidenceType,
} from './evidence.js';
export {
  ingestProductionEvent,
  ProductionSeenSet,
  type ProductionIngestResult,
} from './ingest.js';
export {
  correlateProductionEvent,
  correlateDomainProductionEvent,
  matchesAdr,
  scoreAdrMatch,
  isProductionDomainType,
  entityId,
  type Correlation,
  type CorrelationResult,
} from './correlate.js';
export {
  GenericWebhookAdapter,
  FixtureAdapter,
  PRODUCTION_ADAPTER_SLOTS,
  type ProductionEventAdapter,
} from './adapters.js';
export { queryProductionMaterialized, type ProductionQueryResult } from './query.js';
export {
  readCorrelationPolicy,
  DEFAULT_CORRELATION_POLICY,
  confidenceBand,
  type CorrelationPolicy,
} from './policy.js';
export { redactRecord, redactValue } from './redact.js';
export {
  buildReactiveDebugContext,
  readStoredDebugContext,
  type ReactiveDebugContext,
} from './debugContext.js';
