import { nowIso, type Adr } from '../domain/adr/schema.js';
import type { DomainEvent } from '../events/types.js';
import type { DecisionStore, StoredCorrelation } from '../memory/decisionStore.js';
import type { GraphBackend } from '../graph/backend.js';
import { projectAdrToGraph } from '../graph/builder.js';
import {
  edgeId,
  nodeId,
  type ArchEdge,
  type ArchNode,
  type ArchNodeKind,
  type ArchRelKind,
} from '../graph/types.js';
import type { ArchitectureMetricsCollector } from '../metrics.js';
import { correlatedEvidence, evidenceForFamily, type ProductionEvidence } from './evidence.js';
import {
  recordProductionFailed,
  recordProductionGraphWriteFailure,
  recordProductionProcessed,
} from './metrics.js';
import {
  confidenceBand,
  readCorrelationPolicy,
  type CorrelationPolicy,
} from './policy.js';
import {
  PRODUCTION_FAMILY,
  productionEventFromDomain,
  type ProductionEvent,
  type ProductionEventType,
} from './schema.js';

export interface Correlation {
  from: string;
  rel: ArchRelKind;
  to: string;
  evidence_type: ProductionEvidence['evidence_type'];
  confidence: number;
  reasons: string[];
  target_type?: string;
  target_id?: string;
}

export interface CorrelationResult {
  event_id: string;
  adrs: Adr[];
  correlations: Correlation[];
  unmatched: boolean;
}

export interface AdrMatchScore {
  score: number;
  reasons: string[];
  band: ReturnType<typeof confidenceBand>;
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

export function entityId(event: ProductionEvent, family: string): string {
  if (family === 'deployment') {
    return event.deployment_id ?? payloadString(event.payload, ['deployment_id', 'id']) ?? event.event_id;
  }
  if (family === 'incident') {
    return payloadString(event.payload, ['incident_id', 'id']) ?? event.event_id;
  }
  if (family === 'metric') {
    return (
      payloadString(event.payload, ['metric_id', 'metric_name', 'name', 'id']) ?? event.event_id
    );
  }
  return payloadString(event.payload, ['test_id', 'id']) ?? event.event_id;
}

function nodeKindForFamily(family: string): ArchNodeKind {
  if (family === 'deployment') {
    return 'Deployment';
  }
  if (family === 'incident') {
    return 'Incident';
  }
  if (family === 'metric') {
    return 'MetricObservation';
  }
  return 'TestExecution';
}

function adrRelForFamily(family: string): ArchRelKind {
  if (family === 'deployment') {
    return 'RELATED_TO_DEPLOYMENT';
  }
  if (family === 'test') {
    return 'VALIDATED_BY';
  }
  return 'EVIDENCED_BY';
}

function safeEq(a?: string, b?: string): boolean {
  if (!a || !b) {
    return false;
  }
  return a.toLowerCase() === b.toLowerCase();
}

function overlaps(a?: string, b?: string): boolean {
  if (!a || !b) {
    return false;
  }
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x === y || x.includes(y) || y.includes(x);
}

function eventFiles(event: ProductionEvent): string[] {
  return [
    ...(Array.isArray(event.payload?.changed_files)
      ? (event.payload?.changed_files as unknown[]).filter((f): f is string => typeof f === 'string')
      : []),
    typeof event.payload?.path === 'string' ? event.payload.path : '',
    typeof event.payload?.file === 'string' ? event.payload.file : '',
  ].filter(Boolean);
}

/**
 * Multi-signal ADR match. A single weak string overlap is not a fact.
 */
export function scoreAdrMatch(adr: Adr, event: ProductionEvent): AdrMatchScore {
  const reasons: string[] = [];
  let score = 0;
  if (adr.record_kind === 'observation' || adr.status === 'rejected') {
    return { score: 0, reasons, band: 'UNKNOWN' };
  }
  const explicit = payloadString(event.payload, ['adr_id']);
  if (explicit && explicit === adr.id) {
    score += 1;
    reasons.push('explicit adr_id');
  }
  if (
    event.commit_sha &&
    adr.evidence.commits.some(
      (c) =>
        c.id === event.commit_sha ||
        event.commit_sha?.startsWith(c.id) ||
        c.id.startsWith(event.commit_sha ?? ''),
    )
  ) {
    score += 0.55;
    reasons.push('same deployment commit');
  }
  if (
    event.deployment_id &&
    (adr.evidence.deployments ?? []).some((d) => d.id === event.deployment_id)
  ) {
    score += 0.45;
    reasons.push('same deployment id');
  }
  const serviceOrComponent = event.service ?? event.component;
  if (serviceOrComponent && adr.affected_components.some((c) => safeEq(c, serviceOrComponent))) {
    score += 0.5;
    reasons.push('same service');
  } else if (
    serviceOrComponent &&
    adr.affected_components.some((c) => overlaps(c, serviceOrComponent))
  ) {
    score += 0.2;
    reasons.push('overlapping service name');
  }
  if (event.repository && adr.affected_components.some((c) => safeEq(c, event.repository))) {
    score += 0.35;
    reasons.push('same repository');
  }
  const files = eventFiles(event);
  if (
    files.some(
      (f) =>
        adr.evidence.code.some((e) => f.includes(e.id) || e.id.includes(f)) ||
        adr.affected_components.some((c) => f.toLowerCase().includes(c.toLowerCase())),
    )
  ) {
    score += 0.4;
    reasons.push('changed files overlap ADR evidence');
  }
  if (event.branch && typeof event.payload?.branch === 'string' && event.branch === adr.id) {
    score += 0.1;
    reasons.push('branch');
  }
  const blob = `${event.service ?? ''} ${event.component ?? ''} ${event.repository ?? ''} ${JSON.stringify(event.payload ?? {})}`.toLowerCase();
  if (
    !reasons.includes('same service') &&
    !reasons.includes('overlapping service name') &&
    adr.affected_components.some((c) => blob.includes(c.toLowerCase()))
  ) {
    score += 0.15;
    reasons.push('weak payload text overlap');
  }
  score = Math.min(1, score);
  return { score, reasons, band: confidenceBand(score) };
}

export function matchesAdr(adr: Adr, event: ProductionEvent, floor = 0.25): boolean {
  return scoreAdrMatch(adr, event).score >= floor;
}

function safeUpsert(
  graph: GraphBackend | undefined,
  nodes: ArchNode[],
  edges: ArchEdge[],
  metrics?: ArchitectureMetricsCollector,
): void {
  if (!graph) {
    return;
  }
  try {
    if (nodes.length) {
      graph.upsertNodes(nodes);
    }
    if (edges.length) {
      graph.upsertEdges(edges);
    }
  } catch {
    recordProductionGraphWriteFailure(metrics);
  }
}

function parseTs(iso?: string): number {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : Date.now();
}

function persistCorrelations(
  store: DecisionStore,
  projectId: string,
  eventId: string,
  correlations: Correlation[],
  metrics?: ArchitectureMetricsCollector,
): void {
  for (const c of correlations) {
    const row: StoredCorrelation = {
      id: edgeId(c.from, c.rel, c.to),
      project_id: projectId,
      event_id: eventId,
      target_type: c.from.startsWith('ADR:')
        ? 'ADR'
        : (c.target_type ?? c.to.split(':')[0] ?? 'unknown'),
      target_id: c.from.startsWith('ADR:') ? c.from.slice(4) : (c.target_id ?? c.to),
      rel: c.rel,
      confidence: c.confidence,
      reasons: c.reasons,
      created_at: nowIso(),
    };
    try {
      store.insertCorrelation(row);
      metrics?.recordCorrelationCreated();
    } catch {
      /* store optional in older test doubles */
    }
  }
}

/**
 * Deterministic production correlation. Never emits CAUSED.
 */
export function correlateProductionEvent(
  store: DecisionStore,
  graph: GraphBackend | undefined,
  projectId: string,
  event: ProductionEvent,
  metrics?: ArchitectureMetricsCollector,
  policy: CorrelationPolicy = readCorrelationPolicy(),
): CorrelationResult {
  const t0 = Date.now();
  const correlations: Correlation[] = [];
  const family = PRODUCTION_FAMILY[event.event_type];
  const id = entityId(event, family);
  const kind = nodeKindForFamily(family);
  const source = event.source ?? 'unknown';
  const factEvidence =
    event.evidence ??
    evidenceForFamily(family, {
      source,
      source_event_id: event.source_event_id ?? event.event_id,
      observed_at: event.timestamp,
      reference: id,
      metadata: { event_type: event.event_type },
    });

  const nodes: ArchNode[] = [
    {
      id: nodeId(kind, id),
      kind,
      label: id,
      project_id: projectId,
      meta: {
        event: event.event_type,
        service: event.service,
        component: event.component,
        environment: event.environment,
        repository: event.repository,
        branch: event.branch,
        commit_sha: event.commit_sha,
        deployment_id: event.deployment_id,
        observed_at: event.timestamp,
        payload: event.payload,
        evidence: factEvidence,
        epistemic: 'FACT',
      },
    },
  ];
  if (kind === 'MetricObservation') {
    nodes.push({ ...nodes[0]!, id: nodeId('Metric', id), kind: 'Metric' });
  }
  if (kind === 'TestExecution') {
    nodes.push({ ...nodes[0]!, id: nodeId('Test', id), kind: 'Test' });
  }

  const edges: ArchEdge[] = [];
  const pushEdge = (
    from: string,
    rel: ArchRelKind,
    to: string,
    evidence_type: ProductionEvidence['evidence_type'],
    confidence: number,
    reasons: string[],
    target_type?: string,
    target_id?: string,
  ) => {
    edges.push({
      id: edgeId(from, rel, to),
      from,
      to,
      kind: rel,
      meta: {
        confidence,
        reasons,
        band: confidenceBand(confidence),
        epistemic: confidence >= 0.8 ? 'FACT' : 'INFERENCE',
      },
    });
    correlations.push({
      from,
      rel,
      to,
      evidence_type,
      confidence,
      reasons,
      target_type,
      target_id,
    });
  };

  if (event.environment) {
    const envId = nodeId('Environment', event.environment);
    nodes.push({
      id: envId,
      kind: 'Environment',
      label: event.environment,
      project_id: projectId,
    });
    if (family === 'deployment') {
      pushEdge(nodeId('Deployment', id), 'DEPLOYED_TO', envId, 'OBSERVED', 1, ['same environment'], 'Environment', event.environment);
    }
  }

  if (event.service) {
    const sid = nodeId('Service', event.service);
    nodes.push({
      id: sid,
      kind: 'Service',
      label: event.service,
      project_id: projectId,
    });
    if (family === 'incident') {
      pushEdge(nodeId('Incident', id), 'AFFECTS', sid, 'REPORTED', 0.9, ['same service'], 'Service', event.service);
    } else {
      pushEdge(nodeId(kind, id), 'CORRELATED_WITH', sid, 'CORRELATED', 0.7, ['same service'], 'Service', event.service);
    }
  }

  if (event.repository) {
    const rid = nodeId('Repository', event.repository);
    nodes.push({
      id: rid,
      kind: 'Repository',
      label: event.repository,
      project_id: projectId,
    });
    pushEdge(nodeId(kind, id), 'CORRELATED_WITH', rid, 'CORRELATED', 0.65, ['same repository'], 'Repository', event.repository);
  }

  if (event.commit_sha) {
    const cid = nodeId('Commit', event.commit_sha);
    nodes.push({
      id: cid,
      kind: 'Commit',
      label: event.commit_sha.slice(0, 12),
      project_id: projectId,
      meta: { epistemic: 'FACT' },
    });
    if (family === 'deployment') {
      pushEdge(nodeId('Deployment', id), 'CONTAINS_COMMIT', cid, 'OBSERVED', 1, ['same deployment commit'], 'Commit', event.commit_sha);
    } else {
      pushEdge(nodeId(kind, id), 'CORRELATED_WITH', cid, 'CORRELATED', 0.75, ['same commit'], 'Commit', event.commit_sha);
    }
  }

  if (event.deployment_id && family !== 'deployment') {
    const did = nodeId('Deployment', event.deployment_id);
    const existing = graph?.getNode(did);
    nodes.push({
      id: did,
      kind: 'Deployment',
      label: event.deployment_id,
      project_id: projectId,
      meta: existing?.meta,
    });
    if (family === 'incident') {
      pushEdge(nodeId('Incident', id), 'ASSOCIATED_WITH', did, 'CORRELATED', 0.8, ['same deployment id'], 'Deployment', event.deployment_id);
      pushEdge(did, 'ASSOCIATED_WITH', nodeId('Incident', id), 'CORRELATED', 0.8, ['same deployment id'], 'Incident', id);
    } else if (family === 'metric') {
      pushEdge(did, 'PRODUCED_METRIC', nodeId('MetricObservation', id), 'CORRELATED', 0.7, ['same deployment id'], 'MetricObservation', id);
    } else {
      pushEdge(nodeId(kind, id), 'CORRELATED_WITH', did, 'CORRELATED', 0.65, ['same deployment id'], 'Deployment', event.deployment_id);
    }
  }

  const lookback =
    family === 'metric' ? policy.metricLookbackMs : policy.deploymentLookbackMs;

  if (graph) {
    try {
      const tEvent = parseTs(event.timestamp);
      const deployments = graph.listNodes('Deployment');
      for (const dep of deployments) {
        if (family === 'deployment' && dep.id === nodeId('Deployment', id)) {
          continue;
        }
        const sameService =
          !event.service ||
          safeEq(String(dep.meta?.service ?? ''), event.service) ||
          overlaps(String(dep.meta?.service ?? ''), event.service);
        const sameEnv =
          !event.environment ||
          !dep.meta?.environment ||
          safeEq(String(dep.meta.environment), event.environment);
        const depTs = parseTs(typeof dep.meta?.observed_at === 'string' ? dep.meta.observed_at : undefined);
        const near = Math.abs(tEvent - depTs) <= lookback;
        if (!sameService || !sameEnv || !near) {
          continue;
        }
        const reasons = ['time window overlap'];
        if (sameService && event.service) {
          reasons.push('same service');
        }
        if (family === 'metric') {
          pushEdge(nodeId('MetricObservation', id), 'TEMPORALLY_CORRELATED_WITH', dep.id, 'CORRELATED', 0.55, reasons, 'Deployment', dep.label);
          pushEdge(dep.id, 'PRODUCED_METRIC', nodeId('MetricObservation', id), 'CORRELATED', 0.55, reasons, 'MetricObservation', id);
        } else if (family === 'incident') {
          pushEdge(nodeId('Incident', id), 'TEMPORALLY_CORRELATED_WITH', dep.id, 'CORRELATED', 0.6, reasons, 'Deployment', dep.label);
          pushEdge(nodeId('Incident', id), 'ASSOCIATED_WITH', dep.id, 'CORRELATED', 0.6, reasons, 'Deployment', dep.label);
        } else if (family === 'test') {
          pushEdge(nodeId('TestExecution', id), 'TEMPORALLY_CORRELATED_WITH', dep.id, 'CORRELATED', 0.5, reasons, 'Deployment', dep.label);
        }
      }
      if (family === 'incident') {
        for (const metric of graph.listNodes('MetricObservation')) {
          const sameService =
            !event.service ||
            safeEq(String(metric.meta?.service ?? ''), event.service) ||
            overlaps(String(metric.meta?.service ?? ''), event.service);
          const mTs = parseTs(typeof metric.meta?.observed_at === 'string' ? metric.meta.observed_at : undefined);
          if (sameService && Math.abs(tEvent - mTs) <= policy.metricLookbackMs) {
            pushEdge(nodeId('Incident', id), 'CORRELATED_WITH', metric.id, 'CORRELATED', 0.55, ['time window overlap', 'same service'], 'MetricObservation', metric.label);
            pushEdge(nodeId('Incident', id), 'TEMPORALLY_CORRELATED_WITH', metric.id, 'CORRELATED', 0.55, ['time window overlap'], 'MetricObservation', metric.label);
          }
        }
      }
    } catch {
      recordProductionGraphWriteFailure(metrics);
    }
  }

  const updated: Adr[] = [];
  for (const adr of store.list({ project_id: projectId })) {
    const match = scoreAdrMatch(adr, event);
    if (match.score < policy.matchFloor) {
      continue;
    }
    const next: Adr = {
      ...adr,
      evidence: {
        ...adr.evidence,
        incidents: [...(adr.evidence.incidents ?? [])],
        deployments: [...(adr.evidence.deployments ?? [])],
        metrics: [...(adr.evidence.metrics ?? [])],
        tests: [...adr.evidence.tests],
      },
      timestamps: { ...adr.timestamps, updated_at: nowIso() },
    };
    const bucket =
      family === 'incident'
        ? next.evidence.incidents
        : family === 'deployment'
          ? next.evidence.deployments
          : family === 'metric'
            ? next.evidence.metrics
            : next.evidence.tests;
    const rel = adrRelForFamily(family);
    const epistemic = match.score >= 0.8 ? 'FACT' : 'INFERENCE';
    if (bucket.some((e) => e.id === id)) {
      updated.push(next);
      pushEdge(nodeId('ADR', next.id), rel, nodeId(kind, id), 'CORRELATED', match.score, match.reasons, kind, id);
      continue;
    }
    const contradicts =
      event.event_type === 'DEPLOYMENT_FAILED' ||
      event.event_type === 'DEPLOYMENT_ROLLED_BACK' ||
      event.event_type === 'TEST_FAILED' ||
      event.event_type === 'TEST_REGRESSION';
    bucket.push({
      type: family,
      id,
      relationship: contradicts ? 'contradicts' : 'supports',
    });
    store.update(next);
    if (graph) {
      try {
        projectAdrToGraph(graph, next);
      } catch {
        recordProductionGraphWriteFailure(metrics);
      }
    }
    pushEdge(nodeId('ADR', next.id), rel, nodeId(kind, id), 'CORRELATED', match.score, [...match.reasons, `epistemic:${epistemic}`], kind, id);
    if (event.commit_sha) {
      pushEdge(nodeId('ADR', next.id), 'IMPLEMENTED_BY', nodeId('Commit', event.commit_sha), 'CORRELATED', match.score, ['same deployment commit'], 'Commit', event.commit_sha);
    }
    updated.push(next);
  }

  const corrEvidence = correlatedEvidence({
    source,
    source_event_id: event.source_event_id ?? event.event_id,
    observed_at: event.timestamp,
    metadata: { correlations: correlations.length },
  });
  nodes[0] = {
    ...nodes[0]!,
    meta: {
      ...nodes[0]!.meta,
      correlation_evidence: corrEvidence,
    },
  };

  safeUpsert(graph, nodes, edges, metrics);
  persistCorrelations(store, projectId, event.event_id, correlations, metrics);
  const unmatched = updated.length === 0 && correlations.length === 0;
  recordProductionProcessed(metrics, Date.now() - t0, !unmatched);
  return { event_id: event.event_id, adrs: updated, correlations, unmatched };
}

export function correlateDomainProductionEvent(
  store: DecisionStore,
  graph: GraphBackend | undefined,
  projectId: string,
  event: DomainEvent,
  metrics?: ArchitectureMetricsCollector,
  policy?: CorrelationPolicy,
): Adr[] {
  const prod = productionEventFromDomain(event);
  if (!prod) {
    return [];
  }
  try {
    return correlateProductionEvent(store, graph, projectId, prod, metrics, policy).adrs;
  } catch {
    recordProductionFailed(metrics);
    return [];
  }
}

export function isProductionDomainType(type: string): type is ProductionEventType | 'DEPLOYMENT_CREATED' | 'TEST_CREATED' {
  return type in PRODUCTION_FAMILY || type === 'DEPLOYMENT_CREATED' || type === 'TEST_CREATED';
}
