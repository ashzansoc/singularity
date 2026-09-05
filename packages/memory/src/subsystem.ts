import { join } from 'node:path';
import {
  isMemoryActive,
  readMemorySettings,
  type MemorySettings,
} from './config/settings.js';
import { MemoryMetricsCollector, estimateTokens } from './metrics.js';
import {
  LocalMemoryBuffer,
  MemoryOutboxPublisher,
  InMemoryEventBus,
  type MemoryEvent,
} from './events/index.js';
import type { MemoryRecord } from './domain/memory.js';
import { nowIso, newMemoryId, parseMemory, MemoryRecordSchema } from './domain/memory.js';
import { emptySnapshot, type ProjectSnapshot } from './domain/snapshot.js';
import { InMemoryMemoryRepository, openSqliteMemoryRepository } from './storage/sqlite.js';
import { openPostgresMemoryRepository } from './storage/postgres.js';
import type { MemoryRepository } from './storage/repository.js';
import { HashEmbeddingProvider, type EmbeddingProvider } from './storage/vector.js';
import { MemoryPipeline } from './workers/pipeline.js';
import { MemoryRanker, hybridRank } from './retrieval/ranker.js';
import { openRelationshipStore, type RelationshipStore } from './providers/graph/store.js';
import {
  LocalMemoryProvider,
  Mem0MemoryProvider,
  type MemoryIntelligenceProvider,
} from './providers/mem0/provider.js';
import { buildSnapshot } from './cache/snapshot.js';
import { MemoryContextCache, lookupCachedPromptBlock } from './cache/context.js';
import { TtlCache, RedisL2 } from './cache/l1.js';
import { consolidateProjectMemories } from './workers/consolidation.js';
import { applySupersession } from './workers/conflict.js';
import { GitEvidenceSource, type EvidenceSource } from './providers/evidence.js';

export interface MemorySubsystemOptions {
  workspaceRoot: string;
  projectId?: string;
  settings?: Partial<MemorySettings>;
  store?: MemoryRepository;
  embedder?: EmbeddingProvider;
  graph?: RelationshipStore;
  intelligence?: MemoryIntelligenceProvider;
}

export class MemorySubsystem {
  readonly settings: MemorySettings;
  readonly metrics = new MemoryMetricsCollector();
  readonly buffer: LocalMemoryBuffer;
  readonly store: MemoryRepository;
  readonly bus = new InMemoryEventBus();
  readonly publisher: MemoryOutboxPublisher;
  readonly pipeline: MemoryPipeline;
  readonly graph: RelationshipStore;
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly ranker: MemoryRanker;
  readonly searchCache = new TtlCache<unknown>(30_000);
  readonly redis: RedisL2;
  readonly evidence: EvidenceSource;
  readonly contextCache: MemoryContextCache;
  private started = false;

  constructor(options: MemorySubsystemOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.projectId = options.projectId ?? 'default';
    this.contextCache = new MemoryContextCache(options.workspaceRoot);
    this.settings = readMemorySettings(options.settings);
    const wal = join(options.workspaceRoot, '.singularity', 'memory', 'events.wal');
    this.buffer = new LocalMemoryBuffer({
      walPath: wal,
      max: this.settings.queue_max,
      metrics: this.metrics,
    });
    this.store = options.store ?? openSqliteMemoryRepository(
      join(options.workspaceRoot, '.singularity', 'memory', 'memory.sqlite'),
    );
    this.graph =
      options.graph ??
      openRelationshipStore({
        neo4jUri: this.settings.neo4j_uri,
        neo4jUser: this.settings.neo4j_user,
        neo4jPassword: this.settings.neo4j_password,
      });
    const embedder =
      options.embedder ?? new HashEmbeddingProvider(this.settings.embedding_dimensions);
    const intelligence =
      options.intelligence ??
      (this.settings.mem0_enabled
        ? new Mem0MemoryProvider(this.settings.mem0_api_key, this.settings.mem0_base_url)
        : new LocalMemoryProvider());
    this.pipeline = new MemoryPipeline(
      this.store,
      this.settings,
      this.metrics,
      embedder,
      this.graph,
      intelligence,
      this.contextCache,
    );
    this.publisher = new MemoryOutboxPublisher(this.buffer, this.bus, this.metrics);
    this.ranker = new MemoryRanker(this.settings.ranker, this.settings.source_priority);
    this.redis = new RedisL2(this.settings.redis_url);
    this.evidence = new GitEvidenceSource(options.workspaceRoot);
  }

  async start(): Promise<void> {
    if (this.started || !isMemoryActive(this.settings)) {
      return;
    }
    await this.bus.subscribe('*', (e) => this.pipeline.handle(e));
    this.publisher.start();
    this.started = true;
  }

  stop(): void {
    this.publisher.stop();
    void this.store.close();
    void this.graph.close();
    this.started = false;
  }

  /** Coding plane: fire-and-forget. Never throws. */
  emit(event: Omit<MemoryEvent, 'event_id' | 'timestamp'> & Partial<MemoryEvent>): void {
    if (!isMemoryActive(this.settings)) {
      return;
    }
    try {
      this.buffer.append({
        ...event,
        project_id: event.project_id ?? this.projectId,
      });
    } catch {
      /* coding continues */
    }
  }

  /** Coding plane: cache/snapshot only. */
  lookup(taskOrEntity: string): string {
    if (!this.settings.context_enabled) {
      return '';
    }
    try {
      const snap =
        this.pipeline.snapshots.get(this.projectId) ??
        this.pipeline.snapshots.get(taskOrEntity);
      if (snap?.prompt_block) {
        this.metrics.recordSearch(0, true);
        return snap.prompt_block;
      }
      const cached = lookupCachedPromptBlock(this.contextCache, this.projectId);
      if (cached) {
        this.metrics.recordSearch(0, true);
        return cached;
      }
      this.metrics.recordSearch(0, false);
      return '';
    } catch {
      return '';
    }
  }

  async snapshot(): Promise<ProjectSnapshot> {
    const cached = this.pipeline.snapshots.get(this.projectId);
    if (cached) {
      return cached;
    }
    try {
      const list = await this.store.list({ project_id: this.projectId });
      const snap = buildSnapshot(
        this.projectId,
        list,
        this.settings.snapshot_token_budget,
        this.settings.snapshot_top_k,
      );
      this.pipeline.snapshots.set(this.projectId, snap);
      this.contextCache.set(this.projectId, snap);
      return snap;
    } catch {
      return emptySnapshot(this.projectId);
    }
  }

  async search(query: string, limit = 10, historical = false) {
    const t0 = Date.now();
    const cacheKey = `${this.projectId}:${query}:${limit}:${historical}`;
    const hit = this.searchCache.get(cacheKey);
    if (hit) {
      this.metrics.recordSearch(Date.now() - t0, true);
      return hit as Awaited<ReturnType<MemorySubsystem['searchUncached']>>;
    }
    const res = await this.searchUncached(query, limit, historical);
    this.searchCache.set(cacheKey, res);
    this.metrics.recordSearch(Date.now() - t0, false);
    return res;
  }

  private async searchUncached(query: string, limit: number, historical: boolean) {
    const memories = await this.store.list({ project_id: this.projectId });
    const embeddings = await this.store.listEmbeddings(this.projectId);
    const qEmb = (await new HashEmbeddingProvider(this.settings.embedding_dimensions).embed([query]))[0] ?? [];
    return hybridRank({
      query,
      queryEmbedding: qEmb,
      memories,
      embeddings,
      ranker: this.ranker,
      historical,
      limit,
    });
  }

  async createMemory(input: unknown): Promise<MemoryRecord> {
    const obj = typeof input === 'object' && input ? (input as Record<string, unknown>) : {};
    const ts = nowIso();
    const parsed = parseMemory({
      id: (obj.id as string) ?? newMemoryId(),
      project_id: this.projectId,
      type: obj.type ?? 'FACT',
      scope: obj.scope ?? 'PROJECT',
      title: obj.title ?? 'Untitled',
      content: obj.content ?? obj.title ?? 'Untitled',
      reason: obj.reason ?? '',
      status: obj.status ?? 'ACTIVE',
      importance: obj.importance ?? 0.9,
      confidence: obj.confidence ?? 0.98,
      source_type: obj.source_type ?? 'HUMAN',
      source_id: obj.source_id ?? 'human',
      task_id: obj.task_id,
      agent_id: obj.agent_id,
      entities: obj.entities ?? [],
      embedding_pending: true,
      created_at: ts,
      updated_at: ts,
    });
    await this.store.insert(parsed);
    this.searchCache.invalidate(this.projectId);
    void this.pipeline.afterPersist(parsed);
    return parsed;
  }

  async getMemory(id: string): Promise<MemoryRecord | undefined> {
    return this.store.get(this.projectId, id);
  }

  async patchMemory(id: string, patch: Record<string, unknown>): Promise<MemoryRecord | undefined> {
    const cur = await this.store.get(this.projectId, id);
    if (!cur) {
      return undefined;
    }
    const next = MemoryRecordSchema.parse({
      ...cur,
      ...patch,
      id: cur.id,
      project_id: this.projectId,
      updated_at: nowIso(),
    });
    if (patch.status === 'INVALIDATED' || patch.status === 'ARCHIVED' || patch.forget) {
      next.status = patch.status === 'ARCHIVED' ? 'ARCHIVED' : 'INVALIDATED';
    }
    await this.store.patch(this.projectId, next);
    this.searchCache.invalidate(this.projectId);
    return next;
  }

  async supersede(oldId: string, newId: string) {
    const oldM = await this.store.get(this.projectId, oldId);
    const newM = await this.store.get(this.projectId, newId);
    if (!oldM || !newM) {
      return { old: oldM, next: newM };
    }
    const { old, next, version } = applySupersession(oldM, newM);
    await this.store.insertVersion(version);
    await this.store.patch(this.projectId, old);
    await this.store.patch(this.projectId, next);
    return { old, next };
  }

  async consolidate() {
    const intel = this.settings.mem0_enabled
      ? new Mem0MemoryProvider(this.settings.mem0_api_key, this.settings.mem0_base_url)
      : new LocalMemoryProvider();
    const rec = await consolidateProjectMemories(this.store, this.projectId, intel);
    if (rec) {
      this.metrics.recordConsolidation();
    }
    return rec;
  }

  async relationships(entity: string) {
    return this.graph.traverse(entity.includes(':') ? entity : `Technology:${entity}`, 2);
  }

  compact(memory: MemoryRecord) {
    return {
      id: memory.id,
      type: memory.type,
      status: memory.status,
      title: memory.title,
      importance: memory.importance,
      confidence: memory.confidence,
      source_type: memory.source_type,
    };
  }
}

export async function createMemorySubsystem(
  options: MemorySubsystemOptions,
): Promise<MemorySubsystem> {
  let store = options.store;
  const settings = readMemorySettings(options.settings);
  if (!store && settings.database_url) {
    try {
      store = await openPostgresMemoryRepository(settings.database_url);
    } catch {
      store = undefined;
    }
  }
  return new MemorySubsystem({ ...options, store, settings });
}

export function createMemoryStore(): MemoryRepository {
  return new InMemoryMemoryRepository();
}

export { estimateTokens };
