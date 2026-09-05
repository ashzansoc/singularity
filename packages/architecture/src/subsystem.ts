import { join } from 'node:path';
import {
  isArchitectureMemoryActive,
  readArchitectureFlags,
  type ArchitectureFlags,
} from './flags.js';
import { ArchitectureMetricsCollector } from './metrics.js';
import { LocalEventBuffer } from './events/localBuffer.js';
import { InMemoryEventBus } from './events/memoryBus.js';
import { OutboxPublisher } from './events/outboxPublisher.js';
import type { DomainEvent, EventBus } from './events/types.js';
import { ArchitectureContextCache, lookupCachedContextBlock } from './context/cache.js';
import {
  MemoryDecisionStore,
  openDecisionStore,
  type DecisionStore,
} from './memory/sqliteStore.js';
import { ArchitecturePipeline } from './workers/pipeline.js';
import { AdrExtractor } from './extraction/adrExtractor.js';
import { hybridSearch } from './memory/hybridRetrieve.js';
import { transitionAdr } from './domain/adr/lifecycle.js';
import type { Adr } from './domain/adr/schema.js';
import { parseAdr } from './domain/adr/schema.js';
import type { GraphSink } from './graph/graphSink.js';
import type { GraphBackend } from './graph/backend.js';
import type { MemorySink } from './graph/memorySink.js';
import { openGraphBackend } from './graph/neo4jBackend.js';
import { detectConflicts } from './graph/conflicts.js';
import { graphImpact } from './graph/impact.js';
import { projectAdrToGraph } from './graph/builder.js';
import { nodeId } from './graph/types.js';
import { heuristicExtractAdr } from './extraction/heuristic.js';
import { applySupersession } from './domain/adr/lifecycle.js';
import { validateAdrDeep, type ValidationResult } from './domain/adr/validation.js';
import { detectDrift } from './workers/drift.js';
import { attachProductionEvidence } from './workers/production.js';
import { proposeEvolution } from './workers/evolution.js';
import {
  ingestProductionEvent,
  ProductionSeenSet,
} from './production/ingest.js';
import { correlateProductionEvent } from './production/correlate.js';
import { queryProductionMaterialized } from './production/query.js';
import { parseProductionEvent, PRODUCTION_EVENT_TYPES, productionIdempotencyKey } from './production/schema.js';
import { readStoredDebugContext } from './production/debugContext.js';
import type { DriftStatus } from './memory/decisionStore.js';
import type { CodeImpactProvider, ImpactAnalysisResult } from './impact/types.js';
import { ingestImpactAnalysis, parseImpactRequest } from './impact/ingest.js';
import {
  impactFingerprint,
  readArchitectureVersion,
} from './impact/fingerprint.js';
import { runStoredImpactAnalysis, storedToResult } from './impact/worker.js';
import type { RiskAssessment } from './risk/types.js';
import { ingestRiskAssessment, parseRiskRequest } from './risk/ingest.js';
import { riskFingerprint } from './risk/fingerprint.js';
import { applyFreshness, runStoredRiskAssessment } from './risk/worker.js';

export interface ArchitectureSubsystemOptions {
  workspaceRoot: string;
  projectId?: string;
  flags?: Partial<ArchitectureFlags>;
  store?: DecisionStore;
  graph?: GraphSink;
  archGraph?: GraphBackend;
  persistGraph?: boolean;
  extractor?: AdrExtractor;
  memorySink?: MemorySink;
  /** Skip LangExtract; heuristic only (tests). */
  heuristicOnly?: boolean;
  /** Intelligence-plane code blast radius (Tree-sitter/SCIP graph). Never on coding path. */
  codeImpact?: CodeImpactProvider;
}

/**
 * Intelligence-plane owner. Coding plane should only use buffer.append + cache lookup.
 */
export class ArchitectureSubsystem {
  readonly flags: ArchitectureFlags;
  readonly metrics = new ArchitectureMetricsCollector();
  readonly buffer: LocalEventBuffer;
  readonly cache: ArchitectureContextCache;
  readonly store: DecisionStore;
  readonly bus: EventBus;
  readonly publisher: OutboxPublisher;
  readonly pipeline: ArchitecturePipeline;
  readonly archGraph: GraphBackend;
  readonly projectId: string;
  readonly workspaceRoot: string;
  readonly productionSeen = new ProductionSeenSet();
  private readonly memorySink?: MemorySink;
  private readonly codeImpact?: CodeImpactProvider;
  private started = false;

  constructor(options: ArchitectureSubsystemOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.projectId = options.projectId ?? 'default';
    this.memorySink = options.memorySink;
    this.codeImpact = options.codeImpact;
    this.flags = readArchitectureFlags(options.flags);
    this.cache = new ArchitectureContextCache(options.workspaceRoot);
    const wal = join(options.workspaceRoot, '.singularity', 'architecture', 'events.wal');
    this.buffer = new LocalEventBuffer({ walPath: wal, metrics: this.metrics });
    const dbPath = join(
      options.workspaceRoot,
      '.singularity',
      'architecture',
      'architecture.sqlite',
    );
    this.store = options.store ?? openDecisionStore(dbPath);
    this.archGraph =
      options.archGraph ??
      openGraphBackend({
        workspaceRoot: options.workspaceRoot,
        persist: options.persistGraph,
      });
    this.bus = new InMemoryEventBus();
    this.publisher = new OutboxPublisher(this.buffer, this.bus, this.metrics);
    const extractor =
      options.extractor ??
      (options.heuristicOnly
        ? ({
            extract: async (text: string) => heuristicExtractAdr(text),
          } as AdrExtractor)
        : undefined);
    this.pipeline = new ArchitecturePipeline(
      this.store,
      this.cache,
      this.flags,
      this.metrics,
      this.bus,
      options.workspaceRoot,
      options.graph,
      extractor,
      this.archGraph,
      this.codeImpact,
      this.buffer,
    );
  }

  async start(): Promise<void> {
    if (this.started || !isArchitectureMemoryActive(this.flags)) {
      return;
    }
    const types = [
      'USER_INTENT_CAPTURED',
      'CODE_CHANGE_COMPLETED',
      'FILE_CREATED',
      'FILE_MODIFIED',
      'FILE_DELETED',
      'COMMIT_CREATED',
      'COMMIT_PUSHED',
      'PR_CREATED',
      'PR_UPDATED',
      'PR_MERGED',
      'ADR_CREATED',
      'ADR_UPDATED',
      'ADR_SUPERSEDED',
      'ARCHITECTURE_VALIDATION_REQUESTED',
      'ARCHITECTURE_DRIFT_SCAN_REQUESTED',
      'ARCHITECTURE_IMPACT_ANALYSIS_REQUESTED',
      'ARCHITECTURE_MISSION_RISK_ASSESSMENT_REQUESTED',
      'DEPLOYMENT_CREATED',
      'TEST_CREATED',
      ...(this.flags.production_awareness_enabled ? PRODUCTION_EVENT_TYPES : []),
    ];
    const unique = [...new Set(types)];
    for (const t of unique) {
      await this.bus.subscribe(t, (e) => this.pipeline.handle(e));
    }
    this.publisher.start();
    this.started = true;
  }

  stop(): void {
    this.publisher.stop();
    this.store.close();
    this.archGraph.close();
    this.started = false;
  }

  /** Coding plane: fire-and-forget. */
  emit(
    event: Omit<DomainEvent, 'event_id' | 'timestamp' | 'event_version'> & Partial<DomainEvent>,
  ): void {
    if (!isArchitectureMemoryActive(this.flags)) {
      return;
    }
    this.buffer.append({
      ...event,
      project_id: event.project_id ?? this.projectId,
    });
  }

  private rememberAdr(adr: Adr): void {
    try {
      this.memorySink?.remember({
        project_id: adr.project_id,
        type: 'ARCHITECTURAL_DECISION',
        title: adr.title,
        content: adr.decision.summary,
        reason: adr.problem,
        source_id: adr.id,
        entities: adr.affected_components,
      });
    } catch {
      /* memory never blocks architecture */
    }
  }

  /** Coding plane: cache read only. */
  lookup(taskOrEntity: string): string {
    if (!this.flags.architecture_context_enabled) {
      return '';
    }
    try {
      const block = lookupCachedContextBlock(this.cache, taskOrEntity);
      if (block) {
        this.metrics.recordCacheHit();
      } else {
        this.metrics.recordCacheMiss();
      }
      return block;
    } catch {
      this.metrics.recordCacheMiss();
      return '';
    }
  }

  async search(query: string, opts?: { historical?: boolean }): Promise<Adr[]> {
    const hits = await hybridSearch(this.store, this.projectId, query, opts);
    return hits.map((h) => h.adr);
  }

  explain(entity: string): string {
    return this.lookup(entity);
  }

  checkConflicts(change: string, files?: string[]): Array<{
    conflict: boolean;
    severity: string;
    decision: string;
    reason: string;
  }> {
    if (!this.flags.architecture_conflict_detection_enabled) {
      return this.store.listConflicts(this.projectId).map((c) => ({
        conflict: true,
        severity: c.severity,
        decision: c.adr_id,
        reason: c.reason,
      }));
    }
    const found = detectConflicts({
      project_id: this.projectId,
      change,
      affected_files: files,
      adrs: this.store.list({ project_id: this.projectId }),
      graph: this.archGraph,
    });
    for (const c of found) {
      this.store.insertConflict(c);
    }
    return found.map((c) => ({
      conflict: true,
      severity: c.severity,
      decision: c.adr_id,
      reason: c.reason,
    }));
  }

  impact(change: { change?: string; affected_files?: string[] }) {
    return graphImpact({
      change: change.change,
      affected_files: change.affected_files,
      adrs: this.store.list({ project_id: this.projectId }),
      graph: this.archGraph,
      conflictIds: this.store.listConflicts(this.projectId).map((c) => c.adr_id),
      driftIds: this.store.listDrifts(this.projectId).map((d) => d.adr_id),
    });
  }

  /** Intelligence-plane ingest. Never computes blast radius. */
  ingestImpact(input: unknown) {
    return ingestImpactAnalysis(input, {
      projectId: this.projectId,
      buffer: this.buffer,
      flags: this.flags,
      store: this.store,
      metrics: this.metrics,
    });
  }

  /** Cache/store read only. Miss does not enqueue or compute. */
  lookupImpact(idOrFingerprint: string): ImpactAnalysisResult | undefined {
    try {
      const byId = this.store.getImpactAnalysis(idOrFingerprint);
      const row = byId ?? this.store.getImpactByFingerprint(idOrFingerprint);
      if (!row) {
        this.metrics.recordImpactCacheMiss();
        return undefined;
      }
      this.metrics.recordImpactCacheHit();
      return storedToResult(row);
    } catch {
      this.metrics.recordImpactCacheMiss();
      return undefined;
    }
  }

  lookupImpactByRequest(input: unknown): ImpactAnalysisResult | undefined {
    const req = parseImpactRequest(input);
    const fp = impactFingerprint(req, readArchitectureVersion(this.store, this.projectId));
    return this.lookupImpact(fp);
  }

  /** Intelligence plane only. */
  async runImpact(analysisId: string): Promise<ImpactAnalysisResult | undefined> {
    return runStoredImpactAnalysis({
      analysisId,
      store: this.store,
      flags: this.flags,
      workspaceRoot: this.workspaceRoot,
      graph: this.archGraph,
      codeImpact: this.codeImpact,
      metrics: this.metrics,
      bus: this.bus,
    });
  }

  getImpact(analysisId: string): ImpactAnalysisResult | undefined {
    const row = this.store.getImpactAnalysis(analysisId);
    return row ? storedToResult(row) : undefined;
  }

  listImpacts(limit = 50): ImpactAnalysisResult[] {
    return this.store.listImpactAnalyses(this.projectId, limit).map(storedToResult);
  }

  /** Intelligence-plane ingest. Never scores risk. */
  ingestRisk(input: unknown) {
    return ingestRiskAssessment(input, {
      projectId: this.projectId,
      buffer: this.buffer,
      flags: this.flags,
      store: this.store,
      metrics: this.metrics,
    });
  }

  /** Cache/store read only. Miss does not enqueue or compute. */
  lookupRisk(idOrFingerprint: string): RiskAssessment | undefined {
    try {
      const byId = this.store.getRiskAssessment(idOrFingerprint);
      const row = byId ?? this.store.getRiskByFingerprint(idOrFingerprint);
      if (!row) {
        this.metrics.recordRiskCacheMiss();
        return undefined;
      }
      this.metrics.recordRiskCacheHit();
      return applyFreshness(row, this.store, this.metrics);
    } catch {
      this.metrics.recordRiskCacheMiss();
      return undefined;
    }
  }

  lookupRiskByMission(missionId: string): RiskAssessment | undefined {
    const rows = this.store.listRiskByMission(this.projectId, missionId, 1);
    const row = rows[0];
    if (!row) {
      this.metrics.recordRiskCacheMiss();
      return undefined;
    }
    this.metrics.recordRiskCacheHit();
    return applyFreshness(row, this.store, this.metrics);
  }

  lookupRiskByRequest(input: unknown): RiskAssessment | undefined {
    const req = parseRiskRequest(input);
    const fp = riskFingerprint(req, readArchitectureVersion(this.store, this.projectId));
    return this.lookupRisk(fp);
  }

  /** Intelligence plane only. */
  async runRisk(assessmentId: string): Promise<RiskAssessment | undefined> {
    return runStoredRiskAssessment({
      assessmentId,
      store: this.store,
      flags: this.flags,
      workspaceRoot: this.workspaceRoot,
      graph: this.archGraph,
      codeImpact: this.codeImpact,
      metrics: this.metrics,
      bus: this.bus,
      buffer: this.buffer,
    });
  }

  getRisk(assessmentId: string): RiskAssessment | undefined {
    const row = this.store.getRiskAssessment(assessmentId);
    return row ? applyFreshness(row, this.store, this.metrics) : undefined;
  }

  listRisks(limit = 50): RiskAssessment[] {
    return this.store.listRiskAssessments(this.projectId, limit).map((r) =>
      applyFreshness(r, this.store, this.metrics),
    );
  }

  history(entity: string): Adr[] {
    return this.store
      .list({ project_id: this.projectId })
      .filter(
        (a) =>
          a.id === entity ||
          a.affected_components.includes(entity) ||
          a.title.toLowerCase().includes(entity.toLowerCase()),
      );
  }

  createAdr(input: unknown): Adr {
    const obj = typeof input === 'object' && input ? (input as Record<string, unknown>) : {};
    const parsed = parseAdr({
      ...obj,
      project_id: this.projectId,
      id: (obj.id as string) ?? this.store.nextAdrId(this.projectId),
      timestamps: {
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      decision:
        (obj.decision as { summary: string } | undefined) ?? {
          summary: String(obj.title ?? 'Untitled'),
        },
    });
    this.store.insert(parsed);
    this.rememberAdr(parsed);
    if (this.flags.architecture_graph_enabled) {
      projectAdrToGraph(this.archGraph, parsed);
    }
    this.emit({
      event_type: 'ADR_CREATED',
      project_id: this.projectId,
      payload: { adr_id: parsed.id },
    });
    return parsed;
  }

  patchAdr(id: string, patch: Partial<Adr> & { status?: Adr['status'] }): Adr | undefined {
    const cur = this.store.get(id);
    if (!cur) {
      return undefined;
    }
    let next: Adr = { ...cur, ...patch, id: cur.id, version: cur.version };
    if (patch.status && patch.status !== cur.status) {
      next = transitionAdr(cur, patch.status, patch.relationships?.superseded_by);
      next = { ...next, ...patch, status: next.status, version: next.version };
    }
    next.timestamps = { ...next.timestamps, updated_at: new Date().toISOString() };
    this.store.update(next);
    if (this.flags.architecture_graph_enabled) {
      projectAdrToGraph(this.archGraph, next);
    }
    this.emit({
      event_type: patch.status === 'superseded' ? 'ADR_SUPERSEDED' : 'ADR_UPDATED',
      project_id: this.projectId,
      payload: { adr_id: id },
    });
    return next;
  }

  review(id: string, action: 'accept' | 'reject' | 'edit', edit?: Partial<Adr>): Adr | undefined {
    if (action === 'accept') {
      return this.patchAdr(id, { status: 'accepted', record_kind: 'decision' });
    }
    if (action === 'reject') {
      return this.patchAdr(id, { status: 'rejected' });
    }
    return this.patchAdr(id, { ...edit, record_kind: 'decision' });
  }

  supersede(oldId: string, newId: string): { old?: Adr; next?: Adr } {
    const oldAdr = this.store.get(oldId);
    const newAdr = this.store.get(newId);
    if (!oldAdr || !newAdr) {
      return { old: oldAdr, next: newAdr };
    }
    const { old, next } = applySupersession(oldAdr, newAdr);
    this.store.update(old);
    this.store.update(next);
    this.rememberAdr(next);
    if (this.flags.architecture_graph_enabled) {
      projectAdrToGraph(this.archGraph, old);
      projectAdrToGraph(this.archGraph, next);
    }
    this.emit({
      event_type: 'ADR_SUPERSEDED',
      project_id: this.projectId,
      payload: { adr_id: oldId, superseded_by: newId },
    });
    return { old, next };
  }

  neighborhood(entity: string, depth = 2) {
    const id = entity.includes(':') ? entity : nodeId('Service', entity);
    const adrId = entity.startsWith('ADR-') ? nodeId('ADR', entity) : id;
    const start = this.archGraph.getNode(adrId)
      ? adrId
      : this.archGraph.getNode(id)
        ? id
        : this.archGraph.getNode(nodeId('File', entity))
          ? nodeId('File', entity)
          : adrId;
    return this.archGraph.neighbors(start, depth);
  }

  scanDrift(files?: string[]) {
    if (!this.flags.architecture_drift_detection_enabled) {
      return this.store.listDrifts(this.projectId);
    }
    const found = detectDrift({
      workspaceRoot: this.workspaceRoot,
      project_id: this.projectId,
      adrs: this.store.list({ project_id: this.projectId }),
      extraFiles: files,
    });
    for (const d of found) {
      this.store.insertDrift(d);
    }
    return found;
  }

  attachEvidence(event: DomainEvent) {
    return attachProductionEvidence(this.store, this.archGraph, this.projectId, event, this.metrics);
  }

  ingestProduction(input: unknown) {
    return ingestProductionEvent(input, {
      projectId: this.projectId,
      buffer: this.buffer,
      flags: this.flags,
      seen: this.productionSeen,
      metrics: this.metrics,
      store: this.store,
    });
  }

  processProductionSync(input: unknown) {
    const parsed = parseProductionEvent(input);
    try {
      this.store.upsertProductionEvent({
        event_id: parsed.event_id,
        project_id: this.projectId,
        idempotency_key: productionIdempotencyKey(parsed),
        event_type: parsed.event_type,
        timestamp: parsed.timestamp,
        received_at: parsed.timestamp,
        json: JSON.stringify(parsed),
      });
    } catch {
      /* ignore */
    }
    return correlateProductionEvent(this.store, this.archGraph, this.projectId, parsed, this.metrics);
  }

  queryProduction(q = 'incidents') {
    return queryProductionMaterialized(this.store, this.archGraph, this.projectId, q);
  }

  getProductionEvent(id: string) {
    const row = this.store.getProductionEvent(id);
    if (!row) {
      return undefined;
    }
    try {
      return JSON.parse(row.json);
    } catch {
      return row;
    }
  }

  debugContext(incidentId: string) {
    return readStoredDebugContext(this.store, incidentId);
  }

  patchDrift(id: string, status: DriftStatus) {
    const d = this.store.getDrift(id);
    if (!d) {
      return undefined;
    }
    const next = { ...d, status };
    this.store.updateDrift(next);
    return next;
  }

  evolve(trigger: 'drift' | 'incident' | 'deployment_failure' | 'validation' = 'drift') {
    if (!this.flags.architecture_evolution_enabled) {
      return this.store.listEvolutions(this.projectId);
    }
    const drifts = this.scanDrift();
    return proposeEvolution({
      store: this.store,
      project_id: this.projectId,
      adrs: this.store.list({ project_id: this.projectId }),
      drifts,
      trigger,
    });
  }

  validateAdr(id: string): ValidationResult | undefined {
    this.scanDrift();
    const adr = this.store.get(id);
    if (!adr) {
      return undefined;
    }
    const result = validateAdrDeep(adr, this.store.listDrifts(this.projectId));
    this.store.update(result.adr);
    if (result.status === 'failed' && this.flags.architecture_evolution_enabled) {
      proposeEvolution({
        store: this.store,
        project_id: this.projectId,
        adrs: this.store.list({ project_id: this.projectId }),
        drifts: this.store.listDrifts(this.projectId),
        trigger: 'validation',
      });
    }
    this.emit({
      event_type: 'ARCHITECTURE_VALIDATION_COMPLETED',
      project_id: this.projectId,
      payload: { adr_id: id, status: result.status, notes: result.notes },
    });
    return result;
  }
}

export function createArchitectureSubsystem(
  options: ArchitectureSubsystemOptions,
): ArchitectureSubsystem {
  return new ArchitectureSubsystem(options);
}

export function createMemoryStore(): DecisionStore {
  return new MemoryDecisionStore();
}

export const architectureFacade = {
  lookup(sys: ArchitectureSubsystem, entity: string): string {
    return sys.lookup(entity);
  },
  search(sys: ArchitectureSubsystem, query: string): Promise<Adr[]> {
    return sys.search(query);
  },
  explain(sys: ArchitectureSubsystem, entity: string): string {
    return sys.explain(entity);
  },
  check_conflicts(sys: ArchitectureSubsystem, change: string) {
    return sys.checkConflicts(change);
  },
  impact(sys: ArchitectureSubsystem, change: { change?: string; affected_files?: string[] }) {
    return sys.impact(change);
  },
  history(sys: ArchitectureSubsystem, entity: string) {
    return sys.history(entity);
  },
};
