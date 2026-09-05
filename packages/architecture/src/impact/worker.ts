import { nowIso } from '../domain/adr/schema.js';
import type { Adr } from '../domain/adr/schema.js';
import { createDomainEvent } from '../events/types.js';
import type { EventBus } from '../events/types.js';
import type { GraphBackend } from '../graph/backend.js';
import { detectConflicts } from '../graph/conflicts.js';
import { graphImpact } from '../graph/impact.js';
import { serviceFromPath } from '../graph/builder.js';
import type { ArchitectureFlags } from '../flags.js';
import type { ArchitectureMetricsCollector } from '../metrics.js';
import type { DecisionStore, StoredDrift } from '../memory/decisionStore.js';
import { detectDrift } from '../workers/drift.js';
import { IMPACT_ANALYSIS_VERSION } from './types.js';
import type {
  CodeImpactProvider,
  CodeImpactSlice,
  ImpactAnalysisRequest,
  ImpactAnalysisResult,
  StoredImpactAnalysis,
} from './types.js';
import { emptyCodeImpact, mergeCodeImpact } from './types.js';
import { scoreImpact } from './severity.js';

const PUBLIC_API_RE = /(?:^|\/)(?:api|openapi|routes|controllers?|gateway)\b/i;

function packageFromPath(file: string): string | undefined {
  const parts = file.replace(/\\/g, '/').split('/');
  const pkg = parts.indexOf('packages');
  if (pkg >= 0 && parts[pkg + 1]) {
    return parts[pkg + 1];
  }
  return serviceFromPath(file);
}

function isPublicApi(files: string[], graph?: GraphBackend): boolean {
  if (files.some((f) => PUBLIC_API_RE.test(f))) {
    return true;
  }
  if (!graph) {
    return false;
  }
  return graph.listNodes('API').length > 0 && files.some((f) => {
    const svc = serviceFromPath(f);
    return Boolean(svc && graph.listNodes('API').some((n) => n.label.includes(svc)));
  });
}

function collectCodeImpact(
  req: ImpactAnalysisRequest,
  provider?: CodeImpactProvider,
): CodeImpactSlice {
  if (!provider) {
    return {
      ...emptyCodeImpact(),
      symbols: req.symbols ?? [],
      files: req.affected_files ?? [],
      error: 'code_impact_provider_unavailable',
    };
  }
  const depth = req.depth ?? 2;
  const parts: CodeImpactSlice[] = [];
  try {
    if (req.symbols?.length) {
      parts.push(provider.impactForSymbols(req.symbols, depth));
    }
    if (req.affected_files?.length && provider.impactForFiles) {
      parts.push(provider.impactForFiles(req.affected_files, depth));
    } else if (req.affected_files?.length && req.symbols?.length) {
      /* symbols already expanded */
    } else if (req.affected_files?.length) {
      parts.push({
        ...emptyCodeImpact(),
        files: req.affected_files,
      });
    }
  } catch (e) {
    return {
      ...emptyCodeImpact(),
      symbols: req.symbols ?? [],
      files: req.affected_files ?? [],
      error: e instanceof Error ? e.message : 'code_impact_failed',
    };
  }
  if (!parts.length) {
    return {
      ...emptyCodeImpact(),
      symbols: req.symbols ?? [],
      files: req.affected_files ?? [],
    };
  }
  return mergeCodeImpact(parts);
}

function overlappingDrifts(drifts: StoredDrift[], files: string[]): StoredDrift[] {
  if (!files.length) {
    return drifts.filter((d) => d.status !== 'resolved' && d.status !== 'false_positive');
  }
  return drifts.filter((d) => {
    if (d.status === 'resolved' || d.status === 'false_positive') {
      return false;
    }
    if (!d.files.length) {
      return true;
    }
    return d.files.some((f) => files.some((x) => f.includes(x) || x.includes(f)));
  });
}

function servicesFromGraph(graph: GraphBackend | undefined, files: string[], adrs: Adr[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const s = serviceFromPath(f);
    if (s) {
      out.add(s);
    }
  }
  for (const a of adrs) {
    for (const c of a.affected_components) {
      out.add(c);
    }
  }
  if (graph) {
    for (const f of files) {
      const { nodes } = graph.neighbors(`File:${f}`, 2, ['CONTAINS', 'AFFECTS', 'IMPLEMENTED_BY']);
      for (const n of nodes) {
        if (n.kind === 'Service' || n.kind === 'API' || n.kind === 'Database' || n.kind === 'Queue') {
          out.add(n.label);
        }
      }
    }
  }
  return [...out];
}

export function computeImpactAnalysis(opts: {
  analysis_id: string;
  fingerprint: string;
  project_id: string;
  request: ImpactAnalysisRequest;
  created_at: string;
  trace_id?: string;
  store: DecisionStore;
  flags: ArchitectureFlags;
  workspaceRoot: string;
  graph?: GraphBackend;
  codeImpact?: CodeImpactProvider;
}): ImpactAnalysisResult {
  const req = opts.request;
  const code = collectCodeImpact(req, opts.codeImpact);
  const files = [...new Set([...(req.affected_files ?? []), ...code.files])];
  const adrs = opts.store.list({ project_id: opts.project_id });
  let conflictIds: string[] = opts.store.listConflicts(opts.project_id).map((c) => c.adr_id);
  if (opts.flags.architecture_conflict_detection_enabled) {
    try {
      const found = detectConflicts({
        project_id: opts.project_id,
        change: req.change ?? '',
        affected_files: files,
        adrs,
        graph: opts.graph,
      });
      for (const c of found) {
        opts.store.insertConflict(c);
      }
      conflictIds = [...new Set([...conflictIds, ...found.map((c) => c.adr_id)])];
    } catch {
      /* keep stored conflicts */
    }
  }
  let drifts = overlappingDrifts(opts.store.listDrifts(opts.project_id), files);
  if (!drifts.length && opts.flags.architecture_drift_detection_enabled) {
    try {
      const found = detectDrift({
        workspaceRoot: opts.workspaceRoot,
        project_id: opts.project_id,
        adrs,
        extraFiles: files,
      });
      for (const d of found) {
        opts.store.insertDrift(d);
      }
      drifts = overlappingDrifts(found, files);
    } catch {
      /* keep stored */
    }
  }
  const arch = graphImpact({
    change: req.change,
    affected_files: files,
    adrs,
    graph: opts.graph,
    conflictIds,
    driftIds: drifts.map((d) => d.id),
  });
  const packages = [...new Set(files.map(packageFromPath).filter((x): x is string => Boolean(x)))];
  const services = [
    ...new Set([...arch.affected_services, ...servicesFromGraph(opts.graph, files, adrs.filter((a) => arch.affected_decisions.includes(a.id)))]),
  ];
  const symbols = [...new Set([...(req.symbols ?? []), ...code.symbols, ...code.callers, ...code.callees])];
  const scored = scoreImpact({
    symbolCount: symbols.length,
    fileCount: files.length,
    serviceCount: services.length,
    packageCount: packages.length,
    adrCount: arch.affected_decisions.length,
    constraintCount: arch.constraints.length,
    conflictCount: arch.conflicts.length,
    driftCount: arch.drifts.length,
    testCount: code.tests.length,
    publicApi: isPublicApi(files, opts.graph),
    crossService: services.length >= 2,
    codePartial: Boolean(code.error),
  });
  const ts = nowIso();
  return {
    analysis_id: opts.analysis_id,
    status: 'completed',
    fingerprint: opts.fingerprint,
    project_id: opts.project_id,
    repository: req.repository,
    commit_id: req.commit_id,
    analysis_version: IMPACT_ANALYSIS_VERSION,
    change: req.change,
    affected_symbols: symbols,
    affected_files: files,
    affected_packages: packages,
    affected_services: services,
    affected_decisions: arch.affected_decisions,
    affected_adrs: arch.affected_decisions,
    constraints: arch.constraints,
    risks: arch.risks,
    conflicts: arch.conflicts,
    drifts: arch.drifts,
    severity: scored.severity,
    recommendation: scored.recommendation,
    reasons: scored.reasons,
    confidence: scored.confidence,
    error: code.error,
    trace_id: opts.trace_id,
    created_at: opts.created_at,
    updated_at: ts,
  };
}

export function persistImpactResult(store: DecisionStore, row: StoredImpactAnalysis, result: ImpactAnalysisResult): void {
  store.upsertImpactAnalysis({
    ...row,
    status: result.status,
    result_json: JSON.stringify(result),
    severity: result.severity,
    recommendation: result.recommendation,
    confidence: result.confidence,
    error: result.error,
    updated_at: result.updated_at,
  });
}

export async function runStoredImpactAnalysis(opts: {
  analysisId: string;
  store: DecisionStore;
  flags: ArchitectureFlags;
  workspaceRoot: string;
  graph?: GraphBackend;
  codeImpact?: CodeImpactProvider;
  metrics?: ArchitectureMetricsCollector;
  bus?: EventBus;
}): Promise<ImpactAnalysisResult | undefined> {
  const row = opts.store.getImpactAnalysis(opts.analysisId);
  if (!row) {
    return undefined;
  }
  if (row.status === 'completed') {
    try {
      return JSON.parse(row.result_json) as ImpactAnalysisResult;
    } catch {
      /* recompute */
    }
  }
  const t0 = Date.now();
  const running: StoredImpactAnalysis = { ...row, status: 'running', updated_at: nowIso() };
  opts.store.upsertImpactAnalysis(running);
  let req: ImpactAnalysisRequest = {};
  try {
    req = JSON.parse(row.request_json) as ImpactAnalysisRequest;
  } catch {
    req = {};
  }
  try {
    const result = computeImpactAnalysis({
      analysis_id: row.analysis_id,
      fingerprint: row.fingerprint,
      project_id: row.project_id,
      request: req,
      created_at: row.created_at,
      trace_id: row.trace_id,
      store: opts.store,
      flags: opts.flags,
      workspaceRoot: opts.workspaceRoot,
      graph: opts.graph,
      codeImpact: opts.codeImpact,
    });
    persistImpactResult(opts.store, running, result);
    opts.metrics?.recordImpactCompleted(Date.now() - t0, {
      symbols: result.affected_symbols.length,
      services: result.affected_services.length,
      severity: result.severity,
    });
    if (opts.bus) {
      await opts.bus.publish(
        createDomainEvent({
          event_type: 'ARCHITECTURE_IMPACT_ANALYSIS_COMPLETED',
          project_id: row.project_id,
          trace_id: row.trace_id,
          payload: {
            analysis_id: row.analysis_id,
            fingerprint: row.fingerprint,
            status: result.status,
            severity: result.severity,
          },
        }),
      );
    }
    return result;
  } catch (e) {
    const err = e instanceof Error ? e.message : 'impact_failed';
    const failed: ImpactAnalysisResult = {
      analysis_id: row.analysis_id,
      status: 'failed',
      fingerprint: row.fingerprint,
      project_id: row.project_id,
      analysis_version: IMPACT_ANALYSIS_VERSION,
      affected_symbols: [],
      affected_files: req.affected_files ?? [],
      affected_packages: [],
      affected_services: [],
      affected_decisions: [],
      affected_adrs: [],
      constraints: [],
      risks: [],
      conflicts: [],
      drifts: [],
      severity: 'low',
      recommendation: 'REVIEW_REQUIRED',
      reasons: [`analysis failed: ${err}`],
      confidence: 0.2,
      error: err,
      trace_id: row.trace_id,
      created_at: row.created_at,
      updated_at: nowIso(),
    };
    persistImpactResult(opts.store, running, failed);
    opts.metrics?.recordImpactFailed();
    return failed;
  }
}

export function storedToResult(row: StoredImpactAnalysis): ImpactAnalysisResult {
  try {
    const parsed = JSON.parse(row.result_json) as Partial<ImpactAnalysisResult>;
    if (parsed.analysis_id) {
      return { ...parsed, status: row.status } as ImpactAnalysisResult;
    }
  } catch {
    /* fall through */
  }
  return {
    analysis_id: row.analysis_id,
    status: row.status,
    fingerprint: row.fingerprint,
    project_id: row.project_id,
    analysis_version: row.analysis_version,
    affected_symbols: [],
    affected_files: [],
    affected_packages: [],
    affected_services: [],
    affected_decisions: [],
    affected_adrs: [],
    constraints: [],
    risks: [],
    conflicts: [],
    drifts: [],
    severity: (row.severity as ImpactAnalysisResult['severity']) ?? 'low',
    recommendation: (row.recommendation as ImpactAnalysisResult['recommendation']) ?? 'REVIEW_REQUIRED',
    reasons: [],
    confidence: row.confidence ?? 0,
    error: row.error,
    trace_id: row.trace_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
