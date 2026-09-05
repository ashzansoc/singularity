import type { DecisionStore } from '../memory/decisionStore.js';
import type { GraphBackend } from '../graph/backend.js';
import { nodeId } from '../graph/types.js';
import type { Adr } from '../domain/adr/schema.js';

export interface ProductionQueryResult {
  adrs: Array<{ id: string; title: string; incidents: string[]; deployments: string[] }>;
  nodes: Array<{ id: string; kind: string; label: string }>;
}

/**
 * Read already-materialized graph/store. Never calls live production APIs.
 */
export function queryProductionMaterialized(
  store: DecisionStore,
  graph: GraphBackend | undefined,
  projectId: string,
  q = 'incidents',
): ProductionQueryResult {
  const adrs = store.list({ project_id: projectId });
  const withIncidents = adrs.filter((a) => (a.evidence.incidents?.length ?? 0) > 0);
  const mapped = (q === 'incidents' ? withIncidents : adrs).map((a: Adr) => ({
    id: a.id,
    title: a.title,
    incidents: (a.evidence.incidents ?? []).map((i) => i.id),
    deployments: (a.evidence.deployments ?? []).map((d) => d.id),
  }));
  let listed: Array<{ id: string; kind: string; label: string }> = [];
  try {
    listed =
      graph?.listNodes().filter((n) => {
        if (q === 'incidents') {
          return n.kind === 'Incident' || n.kind === 'ADR';
        }
        if (q === 'deployments') {
          return n.kind === 'Deployment' || n.kind === 'Environment' || n.kind === 'ADR';
        }
        return (
          n.kind === 'Incident' ||
          n.kind === 'Deployment' ||
          n.kind === 'MetricObservation' ||
          n.kind === 'TestExecution' ||
          n.kind === 'Environment'
        );
      }).map((n) => ({ id: n.id, kind: n.kind, label: n.label })) ?? [];
  } catch {
    listed = [];
  }
  if (q === 'incidents' && graph) {
    try {
      for (const a of adrs) {
        const nb = graph.neighbors(nodeId('ADR', a.id), 1, ['EVIDENCED_BY', 'ASSOCIATED_WITH']);
        if (nb.nodes.some((n) => n.kind === 'Incident') && !mapped.some((m) => m.id === a.id)) {
          mapped.push({
            id: a.id,
            title: a.title,
            incidents: nb.nodes.filter((n) => n.kind === 'Incident').map((n) => n.label),
            deployments: (a.evidence.deployments ?? []).map((d) => d.id),
          });
        }
      }
    } catch {
      /* materialized read is best-effort */
    }
  }
  return {
    adrs: mapped,
    nodes: listed,
  };
}
