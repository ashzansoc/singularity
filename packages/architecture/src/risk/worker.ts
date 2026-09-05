import { nowIso } from '../domain/adr/schema.js';
import { createDomainEvent, type EventBus } from '../events/types.js';
import type { GraphBackend } from '../graph/backend.js';
import type { ArchitectureFlags } from '../flags.js';
import { ingestImpactAnalysis } from '../impact/ingest.js';
import { impactFingerprint, readArchitectureVersion } from '../impact/fingerprint.js';
import { runStoredImpactAnalysis, storedToResult } from '../impact/worker.js';
import type { CodeImpactProvider, ImpactAnalysisRequest, ImpactAnalysisResult } from '../impact/types.js';
import type { ArchitectureMetricsCollector } from '../metrics.js';
import type { DecisionStore } from '../memory/decisionStore.js';
import { LocalEventBuffer } from '../events/localBuffer.js';
import { scoreMissionRisk } from './engine.js';
import { isRiskStale, productionWatermark } from './freshness.js';
import { RISK_ASSESSMENT_VERSION } from './weights.js';
import type {
  RiskAssessment,
  RiskAssessmentRequest,
  RiskJobStatus,
  StoredRiskAssessment,
} from './types.js';
import { jobToAssessmentStatus } from './types.js';

function toImpactRequest(req: RiskAssessmentRequest): ImpactAnalysisRequest {
  return {
    change: req.change,
    affected_files: req.affected_files,
    symbols: req.symbols,
    commit_id: req.commit_id,
    repository: req.repository,
  };
}

export function storedToRiskResult(
  row: StoredRiskAssessment,
  opts?: { stale?: boolean },
): RiskAssessment {
  try {
    const parsed = JSON.parse(row.result_json) as Partial<RiskAssessment>;
    if (parsed.assessment_id) {
      const stale = opts?.stale ?? row.assessment_status === 'STALE';
      return {
        ...parsed,
        job_status: row.status,
        assessment_status: jobToAssessmentStatus(row.status, stale && row.status === 'completed'),
      } as RiskAssessment;
    }
  } catch {
    /* fall through */
  }
  return {
    assessment_id: row.assessment_id,
    mission_id: row.mission_id,
    fingerprint: row.fingerprint,
    project_id: row.project_id,
    job_status: row.status,
    assessment_status: jobToAssessmentStatus(row.status, opts?.stale),
    risk_score: row.risk_score ?? 0,
    risk_level: (row.risk_level as RiskAssessment['risk_level']) ?? 'LOW',
    confidence: row.confidence ?? 0,
    factors: [],
    recommendations: [],
    evidence_refs: [],
    affected_services: [],
    affected_symbols: [],
    affected_adrs: [],
    constraints: [],
    conflicts: [],
    drifts: [],
    assessment_version: row.assessment_version,
    source_versions: {
      architecture_version: 0,
      production_watermark: '0',
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
    trace_id: row.trace_id,
    error: row.error,
    outcome_json: row.outcome_json,
  };
}

async function resolveImpact(opts: {
  req: RiskAssessmentRequest;
  projectId: string;
  store: DecisionStore;
  flags: ArchitectureFlags;
  workspaceRoot: string;
  graph?: GraphBackend;
  codeImpact?: CodeImpactProvider;
  metrics?: ArchitectureMetricsCollector;
  buffer?: LocalEventBuffer;
}): Promise<{ impact?: ImpactAnalysisResult; tests: string[]; partial: boolean }> {
  const ireq = toImpactRequest(opts.req);
  const archV = readArchitectureVersion(opts.store, opts.projectId);
  const fp = impactFingerprint(ireq, archV);
  let row = opts.store.getImpactByFingerprint(fp);
  if (!row || row.status === 'failed') {
    const ingest = ingestImpactAnalysis(ireq, {
      projectId: opts.projectId,
      buffer: opts.buffer ?? new LocalEventBuffer(),
      flags: opts.flags,
      store: opts.store,
      metrics: opts.metrics,
    });
    if (ingest.analysis_id) {
      const result = await runStoredImpactAnalysis({
        analysisId: ingest.analysis_id,
        store: opts.store,
        flags: opts.flags,
        workspaceRoot: opts.workspaceRoot,
        graph: opts.graph,
        codeImpact: opts.codeImpact,
        metrics: opts.metrics,
      });
      const tests: string[] = [];
      return { impact: result, tests, partial: Boolean(result?.error) };
    }
  }
  if (row && row.status !== 'completed') {
    const result = await runStoredImpactAnalysis({
      analysisId: row.analysis_id,
      store: opts.store,
      flags: opts.flags,
      workspaceRoot: opts.workspaceRoot,
      graph: opts.graph,
      codeImpact: opts.codeImpact,
      metrics: opts.metrics,
    });
    return { impact: result, tests: [], partial: Boolean(result?.error) };
  }
  if (row) {
    const impact = storedToResult(row);
    return { impact, tests: [], partial: Boolean(impact.error) };
  }
  return { impact: undefined, tests: [], partial: true };
}

export function persistRiskResult(
  store: DecisionStore,
  row: StoredRiskAssessment,
  result: RiskAssessment,
): void {
  store.upsertRiskAssessment({
    ...row,
    status: result.job_status,
    assessment_status: result.assessment_status,
    result_json: JSON.stringify(result),
    risk_score: result.risk_score,
    risk_level: result.risk_level,
    confidence: result.confidence,
    source_versions: JSON.stringify(result.source_versions),
    error: result.error,
    updated_at: result.updated_at,
  });
}

export async function runStoredRiskAssessment(opts: {
  assessmentId: string;
  store: DecisionStore;
  flags: ArchitectureFlags;
  workspaceRoot: string;
  graph?: GraphBackend;
  codeImpact?: CodeImpactProvider;
  metrics?: ArchitectureMetricsCollector;
  bus?: EventBus;
  buffer?: LocalEventBuffer;
}): Promise<RiskAssessment | undefined> {
  const row = opts.store.getRiskAssessment(opts.assessmentId);
  if (!row) {
    return undefined;
  }
  if (row.status === 'completed' && row.assessment_status === 'READY') {
    try {
      return JSON.parse(row.result_json) as RiskAssessment;
    } catch {
      /* recompute */
    }
  }
  const t0 = Date.now();
  const running: StoredRiskAssessment = {
    ...row,
    status: 'running',
    assessment_status: 'PENDING',
    updated_at: nowIso(),
  };
  opts.store.upsertRiskAssessment(running);
  let req: RiskAssessmentRequest = {};
  try {
    req = JSON.parse(row.request_json) as RiskAssessmentRequest;
  } catch {
    req = {};
  }
  try {
    const resolved = await resolveImpact({
      req,
      projectId: row.project_id,
      store: opts.store,
      flags: opts.flags,
      workspaceRoot: opts.workspaceRoot,
      graph: opts.graph,
      codeImpact: opts.codeImpact,
      metrics: opts.metrics,
      buffer: opts.buffer,
    });
    const impact = resolved.impact;
    const testsFromReasons = (impact?.reasons ?? [])
      .map((r) => /^(\d+) related test/.exec(r))
      .find((m) => m);
    const tests =
      resolved.tests.length > 0
        ? resolved.tests
        : testsFromReasons
          ? Array.from({ length: Number(testsFromReasons[1]) }, (_, i) => `test_${i}`)
          : [];
    const partial = resolved.partial;
    const events = opts.store.listProductionEvents(row.project_id);
    const services = [...new Set([...(req.services ?? []), ...(impact?.affected_services ?? [])])];
    const prior = opts.store
      .listRiskAssessments(row.project_id, 50)
      .filter((r) => r.assessment_id !== row.assessment_id)
      .filter((r) => {
        if (r.mission_id === row.mission_id) {
          return true;
        }
        try {
          const parsed = JSON.parse(r.result_json) as Partial<RiskAssessment>;
          return (parsed.affected_services ?? []).some((s) => services.includes(s));
        } catch {
          return false;
        }
      });
    const adrs = opts.store.list({ project_id: row.project_id });
    const adrIds = new Set(impact?.affected_adrs ?? []);
    const adrRisks = adrs
      .filter((a) => adrIds.has(a.id) || services.some((s) => a.affected_components.includes(s)))
      .flatMap((a) => a.risks.map((text) => ({ adr_id: a.id, text })));
    const scored = scoreMissionRisk({
      request: req,
      impact,
      adrRisks,
      productionEvents: events,
      priorAssessments: prior,
      testNames: tests,
      codePartial: partial,
      historyEmpty: prior.length === 0,
    }, opts.flags);
    const ts = nowIso();
    const watermark = productionWatermark(events);
    const archV = readArchitectureVersion(opts.store, row.project_id);
    const result: RiskAssessment = {
      assessment_id: row.assessment_id,
      mission_id: row.mission_id,
      fingerprint: row.fingerprint,
      project_id: row.project_id,
      job_status: 'completed',
      assessment_status: 'READY',
      risk_score: scored.risk_score,
      risk_level: scored.risk_level,
      confidence: scored.confidence,
      factors: scored.factors,
      recommendations: scored.recommendations,
      evidence_refs: scored.evidence_refs,
      affected_services: services,
      affected_symbols: impact?.affected_symbols ?? req.symbols ?? [],
      affected_adrs: impact?.affected_adrs ?? [],
      constraints: impact?.constraints ?? [],
      conflicts: impact?.conflicts ?? [],
      drifts: impact?.drifts ?? [],
      assessment_version: RISK_ASSESSMENT_VERSION,
      source_versions: {
        architecture_version: archV,
        impact_analysis_id: impact?.analysis_id,
        production_watermark: watermark,
      },
      computed_at: ts,
      expires_at: undefined,
      created_at: row.created_at,
      updated_at: ts,
      trace_id: row.trace_id,
      error: impact?.error,
      impact_analysis_id: impact?.analysis_id,
    };
    persistRiskResult(opts.store, running, result);
    opts.metrics?.recordRiskCompleted(Date.now() - t0, {
      level: result.risk_level,
      factors: result.factors.map((f) => f.type),
    });
    if (opts.bus) {
      await opts.bus.publish(
        createDomainEvent({
          event_type: 'ARCHITECTURE_MISSION_RISK_ASSESSMENT_COMPLETED',
          project_id: row.project_id,
          trace_id: row.trace_id,
          payload: {
            assessment_id: row.assessment_id,
            mission_id: row.mission_id,
            fingerprint: row.fingerprint,
            status: result.job_status,
            risk_level: result.risk_level,
            risk_score: result.risk_score,
          },
        }),
      );
    }
    return result;
  } catch (e) {
    const err = e instanceof Error ? e.message : 'risk_failed';
    const failed: RiskAssessment = {
      assessment_id: row.assessment_id,
      mission_id: row.mission_id,
      fingerprint: row.fingerprint,
      project_id: row.project_id,
      job_status: 'failed',
      assessment_status: 'FAILED',
      risk_score: 0,
      risk_level: 'LOW',
      confidence: 0.2,
      factors: [],
      recommendations: [],
      evidence_refs: [],
      affected_services: [],
      affected_symbols: [],
      affected_adrs: [],
      constraints: [],
      conflicts: [],
      drifts: [],
      assessment_version: RISK_ASSESSMENT_VERSION,
      source_versions: {
        architecture_version: readArchitectureVersion(opts.store, row.project_id),
        production_watermark: '0',
      },
      created_at: row.created_at,
      updated_at: nowIso(),
      trace_id: row.trace_id,
      error: err,
    };
    persistRiskResult(opts.store, running, failed);
    opts.metrics?.recordRiskFailed();
    return failed;
  }
}

export function applyFreshness(
  row: StoredRiskAssessment,
  store: DecisionStore,
  metrics?: ArchitectureMetricsCollector,
): RiskAssessment {
  const events = store.listProductionEvents(row.project_id);
  const stale = isRiskStale(row, readArchitectureVersion(store, row.project_id), productionWatermark(events));
  if (stale) {
    metrics?.recordRiskStale();
  }
  return storedToRiskResult(row, { stale });
}

void (0 as unknown as RiskJobStatus);
