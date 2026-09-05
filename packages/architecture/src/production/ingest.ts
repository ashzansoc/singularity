import type { LocalEventBuffer } from '../events/localBuffer.js';
import type { ArchitectureFlags } from '../flags.js';
import type { ArchitectureMetricsCollector } from '../metrics.js';
import type { DecisionStore } from '../memory/decisionStore.js';
import type { DomainEvent } from '../events/types.js';
import { nowIso } from '../domain/adr/schema.js';
import { redactRecord } from './redact.js';
import { readCorrelationPolicy, type CorrelationPolicy } from './policy.js';
import {
  domainEventFromProduction,
  parseProductionEvent,
  productionIdempotencyKey,
  ProductionIngestError,
  type ProductionEvent,
} from './schema.js';

export interface ProductionIngestResult {
  queued: boolean;
  event_id: string;
  duplicate?: boolean;
  error?: string;
  code?: string;
}

export class ProductionSeenSet {
  private readonly keys = new Map<string, string>();

  has(key: string): boolean {
    return this.keys.has(key);
  }

  get(key: string): string | undefined {
    return this.keys.get(key);
  }

  add(key: string, eventId: string): void {
    this.keys.set(key, eventId);
  }
}

function payloadBytes(event: ProductionEvent): number {
  try {
    return Buffer.byteLength(JSON.stringify(event.payload ?? {}), 'utf8');
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function redactEvent(event: ProductionEvent): ProductionEvent {
  return {
    ...event,
    payload: redactRecord(event.payload) ?? {},
    metadata: redactRecord(event.metadata),
  };
}

/**
 * Validate + enqueue. Never correlates, mutates the graph, or calls an LLM.
 */
export function ingestProductionEvent(
  input: unknown,
  opts: {
    projectId: string;
    buffer: LocalEventBuffer;
    flags: ArchitectureFlags;
    seen: ProductionSeenSet;
    metrics?: ArchitectureMetricsCollector;
    enabled?: boolean;
    store?: DecisionStore;
    policy?: CorrelationPolicy;
  },
): ProductionIngestResult {
  opts.metrics?.recordProductionReceived();
  if (
    opts.enabled === false ||
    !opts.flags.production_awareness_enabled ||
    !opts.flags.architecture_memory_enabled
  ) {
    return { queued: false, event_id: '', error: 'production_awareness_disabled', code: 'disabled' };
  }
  const policy = opts.policy ?? readCorrelationPolicy();
  let event: ProductionEvent;
  try {
    event = parseProductionEvent(input);
  } catch (e) {
    const err = e instanceof ProductionIngestError ? e : new ProductionIngestError('invalid event', 'invalid');
    opts.metrics?.recordProductionFailed();
    return { queued: false, event_id: '', error: err.message, code: err.code };
  }
  if (payloadBytes(event) > policy.maxPayloadBytes) {
    opts.metrics?.recordProductionFailed();
    return { queued: false, event_id: event.event_id, error: 'payload too large', code: 'invalid' };
  }
  event = redactEvent(event);
  const key = productionIdempotencyKey(event);
  const existingMem = opts.seen.get(key);
  const existingStore = opts.store?.getProductionEventByIdempotency(key)?.event_id;
  const existing = existingMem ?? existingStore;
  if (existing) {
    return { queued: true, event_id: existing, duplicate: true };
  }
  opts.seen.add(key, event.event_id);
  try {
    opts.store?.upsertProductionEvent({
      event_id: event.event_id,
      project_id: opts.projectId,
      idempotency_key: key,
      event_type: event.event_type,
      timestamp: event.timestamp,
      received_at: nowIso(),
      json: JSON.stringify(event),
    });
  } catch {
    /* durable store optional */
  }
  const domain: DomainEvent = domainEventFromProduction(event, opts.projectId);
  opts.buffer.append(domain);
  opts.metrics?.setProductionQueueLag(opts.buffer.peekDepth());
  return { queued: true, event_id: event.event_id };
}
