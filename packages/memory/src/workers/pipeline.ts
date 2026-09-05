import type { MemoryCandidate, MemoryRecord, SourceType } from '../domain/memory.js';
import { nowIso, newMemoryId, parseMemory } from '../domain/memory.js';
import type { MemoryEvent } from '../events/schemas.js';
import {
  eventText,
  HeuristicMemoryExtractor,
} from '../extraction/extractor.js';
import type { MemorySettings } from '../config/settings.js';
import type { MemoryMetricsCollector } from '../metrics.js';
import type { MemoryRepository } from '../storage/repository.js';
import type { EmbeddingProvider } from '../storage/vector.js';
import type { RelationshipStore } from '../providers/graph/store.js';
import type { MemoryIntelligenceProvider } from '../providers/mem0/provider.js';
import { findDuplicate } from './dedup.js';
import { applySupersession, findConflict, shouldSupersede } from './conflict.js';
import { IntelligenceWorkerPool, CircuitBreaker, withRetry } from './pool.js';
import { buildSnapshot } from '../cache/snapshot.js';
import { TtlCache } from '../cache/l1.js';
import type { MemoryContextCache } from '../cache/context.js';
import type { ProjectSnapshot } from '../domain/snapshot.js';

function sourceFromEvent(event: MemoryEvent): SourceType {
  const t = event.event_type;
  if (t.includes('human')) {
    return 'HUMAN';
  }
  if (t.includes('commit') || t === 'COMMIT_CREATED') {
    return 'COMMIT';
  }
  if (t.includes('pull_request') || t === 'PR_CREATED') {
    return 'PULL_REQUEST';
  }
  if (t.includes('ADR') || t.includes('architecture')) {
    return 'ADR';
  }
  if (t.includes('test')) {
    return 'TEST';
  }
  if (t.includes('conversation') || t === 'USER_INTENT_CAPTURED') {
    return 'CONVERSATION';
  }
  return 'AGENT';
}

function candidateToRecord(
  projectId: string,
  c: MemoryCandidate,
  event: MemoryEvent,
): MemoryRecord {
  const ts = nowIso();
  return parseMemory({
    id: newMemoryId(),
    project_id: projectId,
    type: c.type,
    scope: c.scope,
    title: c.title,
    content: c.content,
    reason: c.reason,
    status: 'ACTIVE',
    importance: c.importance,
    confidence: c.confidence,
    source_type: c.source.source_type ?? sourceFromEvent(event),
    source_id: c.source.source_id ?? event.event_id,
    task_id: c.source.task_id ?? event.task_id,
    agent_id: c.source.agent_id ?? event.agent_id,
    entities: c.entities,
    embedding_pending: true,
    created_at: ts,
    updated_at: ts,
  });
}

export class MemoryPipeline {
  readonly pool: IntelligenceWorkerPool;
  private readonly extractor = new HeuristicMemoryExtractor();
  private readonly dbBreaker = new CircuitBreaker();
  private readonly embedBreaker = new CircuitBreaker();
  private readonly graphBreaker = new CircuitBreaker();
  readonly snapshots = new TtlCache<ProjectSnapshot>(120_000);

  constructor(
    private readonly store: MemoryRepository,
    private readonly settings: MemorySettings,
    private readonly metrics: MemoryMetricsCollector,
    private readonly embedder: EmbeddingProvider,
    private readonly graph: RelationshipStore,
    private readonly intelligence: MemoryIntelligenceProvider,
    private readonly contextCache?: MemoryContextCache,
  ) {
    this.pool = new IntelligenceWorkerPool(settings.llm_max_concurrency);
  }

  async handle(event: MemoryEvent): Promise<void> {
    const t0 = Date.now();
    try {
      await this.pool.run(async () => {
        this.metrics.setWorkerActive(this.pool.running);
        await this.dispatch(event);
      });
    } catch {
      this.metrics.recordExtraction(Date.now() - t0, true);
      try {
        await this.store.insertDeadLetter({
          id: `dlq_${event.event_id}`,
          kind: 'event',
          payload: event,
          error: 'pipeline_failed',
          created_at: nowIso(),
        });
        this.metrics.recordDlq();
      } catch {
        /* ignore */
      }
    } finally {
      this.metrics.setWorkerActive(this.pool.running);
    }
  }

  private async dispatch(event: MemoryEvent): Promise<void> {
    const fresh = await this.dbBreaker.exec(
      () => this.store.markEventProcessed(event.event_id, event.project_id),
      false,
    );
    if (!fresh) {
      return;
    }
    if (!this.settings.extraction_enabled) {
      return;
    }
    const text = eventText(event.payload);
    if (!text) {
      return;
    }
    const t0 = Date.now();
    let candidate: MemoryCandidate | undefined;
    try {
      candidate = await this.extractor.extract({
        eventId: event.event_id,
        eventType: event.event_type,
        projectId: event.project_id,
        taskId: event.task_id,
        agentId: event.agent_id,
        sourceType: sourceFromEvent(event),
        text,
      });
      if (!candidate) {
        candidate = await this.intelligence.extract(text, {
          project_id: event.project_id,
          event_id: event.event_id,
        });
      }
      this.metrics.recordExtraction(Date.now() - t0, false);
    } catch {
      this.metrics.recordExtraction(Date.now() - t0, true);
      return;
    }
    if (!candidate || candidate.scope === 'WORKING') {
      return;
    }
    const record = candidateToRecord(event.project_id, candidate, event);
    const existing = await this.dbBreaker.exec(
      () => this.store.list({ project_id: event.project_id }),
      [],
    );
    const embeddings = await this.dbBreaker.exec(
      () => this.store.listEmbeddings(event.project_id),
      [],
    );
    const dup = findDuplicate(record, existing, embeddings);
    if (dup) {
      this.metrics.recordDedup();
      dup.last_accessed_at = nowIso();
      await this.store.patch(event.project_id, dup);
      return;
    }
    const conflict = findConflict(record, existing);
    if (conflict && shouldSupersede(conflict, record)) {
      const { old, next, version } = applySupersession(conflict, record);
      await this.store.insertVersion(version);
      await this.store.patch(event.project_id, old);
      await this.store.insert(next);
      this.metrics.recordConflict();
      await this.afterPersist(next);
      return;
    }
    await this.store.insert(record);
    await this.afterPersist(record);
  }

  async afterPersist(memory: MemoryRecord): Promise<void> {
    this.snapshots.invalidate(memory.project_id);
    await this.embedMemory(memory);
    await this.indexGraph(memory);
    const all = await this.store.list({ project_id: memory.project_id });
    const snap = buildSnapshot(
      memory.project_id,
      all,
      this.settings.snapshot_token_budget,
      this.settings.snapshot_top_k,
    );
    this.snapshots.set(memory.project_id, snap);
    this.contextCache?.set(memory.project_id, snap);
  }

  async embedMemory(memory: MemoryRecord): Promise<void> {
    if (!this.settings.vector_search_enabled) {
      return;
    }
    const t0 = Date.now();
    try {
      const vecs = await this.embedBreaker.exec(
        () =>
          withRetry(
            () => this.embedder.embed([`${memory.title}\n${memory.content}`]),
            this.settings.retry_delays_ms.map((d) => Math.min(d, 20)),
            () => this.metrics.recordRetry(),
          ),
        [],
      );
      const embedding = vecs[0];
      if (!embedding) {
        throw new Error('no embedding');
      }
      await this.store.upsertEmbedding({
        memory_id: memory.id,
        embedding,
        model: this.embedder.model,
        dimensions: embedding.length,
      });
      this.metrics.recordEmbedding(Date.now() - t0);
    } catch {
      await this.store.insertDeadLetter({
        id: `dlq_emb_${memory.id}`,
        kind: 'embedding',
        payload: { memory_id: memory.id },
        error: 'embed_failed',
        created_at: nowIso(),
      });
      this.metrics.recordDlq();
    }
  }

  async indexGraph(memory: MemoryRecord): Promise<void> {
    if (!this.settings.graph_enabled) {
      return;
    }
    const t0 = Date.now();
    await this.graphBreaker.exec(async () => {
      const id = `Decision:${memory.id}`;
      await this.graph.createEntity({
        id,
        kind: 'Decision',
        label: memory.title,
        project_id: memory.project_id,
      });
      for (const e of memory.entities) {
        const tid = `Technology:${e}`;
        await this.graph.createEntity({
          id: tid,
          kind: 'Technology',
          label: e,
          project_id: memory.project_id,
        });
        await this.graph.createRelationship({ from: id, to: tid, kind: 'USES' });
      }
      if (memory.supersedes_id) {
        await this.graph.createRelationship({
          from: id,
          to: `Decision:${memory.supersedes_id}`,
          kind: 'SUPERSEDES',
        });
      }
      this.metrics.recordGraph(Date.now() - t0);
      return true;
    }, false);
  }
}
