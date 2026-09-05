import type { Adr } from '../domain/adr/schema.js';
import { isActiveStatus } from '../domain/adr/lifecycle.js';
import type { GraphBackend } from './backend.js';
import { edgeId, nodeId, type ArchEdge, type ArchNode } from './types.js';

export function serviceFromPath(file: string): string | undefined {
  const parts = file.replace(/\\/g, '/').split('/');
  const src = parts.indexOf('src');
  if (src >= 0 && parts[src + 1]) {
    return parts[src + 1];
  }
  const svc = parts.find((p) => /service|gateway|worker|api/i.test(p));
  return svc;
}

/**
 * Project an ADR (and its evidence) into the architecture graph.
 */
export function projectAdrToGraph(graph: GraphBackend, adr: Adr): void {
  const nodes: ArchNode[] = [
    {
      id: nodeId('ADR', adr.id),
      kind: 'ADR',
      label: adr.id,
      project_id: adr.project_id,
      meta: {
        status: adr.status,
        title: adr.title,
        summary: adr.decision.summary,
        active: isActiveStatus(adr.status),
      },
    },
  ];
  const edges: ArchEdge[] = [];

  for (const c of adr.affected_components) {
    const sid = nodeId('Service', c);
    nodes.push({
      id: sid,
      kind: 'Service',
      label: c,
      project_id: adr.project_id,
    });
    edges.push({
      id: edgeId(nodeId('ADR', adr.id), 'AFFECTS', sid),
      from: nodeId('ADR', adr.id),
      to: sid,
      kind: 'AFFECTS',
    });
  }

  for (const file of adr.evidence.code) {
    const fid = nodeId('File', file.id);
    nodes.push({
      id: fid,
      kind: 'File',
      label: file.id,
      project_id: adr.project_id,
    });
    edges.push({
      id: edgeId(nodeId('ADR', adr.id), 'IMPLEMENTED_BY', fid),
      from: nodeId('ADR', adr.id),
      to: fid,
      kind: 'IMPLEMENTED_BY',
    });
    const svc = serviceFromPath(file.id);
    if (svc) {
      const sid = nodeId('Service', svc);
      nodes.push({
        id: sid,
        kind: 'Service',
        label: svc,
        project_id: adr.project_id,
      });
      edges.push({
        id: edgeId(sid, 'CONTAINS', fid),
        from: sid,
        to: fid,
        kind: 'CONTAINS',
      });
      edges.push({
        id: edgeId(nodeId('ADR', adr.id), 'AFFECTS', sid),
        from: nodeId('ADR', adr.id),
        to: sid,
        kind: 'AFFECTS',
      });
    }
  }

  for (const c of adr.evidence.commits) {
    const cid = nodeId('Commit', c.id);
    nodes.push({
      id: cid,
      kind: 'Commit',
      label: c.id.slice(0, 12),
      project_id: adr.project_id,
    });
    edges.push({
      id: edgeId(nodeId('ADR', adr.id), 'IMPLEMENTED_BY', cid),
      from: nodeId('ADR', adr.id),
      to: cid,
      kind: 'IMPLEMENTED_BY',
    });
  }

  for (const p of adr.evidence.pull_requests) {
    const pid = nodeId('PullRequest', p.id);
    nodes.push({
      id: pid,
      kind: 'PullRequest',
      label: p.id,
      project_id: adr.project_id,
    });
    edges.push({
      id: edgeId(nodeId('ADR', adr.id), 'IMPLEMENTED_BY', pid),
      from: nodeId('ADR', adr.id),
      to: pid,
      kind: 'IMPLEMENTED_BY',
    });
  }

  for (const t of adr.evidence.tests) {
    const tid = nodeId('Test', t.id);
    nodes.push({
      id: tid,
      kind: 'Test',
      label: t.id,
      project_id: adr.project_id,
    });
    edges.push({
      id: edgeId(nodeId('ADR', adr.id), 'VALIDATED_BY', tid),
      from: nodeId('ADR', adr.id),
      to: tid,
      kind: 'VALIDATED_BY',
    });
  }

  for (const item of adr.evidence.incidents ?? []) {
    const iid = nodeId('Incident', item.id);
    nodes.push({
      id: iid,
      kind: 'Incident',
      label: item.id,
      project_id: adr.project_id,
    });
    edges.push({
      id: edgeId(nodeId('ADR', adr.id), 'EVIDENCED_BY', iid),
      from: nodeId('ADR', adr.id),
      to: iid,
      kind: 'EVIDENCED_BY',
    });
  }

  for (const item of adr.evidence.deployments ?? []) {
    const did = nodeId('Deployment', item.id);
    nodes.push({
      id: did,
      kind: 'Deployment',
      label: item.id,
      project_id: adr.project_id,
    });
    edges.push({
      id: edgeId(nodeId('ADR', adr.id), 'RELATED_TO_DEPLOYMENT', did),
      from: nodeId('ADR', adr.id),
      to: did,
      kind: 'RELATED_TO_DEPLOYMENT',
    });
  }

  for (const item of adr.evidence.metrics ?? []) {
    const mid = nodeId('Metric', item.id);
    nodes.push({
      id: mid,
      kind: 'Metric',
      label: item.id,
      project_id: adr.project_id,
    });
    edges.push({
      id: edgeId(nodeId('ADR', adr.id), 'EVIDENCED_BY', mid),
      from: nodeId('ADR', adr.id),
      to: mid,
      kind: 'EVIDENCED_BY',
    });
  }

  for (const alt of adr.alternatives.filter((a) => a.status === 'rejected')) {
    const aid = nodeId('Decision', `${adr.id}:alt:${alt.name}`);
    nodes.push({
      id: aid,
      kind: 'Decision',
      label: alt.name,
      project_id: adr.project_id,
      meta: { rejected: true, reason: alt.reason },
    });
    edges.push({
      id: edgeId(nodeId('ADR', adr.id), 'REJECTED_ALTERNATIVE', aid),
      from: nodeId('ADR', adr.id),
      to: aid,
      kind: 'REJECTED_ALTERNATIVE',
    });
  }

  for (const constraint of adr.constraints) {
    const cid = nodeId('Constraint', `${adr.id}:${constraint.slice(0, 40)}`);
    nodes.push({
      id: cid,
      kind: 'Constraint',
      label: constraint,
      project_id: adr.project_id,
    });
    edges.push({
      id: edgeId(nodeId('ADR', adr.id), 'CONSTRAINED_BY', cid),
      from: nodeId('ADR', adr.id),
      to: cid,
      kind: 'CONSTRAINED_BY',
    });
  }

  if (adr.relationships.supersedes) {
    edges.push({
      id: edgeId(nodeId('ADR', adr.id), 'SUPERSEDES', nodeId('ADR', adr.relationships.supersedes)),
      from: nodeId('ADR', adr.id),
      to: nodeId('ADR', adr.relationships.supersedes),
      kind: 'SUPERSEDES',
    });
  }
  if (adr.relationships.superseded_by) {
    edges.push({
      id: edgeId(
        nodeId('ADR', adr.relationships.superseded_by),
        'SUPERSEDES',
        nodeId('ADR', adr.id),
      ),
      from: nodeId('ADR', adr.relationships.superseded_by),
      to: nodeId('ADR', adr.id),
      kind: 'SUPERSEDES',
    });
  }

  graph.upsertNodes(nodes);
  graph.upsertEdges(edges);
}

export function adrsAffectingFile(graph: GraphBackend, filePath: string): string[] {
  const fid = nodeId('File', filePath);
  const { edges } = graph.neighbors(fid, 2, ['IMPLEMENTED_BY', 'AFFECTS', 'CONTAINS']);
  const ids = new Set<string>();
  for (const e of edges) {
    for (const end of [e.from, e.to]) {
      if (end.startsWith('ADR:')) {
        ids.add(end.slice(4));
      }
    }
  }
  return [...ids];
}

export function servicesForAdr(graph: GraphBackend, adrId: string): string[] {
  const { nodes } = graph.neighbors(nodeId('ADR', adrId), 1, ['AFFECTS']);
  return nodes.filter((n) => n.kind === 'Service').map((n) => n.label);
}
