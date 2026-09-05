import { z } from 'zod';
import {
  createDomainEvent,
  type DomainEvent,
  type DomainEventType,
} from '../events/types.js';
import {
  ProductionEvidenceSchema,
  type ProductionEvidence,
} from './evidence.js';

export const PRODUCTION_EVENT_TYPES = [
  'DEPLOYMENT_STARTED',
  'DEPLOYMENT_SUCCEEDED',
  'DEPLOYMENT_FAILED',
  'DEPLOYMENT_ROLLED_BACK',
  'INCIDENT_REPORTED',
  'INCIDENT_UPDATED',
  'INCIDENT_RESOLVED',
  'METRIC_OBSERVED',
  'METRIC_THRESHOLD_BREACHED',
  'METRIC_RECOVERED',
  'TEST_STARTED',
  'TEST_PASSED',
  'TEST_FAILED',
  'TEST_REGRESSION',
] as const;

export type ProductionEventType = (typeof PRODUCTION_EVENT_TYPES)[number];

/** Legacy domain names kept for existing emitters. */
export const PRODUCTION_EVENT_ALIASES: Record<string, ProductionEventType> = {
  DEPLOYMENT_CREATED: 'DEPLOYMENT_STARTED',
  TEST_CREATED: 'TEST_STARTED',
};

const TYPE_SET = new Set<string>(PRODUCTION_EVENT_TYPES);

export function isProductionEventType(type: string): type is ProductionEventType {
  return TYPE_SET.has(type) || type in PRODUCTION_EVENT_ALIASES;
}

export function canonicalizeProductionEventType(type: string): ProductionEventType | undefined {
  if (TYPE_SET.has(type)) {
    return type as ProductionEventType;
  }
  return PRODUCTION_EVENT_ALIASES[type];
}

export const ProductionEventSchema = z
  .object({
    event_id: z.string().optional(),
    event_type: z.string(),
    timestamp: z.string().optional(),
    source: z.string().optional(),
    source_event_id: z.string().optional(),
    environment: z.string().optional(),
    service: z.string().optional(),
    component: z.string().optional(),
    repository: z.string().optional(),
    branch: z.string().optional(),
    commit_sha: z.string().optional(),
    deployment_id: z.string().optional(),
    correlation_id: z.string().optional(),
    actor: z.string().optional(),
    payload: z.record(z.unknown()).optional(),
    evidence: ProductionEvidenceSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type ProductionEvent = z.infer<typeof ProductionEventSchema> & {
  event_type: ProductionEventType;
  event_id: string;
  timestamp: string;
  evidence?: ProductionEvidence;
};

export type ProductionIngestCode = 'invalid' | 'unknown_type' | 'malformed';

export class ProductionIngestError extends Error {
  readonly code: ProductionIngestCode;

  constructor(message: string, code: ProductionIngestCode) {
    super(message);
    this.name = 'ProductionIngestError';
    this.code = code;
  }
}

function payloadString(payload: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!payload) {
    return undefined;
  }
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === 'string' && v) {
      return v;
    }
  }
  return undefined;
}

export function hasProductionIdentity(event: {
  service?: string;
    component?: string;
    repository?: string;
  commit_sha?: string;
  deployment_id?: string;
  source_event_id?: string;
  payload?: Record<string, unknown>;
}): boolean {
  if (
    event.service ||
    event.component ||
    event.repository ||
    event.commit_sha ||
    event.deployment_id ||
    event.source_event_id
  ) {
    return true;
  }
  return Boolean(
    payloadString(event.payload, [
      'incident_id',
      'deployment_id',
      'metric_name',
      'metric_id',
      'test_id',
      'id',
      'name',
    ]),
  );
}

export function parseProductionEvent(input: unknown): ProductionEvent {
  if (input === null || input === undefined || typeof input !== 'object') {
    throw new ProductionIngestError('malformed payload', 'malformed');
  }
  const parsed = ProductionEventSchema.safeParse(input);
  if (!parsed.success) {
    throw new ProductionIngestError('invalid event', 'invalid');
  }
  const data = parsed.data;
  const canonical = canonicalizeProductionEventType(data.event_type);
  if (!canonical) {
    throw new ProductionIngestError(`unknown event type: ${data.event_type}`, 'unknown_type');
  }
  const event_id =
    data.event_id && data.event_id.length > 0
      ? data.event_id
      : `prod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const timestamp = data.timestamp && data.timestamp.length > 0 ? data.timestamp : new Date().toISOString();
  const commit_sha =
    data.commit_sha ?? payloadString(data.payload, ['commit_sha', 'commit', 'sha']);
  const deployment_id =
    data.deployment_id ?? payloadString(data.payload, ['deployment_id']);
  const service = data.service ?? payloadString(data.payload, ['service']);
  const component = data.component ?? payloadString(data.payload, ['component']);
  const environment = data.environment ?? payloadString(data.payload, ['environment', 'env']);
  const repository = data.repository ?? payloadString(data.payload, ['repository', 'repo']);
  const branch = data.branch ?? payloadString(data.payload, ['branch']);
  const candidate = {
    ...data,
    event_id,
    event_type: canonical,
    timestamp,
    commit_sha,
    deployment_id,
    service,
    component,
    environment,
    repository,
    branch,
    metadata: {
      ...(data.metadata ?? {}),
      ...(data.event_type !== canonical ? { aliased_from: data.event_type } : {}),
    },
  };
  if (!hasProductionIdentity(candidate)) {
    throw new ProductionIngestError(
      'missing required identity (service, repository, commit, deployment, source, or payload id)',
      'invalid',
    );
  }
  return candidate as ProductionEvent;
}

export function productionIdempotencyKey(event: ProductionEvent): string {
  if (event.source && event.source_event_id) {
    return `${event.source}:${event.source_event_id}`;
  }
  return event.event_id;
}

export function domainEventFromProduction(event: ProductionEvent, projectId: string): DomainEvent {
  return createDomainEvent({
    event_id: event.event_id,
    event_type: event.event_type as DomainEventType,
    timestamp: event.timestamp,
    project_id: projectId,
    commit_id: event.commit_sha,
    payload: {
      ...event.payload,
      source: event.source,
      source_event_id: event.source_event_id,
      environment: event.environment,
      service: event.service,
      component: event.component,
      repository: event.repository,
      branch: event.branch,
      commit_sha: event.commit_sha,
      deployment_id: event.deployment_id,
      correlation_id: event.correlation_id,
      actor: event.actor,
      production_evidence: event.evidence,
      production_metadata: event.metadata,
    },
  });
}

export function productionEventFromDomain(event: DomainEvent): ProductionEvent | undefined {
  if (!isProductionEventType(event.event_type)) {
    return undefined;
  }
  try {
    return parseProductionEvent({
      event_id: event.event_id,
      event_type: event.event_type,
      timestamp: event.timestamp,
      commit_sha: event.commit_id,
      source: typeof event.payload?.source === 'string' ? event.payload.source : 'singularity',
      source_event_id:
        typeof event.payload?.source_event_id === 'string'
          ? event.payload.source_event_id
          : event.event_id,
      environment: event.payload?.environment,
      service: event.payload?.service,
      component: event.payload?.component,
      repository: event.payload?.repository,
      branch: event.payload?.branch,
      deployment_id: event.payload?.deployment_id,
      correlation_id: event.payload?.correlation_id,
      actor: event.payload?.actor,
      payload: event.payload,
      evidence: event.payload?.production_evidence,
      metadata: event.payload?.production_metadata,
    });
  } catch {
    return undefined;
  }
}

export const PRODUCTION_FAMILY: Record<
  ProductionEventType,
  'deployment' | 'incident' | 'metric' | 'test'
> = {
  DEPLOYMENT_STARTED: 'deployment',
  DEPLOYMENT_SUCCEEDED: 'deployment',
  DEPLOYMENT_FAILED: 'deployment',
  DEPLOYMENT_ROLLED_BACK: 'deployment',
  INCIDENT_REPORTED: 'incident',
  INCIDENT_UPDATED: 'incident',
  INCIDENT_RESOLVED: 'incident',
  METRIC_OBSERVED: 'metric',
  METRIC_THRESHOLD_BREACHED: 'metric',
  METRIC_RECOVERED: 'metric',
  TEST_STARTED: 'test',
  TEST_PASSED: 'test',
  TEST_FAILED: 'test',
  TEST_REGRESSION: 'test',
};
