import type { DomainEvent } from '../events/types.js';
import type { DecisionStore } from '../memory/decisionStore.js';
import type { GraphBackend } from '../graph/backend.js';
import type { Adr } from '../domain/adr/schema.js';
import { correlateDomainProductionEvent } from '../production/correlate.js';
import type { ArchitectureMetricsCollector } from '../metrics.js';

/**
 * Intelligence-plane helper. Coding Agent must never call this.
 */
export function attachProductionEvidence(
  store: DecisionStore,
  graph: GraphBackend | undefined,
  projectId: string,
  event: DomainEvent,
  metrics?: ArchitectureMetricsCollector,
): Adr[] {
  return correlateDomainProductionEvent(store, graph, projectId, event, metrics);
}
