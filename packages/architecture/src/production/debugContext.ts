import type { DecisionStore } from '../memory/decisionStore.js';
import type { GraphBackend } from '../graph/backend.js';
import { nowIso } from '../domain/adr/schema.js';
import type { StoredDrift } from '../memory/decisionStore.js';
import type { ArchitectureMetricsCollector } from '../metrics.js';
import { entityId } from './correlate.js';
import { type ProductionEvent } from './schema.js';
import { readCorrelationPolicy, type CorrelationPolicy } from './policy.js';

export interface ReactiveDebugCause {
  summary: string;
  confidence: number;
  reasons: string[];
}

export interface ReactiveDebugContext {
  incident_id: string;
  incident_summary: string;
  service?: string;
  environment?: string;
  deployments: Array<{ id: string; commit_sha?: string; timestamp?: string }>;
  commits: string[];
  changed_files: string[];
  components: string[];
  adrs: Array<{ id: string; title: string; confidence: number }>;
  metrics: Array<{ id: string; label: string }>;
  drifts: Array<{ id: string; kind: string; reason: string }>;
  potential_causes: ReactiveDebugCause[];
  confidence: number;
  assembled_at: string;
}

function parseTs(iso?: string): number {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : Date.now();
}

function incidentIdOf(event: ProductionEvent): string {
  return entityId(event, 'incident');
}

/**
 * Assemble pull-only debugging evidence. Never writes code or prompt cache.
 */
export function buildReactiveDebugContext(
  store: DecisionStore,
  graph: GraphBackend | undefined,
  projectId: string,
  incident: ProductionEvent,
  policy: CorrelationPolicy = readCorrelationPolicy(),
  metrics?: ArchitectureMetricsCollector,
): ReactiveDebugContext {
  const t0 = Date.now();
  const incidentId = incidentIdOf(incident);
  const tIncident = parseTs(incident.timestamp);
  const service = incident.service ?? incident.component;
  const env = incident.environment;

  const deployments: ReactiveDebugContext['deployments'] = [];
  const metricsObs: ReactiveDebugContext['metrics'] = [];
  if (graph) {
    for (const dep of graph.listNodes('Deployment')) {
      const observed = typeof dep.meta?.observed_at === 'string' ? dep.meta.observed_at : undefined;
      const depTs = parseTs(observed);
      const sameService =
        !service ||
        !dep.meta?.service ||
        String(dep.meta?.service ?? '').toLowerCase() === service.toLowerCase();
      const sameEnv =
        !env || !dep.meta?.environment || String(dep.meta.environment).toLowerCase() === env.toLowerCase();
      const inWindow =
        !observed ||
        (Math.abs(tIncident - depTs) <= policy.deploymentLookbackMs);
      if (sameService && sameEnv && inWindow) {
        deployments.push({
          id: dep.label,
          commit_sha: typeof dep.meta?.commit_sha === 'string' ? dep.meta.commit_sha : undefined,
          timestamp: observed,
        });
      }
    }
    for (const m of graph.listNodes('MetricObservation')) {
      const mTs = parseTs(typeof m.meta?.observed_at === 'string' ? m.meta.observed_at : undefined);
      const sameService =
        !service || String(m.meta?.service ?? '').toLowerCase() === service.toLowerCase();
      if (sameService && Math.abs(tIncident - mTs) <= policy.metricLookbackMs) {
        metricsObs.push({ id: m.id, label: m.label });
      }
    }
  }

  const correlations = store.listCorrelations(projectId, incident.event_id);
  const adrHits = new Map<string, number>();
  for (const c of correlations) {
    if (c.target_type === 'ADR' || c.target_id.startsWith('ADR:')) {
      const adrId = c.target_id.startsWith('ADR:') ? c.target_id.slice(4) : c.target_id;
      if (c.confidence >= 0.5) {
        adrHits.set(adrId, Math.max(adrHits.get(adrId) ?? 0, c.confidence));
      }
    }
  }
  const adrs: ReactiveDebugContext['adrs'] = [];
  for (const [id, confidence] of adrHits) {
    const adr = store.get(id);
    if (adr) {
      adrs.push({ id: adr.id, title: adr.title, confidence });
    }
  }
  for (const adr of store.list({ project_id: projectId })) {
    if ((adr.evidence.incidents ?? []).some((i) => i.id === incidentId) && !adrs.some((a) => a.id === adr.id)) {
      adrs.push({ id: adr.id, title: adr.title, confidence: 0.7 });
    }
  }

  const components = [
    ...new Set(
      [
        service,
        ...adrs.flatMap((a) => store.get(a.id)?.affected_components ?? []),
      ].filter((x): x is string => Boolean(x)),
    ),
  ];

  const changed_files = [
    ...new Set(
      (Array.isArray(incident.payload?.changed_files)
        ? (incident.payload?.changed_files as unknown[]).filter((f): f is string => typeof f === 'string')
        : []) as string[],
    ),
  ];

  const drifts: StoredDrift[] = store
    .listDrifts(projectId)
    .filter((d) => (d.status ?? 'open') === 'open')
    .filter((d) => {
      if (components.some((c) => d.adr_id && store.get(d.adr_id)?.affected_components.includes(c))) {
        return true;
      }
      if (changed_files.some((f) => d.files.some((df) => df.includes(f) || f.includes(df)))) {
        return true;
      }
      return components.some((c) => d.reason.toLowerCase().includes(c.toLowerCase()));
    });

  const commits = [
    ...new Set(
      [incident.commit_sha, ...deployments.map((d) => d.commit_sha)].filter((x): x is string => Boolean(x)),
    ),
  ];

  const potential_causes: ReactiveDebugCause[] = [];
  if (deployments.length) {
    potential_causes.push({
      summary: `Recent deployment ${deployments[0]!.id} within lookback window`,
      confidence: 0.7,
      reasons: ['deployment lookback', service ? 'same service' : 'incident window'],
    });
  }
  if (adrs.length) {
    potential_causes.push({
      summary: `Related ADR ${adrs[0]!.id} — ${adrs[0]!.title}`,
      confidence: adrs[0]!.confidence,
      reasons: ['ADR correlation'],
    });
  }
  if (metricsObs.length) {
    potential_causes.push({
      summary: `Related metric ${metricsObs[0]!.label}`,
      confidence: 0.55,
      reasons: ['metric lookback'],
    });
  }
  if (drifts.length) {
    potential_causes.push({
      summary: `Architecture drift: ${drifts[0]!.reason}`,
      confidence: drifts[0]!.confidence ?? 0.6,
      reasons: [drifts[0]!.kind],
    });
  }

  const confidence = potential_causes.length
    ? potential_causes.reduce((s, c) => s + c.confidence, 0) / potential_causes.length
    : 0.2;

  const ctx: ReactiveDebugContext = {
    incident_id: incidentId,
    incident_summary:
      typeof incident.payload?.message === 'string'
        ? incident.payload.message
        : typeof incident.payload?.summary === 'string'
          ? incident.payload.summary
          : incident.event_type,
    service,
    environment: env,
    deployments,
    commits,
    changed_files,
    components,
    adrs,
    metrics: metricsObs,
    drifts: drifts.map((d) => ({ id: d.id, kind: d.kind, reason: d.reason })),
    potential_causes,
    confidence: Math.min(1, confidence),
    assembled_at: nowIso(),
  };

  store.upsertDebugContext({
    incident_id: incidentId,
    project_id: projectId,
    json: JSON.stringify(ctx),
    updated_at: ctx.assembled_at,
  });
  metrics?.recordReactiveDebug(Date.now() - t0);
  return ctx;
}

export function readStoredDebugContext(
  store: DecisionStore,
  incidentId: string,
): ReactiveDebugContext | undefined {
  const row = store.getDebugContext(incidentId);
  if (!row) {
    return undefined;
  }
  try {
    return JSON.parse(row.json) as ReactiveDebugContext;
  } catch {
    return undefined;
  }
}
