/**
 * Architecture graph kinds. Canonical ADR text stays in SQLite DecisionStore.
 * Coding plane MUST NOT import this module.
 */

export const ARCH_NODE_KINDS = [
  'Project',
  'Repository',
  'Service',
  'Module',
  'Package',
  'File',
  'Function',
  'Class',
  'API',
  'Database',
  'Table',
  'Queue',
  'Topic',
  'ExternalService',
  'Deployment',
  'Environment',
  'ADR',
  'Decision',
  'Requirement',
  'Constraint',
  'Commit',
  'PullRequest',
  'Test',
  'TestExecution',
  'Incident',
  'Metric',
  'MetricObservation',
] as const;
export type ArchNodeKind = (typeof ARCH_NODE_KINDS)[number];

export const ARCH_REL_KINDS = [
  'CONTAINS',
  'DEPENDS_ON',
  'CALLS',
  'IMPORTS',
  'IMPLEMENTS',
  'DEPLOYED_TO',
  'PERSISTS_TO',
  'PUBLISHES_TO',
  'CONSUMES_FROM',
  'DECIDED_BY',
  'JUSTIFIED_BY',
  'CONSTRAINED_BY',
  'AFFECTS',
  'IMPLEMENTED_BY',
  'VALIDATED_BY',
  'RELATED_TO_DEPLOYMENT',
  'CONTAINS_COMMIT',
  'PRODUCED_METRIC',
  'ASSOCIATED_WITH',
  'CORRELATED_WITH',
  'TEMPORALLY_CORRELATED_WITH',
  'SUPERSEDES',
  'CONFLICTS_WITH',
  'REJECTED_ALTERNATIVE',
  'INTRODUCED_BY',
  'MODIFIED_BY',
  'REMOVED_BY',
  'EVIDENCED_BY',
] as const;
export type ArchRelKind = (typeof ARCH_REL_KINDS)[number];

export interface ArchNode {
  id: string;
  kind: ArchNodeKind;
  label: string;
  project_id: string;
  meta?: Record<string, unknown>;
}

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  kind: ArchRelKind;
  meta?: Record<string, unknown>;
}

export function nodeId(kind: ArchNodeKind, key: string): string {
  return `${kind}:${key}`;
}

export function edgeId(from: string, kind: ArchRelKind, to: string): string {
  return `${from}|${kind}|${to}`;
}
