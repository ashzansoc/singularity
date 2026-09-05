import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifySignificance, shouldEnterAdrPipeline } from '../domain/adr/significance.js';
import { applySupersession, isActiveStatus } from '../domain/adr/lifecycle.js';
import { validateAdrDeep } from '../domain/adr/validation.js';
import { embedText, nowIso, type Adr } from '../domain/adr/schema.js';
import type { DomainEvent } from '../events/types.js';
import { createDomainEvent } from '../events/types.js';
import type { EventBus } from '../events/types.js';
import { candidateToAdr } from '../extraction/heuristic.js';
import { AdrExtractor } from '../extraction/adrExtractor.js';
import type { DecisionStore } from '../memory/decisionStore.js';
import { HashArchitectureEmbedder } from '../memory/vectorStore.js';
import {
  ArchitectureContextCache,
  buildCachedContext,
} from '../context/cache.js';
import type { ArchitectureMetricsCollector } from '../metrics.js';
import type { ArchitectureFlags } from '../flags.js';
import type { GraphSink } from '../graph/graphSink.js';
import type { GraphBackend } from '../graph/backend.js';
import { projectAdrToGraph } from '../graph/builder.js';
import { detectConflicts } from '../graph/conflicts.js';
import { attachEvidenceToMatchingAdrs, readCommitEvidence } from '../graph/evidence.js';
import { detectDrift } from './drift.js';
import { attachProductionEvidence } from './production.js';
import { proposeEvolution } from './evolution.js';
import { IntelligenceWorkerPool } from './pool.js';
import { isProductionDomainType } from '../production/correlate.js';
import { productionEventFromDomain } from '../production/schema.js';
import { buildReactiveDebugContext } from '../production/debugContext.js';
import { readCorrelationPolicy, type CorrelationPolicy } from '../production/policy.js';
import type { LocalEventBuffer } from '../events/localBuffer.js';
import { bumpArchitectureVersion } from '../impact/fingerprint.js';
import { runStoredImpactAnalysis } from '../impact/worker.js';
import type { CodeImpactProvider } from '../impact/types.js';
import { ingestRiskAssessment } from '../risk/ingest.js';
import { runStoredRiskAssessment } from '../risk/worker.js';

export class ArchitecturePipeline {
  readonly pool = new IntelligenceWorkerPool(2);
  private readonly extractor: AdrExtractor;
  private readonly embedder = new HashArchitectureEmbedder();
  private seq = 0;
  private lastDriftAt = 0;
  private readonly policy: CorrelationPolicy = readCorrelationPolicy();

  constructor(
    private readonly store: DecisionStore,
    private readonly cache: ArchitectureContextCache,
    private readonly flags: ArchitectureFlags,
    private readonly metrics: ArchitectureMetricsCollector,
    private readonly bus: EventBus,
    private readonly workspaceRoot: string,
    private readonly graph?: GraphSink,
    extractor?: AdrExtractor,
    private readonly archGraph?: GraphBackend,
    private readonly codeImpact?: CodeImpactProvider,
    private readonly buffer?: LocalEventBuffer,
  ) {
    this.extractor = extractor ?? new AdrExtractor();
  }

  async handle(event: DomainEvent): Promise<void> {
    const t0 = Date.now();
    try {
      await this.pool.run(async () => {
        await this.dispatch(event);
      });
    } catch {
      /* intelligence failures never reach coding */
    } finally {
      this.metrics.recordProcessing(Date.now() - t0);
    }
  }

  private async dispatch(event: DomainEvent): Promise<void> {
    switch (event.event_type) {
      case 'FILE_CREATED':
      case 'FILE_MODIFIED':
      case 'FILE_DELETED':
      case 'CODE_CHANGE_COMPLETED':
      case 'USER_INTENT_CAPTURED':
      case 'COMMIT_CREATED':
      case 'COMMIT_PUSHED':
      case 'PR_CREATED':
      case 'PR_UPDATED':
      case 'PR_MERGED':
        await this.onChange(event);
        return;
      case 'ADR_CREATED':
      case 'ADR_UPDATED':
      case 'ADR_SUPERSEDED':
        await this.onAdrMutated(event);
        return;
      case 'ARCHITECTURE_VALIDATION_REQUESTED':
        await this.onValidate(event);
        return;
      case 'ARCHITECTURE_DRIFT_SCAN_REQUESTED':
        this.refreshDrift(
          event.project_id,
          Array.isArray(event.payload?.affected_files)
            ? (event.payload.affected_files as unknown[]).filter((f): f is string => typeof f === 'string')
            : event.changed_files,
          true,
        );
        this.recomputeCache(event.project_id);
        return;
      case 'ARCHITECTURE_IMPACT_ANALYSIS_REQUESTED':
        await this.onImpact(event);
        return;
      case 'ARCHITECTURE_MISSION_RISK_ASSESSMENT_REQUESTED':
        await this.onRisk(event);
        return;
      default:
        if (isProductionDomainType(event.event_type)) {
          this.onProduction(event);
        }
        return;
    }
  }

  private async onChange(event: DomainEvent): Promise<void> {
    if (
      event.event_type === 'FILE_CREATED' ||
      event.event_type === 'FILE_MODIFIED' ||
      event.event_type === 'FILE_DELETED' ||
      event.event_type === 'CODE_CHANGE_COMPLETED' ||
      event.event_type === 'COMMIT_CREATED' ||
      event.event_type === 'COMMIT_PUSHED' ||
      event.event_type === 'PR_CREATED' ||
      event.event_type === 'PR_UPDATED' ||
      event.event_type === 'PR_MERGED'
    ) {
      bumpArchitectureVersion(this.store, event.project_id);
    }
    if (
      event.event_type === 'COMMIT_CREATED' ||
      event.event_type === 'COMMIT_PUSHED' ||
      event.event_type === 'PR_CREATED' ||
      event.event_type === 'PR_MERGED' ||
      event.event_type === 'PR_UPDATED'
    ) {
      const git =
        event.event_type.startsWith('COMMIT')
          ? readCommitEvidence(this.workspaceRoot, event.commit_id)
          : undefined;
      if (this.archGraph) {
        attachEvidenceToMatchingAdrs(
          this.store,
          this.archGraph,
          event.project_id,
          event,
          git,
        );
      }
    }
    this.markDriftStale(event.project_id, event.changed_files);
    this.refreshDrift(event.project_id, event.changed_files);
    const text = this.collectText(event);
    const level = classifySignificance({
      text,
      changed_files: event.changed_files,
    });
    if (!shouldEnterAdrPipeline(level) || !this.flags.adr_extraction_enabled) {
      return;
    }
    await this.bus.publish(
      createDomainEvent({
        event_type: 'ARCHITECTURAL_CHANGE_DETECTED',
        project_id: event.project_id,
        session_id: event.session_id,
        task_id: event.task_id,
        parent_event_id: event.event_id,
        trace_id: event.trace_id,
        changed_files: event.changed_files,
        payload: { significance: level },
      }),
    );
    const t1 = Date.now();
    const extracted = await this.extractor.extract(text);
    this.metrics.recordExtraction(Date.now() - t1);
    if (!extracted) {
      return;
    }
    if (extracted.action === 'observation') {
      this.store.insertObservation({
        id: `obs_${Date.now()}_${++this.seq}`,
        project_id: event.project_id,
        text: extracted.decision,
        confidence: extracted.confidence,
        source: event.event_id,
        created_at: nowIso(),
      });
      return;
    }
    const id = this.store.nextAdrId(event.project_id);
    const adr = candidateToAdr(event.project_id, id, extracted, {
      provenance: [
        {
          type: event.event_type === 'COMMIT_CREATED' ? 'commit' : 'conversation',
          project_id: event.project_id,
          session_id: event.session_id,
          task_id: event.task_id,
          commit_id: event.commit_id,
        },
      ],
      evidence: {
        commits: event.commit_id
          ? [{ type: 'commit', id: event.commit_id, relationship: 'implemented_decision' }]
          : [],
        pull_requests: [],
        tests: [],
        documents: [],
        conversations:
          event.session_id
            ? [{ type: 'conversation', id: event.session_id, relationship: 'discussed' }]
            : [],
        code: (event.changed_files ?? []).map((f) => ({
          type: 'code' as const,
          id: f,
          relationship: 'touches',
        })),
        incidents: [],
        deployments: [],
        metrics: [],
      },
    });
    if (extracted.action === 'create_candidate' && extracted.confidence >= 0.9) {
      adr.status = 'accepted';
      adr.record_kind = 'decision';
    }
    this.store.insert(adr);
    this.maybeSupersede(adr);
    await this.embedAdr(adr);
    this.projectGraph(adr);
    this.refreshConflicts(event.project_id, event.payload?.text ? String(event.payload.text) : adr.decision.summary, event.changed_files);
    this.refreshDrift(event.project_id, event.changed_files);
    await this.bus.publish(
      createDomainEvent({
        event_type: 'ADR_CREATED',
        project_id: event.project_id,
        parent_event_id: event.event_id,
        trace_id: event.trace_id,
        payload: { adr_id: adr.id, record_kind: adr.record_kind },
      }),
    );
    this.recomputeCache(event.project_id);
  }

  private onProduction(event: DomainEvent): void {
    if (!this.flags.production_awareness_enabled) {
      return;
    }
    try {
      attachProductionEvidence(this.store, this.archGraph, event.project_id, event, this.metrics);
      const prod = productionEventFromDomain(event);
      if (prod && event.event_type === 'INCIDENT_REPORTED') {
        buildReactiveDebugContext(
          this.store,
          this.archGraph,
          event.project_id,
          prod,
          this.policy,
          this.metrics,
        );
        void this.bus.publish(
          createDomainEvent({
            event_type: 'ARCHITECTURE_DEBUG_CONTEXT_READY',
            project_id: event.project_id,
            parent_event_id: event.event_id,
            payload: { incident_id: prod.payload?.incident_id ?? prod.event_id },
          }),
        );
      }
      if (event.event_type === 'INCIDENT_REPORTED' || event.event_type === 'DEPLOYMENT_FAILED') {
        this.maybeEvolve(
          event.project_id,
          event.event_type === 'INCIDENT_REPORTED' ? 'incident' : 'deployment_failure',
        );
      }
      this.pruneProduction();
      this.recomputeCache(event.project_id);
    } catch {
      this.metrics.recordProductionFailed();
    }
  }

  private pruneProduction(): void {
    try {
      const cutoff = new Date(Date.now() - this.policy.retentionRawMs).toISOString();
      this.store.pruneProductionEvents(cutoff);
    } catch {
      /* retention never blocks */
    }
  }

  markDriftStale(projectId: string, files?: string[]): void {
    const key = `drift_stale:${projectId}`;
    let prev: { files?: string[] } = {};
    try {
      prev = JSON.parse(this.store.getKv(key) ?? '{}') as { files?: string[] };
    } catch {
      prev = {};
    }
    const next = [...new Set([...(prev.files ?? []), ...(files ?? [])])].slice(0, 200);
    this.store.setKv(key, JSON.stringify({ files: next, at: nowIso() }));
  }

  private async onAdrMutated(event: DomainEvent): Promise<void> {
    bumpArchitectureVersion(this.store, event.project_id);
    const id = String(event.payload?.adr_id ?? '');
    const adr = id ? this.store.get(id) : undefined;
    if (adr) {
      await this.embedAdr(adr);
      this.projectGraph(adr);
    }
    this.recomputeCache(event.project_id);
    this.requeueRisk(event.project_id);
  }

  private async onValidate(event: DomainEvent): Promise<void> {
    const id = String(event.payload?.adr_id ?? '');
    this.refreshDrift(event.project_id, event.changed_files, true);
    const adr = this.store.get(id);
    if (!adr) {
      return;
    }
    const result = validateAdrDeep(adr, this.store.listDrifts(event.project_id));
    this.store.update(result.adr);
    if (result.status === 'failed') {
      this.maybeEvolve(event.project_id, 'validation');
    }
    await this.bus.publish(
      createDomainEvent({
        event_type: 'ARCHITECTURE_VALIDATION_COMPLETED',
        project_id: event.project_id,
        parent_event_id: event.event_id,
        payload: { adr_id: id, status: result.status, notes: result.notes },
      }),
    );
    this.recomputeCache(event.project_id);
  }

  private async onImpact(event: DomainEvent): Promise<void> {
    const analysisId = String(event.payload?.analysis_id ?? '');
    if (!analysisId) {
      return;
    }
    await runStoredImpactAnalysis({
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

  private async onRisk(event: DomainEvent): Promise<void> {
    const assessmentId = String(event.payload?.assessment_id ?? '');
    if (!assessmentId) {
      return;
    }
    await runStoredRiskAssessment({
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

  private requeueRisk(projectId: string): void {
    if (!this.buffer || this.flags.mission_risk_scoring_enabled === false) {
      return;
    }
    const rows = this.store.listRiskAssessments(projectId, 20).filter((r) => r.status === 'completed');
    for (const row of rows) {
      try {
        const req = JSON.parse(row.request_json) as unknown;
        ingestRiskAssessment(req, {
          projectId,
          buffer: this.buffer,
          flags: this.flags,
          store: this.store,
          metrics: this.metrics,
        });
        this.metrics.recordRiskRecompute();
      } catch {
        /* never block ADR mutate */
      }
    }
  }

  private collectText(event: DomainEvent): string {
    const parts: string[] = [];
    if (typeof event.payload?.text === 'string') {
      parts.push(event.payload.text);
    }
    if (typeof event.payload?.message === 'string') {
      parts.push(event.payload.message);
    }
    for (const f of event.changed_files ?? []) {
      parts.push(f);
      try {
        const abs = f.startsWith('/') ? f : join(this.workspaceRoot, f);
        if (existsSync(abs)) {
          parts.push(readFileSync(abs, 'utf8').slice(0, 8_000));
        }
      } catch {
        /* ignore */
      }
    }
    if (event.event_type === 'COMMIT_CREATED') {
      parts.push(this.gitSnippet(event.commit_id));
    }
    return parts.join('\n').slice(0, 24_000);
  }

  private gitSnippet(commitId?: string): string {
    try {
      const spec = commitId ?? 'HEAD';
      return execSync(`git show --stat --format="%H%n%s%n%b" ${spec}`, {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        timeout: 3_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).slice(0, 12_000);
    } catch {
      return '';
    }
  }

  private async embedAdr(adr: Adr): Promise<void> {
    if (!this.flags.architecture_vector_search_enabled) {
      return;
    }
    const t0 = Date.now();
    const text = embedText(adr);
    const vec = this.embedder.embed(text);
    this.store.upsertEmbedding(adr.id, vec, text);
    this.metrics.recordEmbedding(Date.now() - t0);
  }

  private projectGraph(adr: Adr): void {
    if (this.archGraph && this.flags.architecture_graph_enabled) {
      projectAdrToGraph(this.archGraph, adr);
    }
    if (!this.flags.architecture_graph_enabled || !this.graph) {
      return;
    }
    this.graph.upsertAdr?.({
      id: adr.id,
      title: adr.title,
      content: adr.decision.summary,
    });
    for (const c of adr.affected_components) {
      this.graph.upsertEdge?.(adr.id, c, 'AFFECTS');
    }
    for (const file of adr.evidence.code) {
      this.graph.upsertEdge?.(adr.id, file.id, 'IMPLEMENTED_BY');
    }
  }

  private maybeSupersede(adr: Adr): void {
    if (adr.record_kind === 'observation') {
      return;
    }
    const others = this.store
      .list({ project_id: adr.project_id })
      .filter((a) => a.id !== adr.id && isActiveStatus(a.status));
    for (const old of others) {
      const sameComponent = old.affected_components.some((c) =>
        adr.affected_components.includes(c),
      );
      const replaces =
        old.alternatives.some(
          (alt) =>
            alt.status === 'rejected' &&
            adr.decision.summary.toLowerCase().includes(alt.name.toLowerCase()),
        ) ||
        (Boolean(adr.relationships.supersedes) && adr.relationships.supersedes === old.id);
      if (sameComponent && replaces && adr.confidence >= 0.85) {
        const { old: retired, next } = applySupersession(old, adr);
        this.store.update(retired);
        this.store.update(next);
        this.projectGraph(retired);
        this.projectGraph(next);
        return;
      }
    }
  }

  refreshConflicts(projectId: string, change = '', files?: string[]): void {
    if (!this.flags.architecture_conflict_detection_enabled) {
      return;
    }
    const found = detectConflicts({
      project_id: projectId,
      change,
      affected_files: files,
      adrs: this.store.list({ project_id: projectId }),
      graph: this.archGraph,
    });
    for (const c of found) {
      this.store.insertConflict(c);
    }
  }

  refreshDrift(projectId: string, files?: string[], force = false): void {
    if (!this.flags.architecture_drift_detection_enabled) {
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastDriftAt < 2_000) {
      return;
    }
    this.lastDriftAt = now;
    const t0 = Date.now();
    const staleKey = `drift_stale:${projectId}`;
    let staleFiles: string[] = files ?? [];
    if (!force) {
      try {
        const stale = JSON.parse(this.store.getKv(staleKey) ?? '{}') as { files?: string[] };
        staleFiles = [...new Set([...(stale.files ?? []), ...(files ?? [])])];
      } catch {
        /* ignore */
      }
    }
    const found = detectDrift({
      workspaceRoot: this.workspaceRoot,
      project_id: projectId,
      adrs: this.store.list({ project_id: projectId }),
      extraFiles: force ? files : staleFiles.length ? staleFiles : files,
    });
    for (const d of found) {
      this.store.insertDrift(d);
    }
    this.store.setKv(staleKey, JSON.stringify({ files: [], at: nowIso() }));
    this.metrics.recordDriftScan(Date.now() - t0, found.length);
    if (found.some((d) => d.severity === 'high')) {
      this.maybeEvolve(projectId, 'drift');
    }
  }

  maybeEvolve(projectId: string, trigger: 'drift' | 'incident' | 'deployment_failure' | 'validation'): void {
    if (!this.flags.architecture_evolution_enabled) {
      return;
    }
    proposeEvolution({
      store: this.store,
      project_id: projectId,
      adrs: this.store.list({ project_id: projectId }),
      drifts: this.store.listDrifts(projectId),
      trigger,
    });
  }

  private recomputeCache(projectId: string): void {
    const t0 = Date.now();
    const adrs = this.store.list({ project_id: projectId });
    const conflicts = this.store.listConflicts(projectId);
    const drifts = this.store.listDrifts(projectId);
    const entities = new Set<string>(['workspace']);
    for (const a of adrs) {
      for (const c of a.affected_components) {
        entities.add(c);
      }
      for (const f of a.evidence.code) {
        entities.add(f.id);
      }
    }
    const version = adrs.reduce((m, a) => m + a.version, 0);
    for (const e of entities) {
      this.cache.set(
        buildCachedContext(e, adrs, version, undefined, {
          conflicts: conflicts.map((c) => ({
            adr_id: c.adr_id,
            reason: c.reason,
            severity: c.severity,
          })),
          drifts: drifts.map((d) => ({
            adr_id: d.adr_id,
            reason: d.reason,
            severity: d.severity,
          })),
        }),
      );
    }
    this.metrics.recordContextGeneration(Date.now() - t0);
  }
}
