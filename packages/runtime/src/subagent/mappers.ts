/**
 * Bidirectional mapping between SubagentSpec / Subagent and TaskNode.
 */

import type { TaskNode } from '../types.js';
import {
  getRoleDefaults,
  inferRoleFromText,
  roleFromSpecialty,
  strategyToTier,
} from './roleCatalog.js';
import type {
  ModelPolicy,
  Subagent,
  SubagentResult,
  SubagentRole,
  SubagentSpec,
  ToolPermission,
} from './types.js';
import { taskStatusToSubagentStatus } from './types.js';

export function resolveRole(spec: {
  role?: SubagentRole;
  specialty?: TaskNode['specialty'];
  title?: string;
  objective?: string;
}): SubagentRole {
  if (spec.role) {
    return spec.role;
  }
  const inferred = inferRoleFromText(
    `${spec.title ?? ''} ${spec.objective ?? ''}`,
  );
  if (inferred) {
    return inferred;
  }
  return roleFromSpecialty(spec.specialty);
}

export function mergeModelPolicy(
  role: SubagentRole,
  partial?: Partial<ModelPolicy>,
  preferredModelId?: string,
): ModelPolicy {
  const defaults = getRoleDefaults(role).modelPolicy;
  const preferredModels =
    partial?.preferredModels ??
    (preferredModelId ? [preferredModelId] : defaults.preferredModels);
  const strategy = partial?.strategy ?? defaults.strategy;
  return {
    strategy,
    preferredModels,
    maxCost: partial?.maxCost ?? defaults.maxCost,
    maxLatencyMs: partial?.maxLatencyMs ?? defaults.maxLatencyMs,
    preferredTier:
      partial?.preferredTier ??
      defaults.preferredTier ??
      strategyToTier(strategy),
  };
}

/**
 * Materialize a SubagentSpec into a TaskNode with role defaults applied.
 */
export function subagentSpecToTaskNode(
  spec: SubagentSpec,
  options?: { parentTaskId?: string },
): TaskNode {
  const role = resolveRole(spec);
  const defaults = getRoleDefaults(role);
  const modelPolicy = mergeModelPolicy(
    role,
    spec.modelPolicy,
    spec.preferredModelId,
  );
  const tools: ToolPermission[] = spec.tools?.length
    ? spec.tools
    : defaults.tools;
  const preferredModelId =
    spec.preferredModelId ?? modelPolicy.preferredModels?.[0];

  return {
    id: spec.id,
    title: spec.objective,
    deps: spec.dependencies ?? [],
    ownedPaths: spec.ownedPaths ?? [],
    expectedOutput: spec.expectedOutput ?? spec.objective,
    estimatedTokens: spec.estimatedTokens ?? 2000,
    recommendedTier:
      spec.recommendedTier ?? modelPolicy.preferredTier ?? 'T2',
    specialty: spec.specialty ?? defaults.specialty,
    preferredModelId,
    priority: spec.priority ?? 0,
    retryLimit: spec.retryLimit ?? defaults.retryLimit,
    status: 'pending',
    neighborPaths: spec.neighborPaths,
    attempts: 0,
    role,
    objective: spec.objective,
    tools,
    modelPolicy,
    maxIterations: spec.maxIterations ?? defaults.maxIterations,
    timeoutMs: spec.timeoutMs ?? defaults.timeoutMs,
    depth: spec.depth ?? 0,
    parentTaskId: spec.parentTaskId ?? options?.parentTaskId ?? '',
    deniedPaths: spec.deniedPaths,
  };
}

/**
 * Enrich an existing TaskNode with subagent fields (backward compatible).
 */
export function enrichTaskNodeAsSubagent(node: TaskNode): TaskNode {
  if (node.role && node.tools && node.modelPolicy && node.objective) {
    return node;
  }
  const role = resolveRole({
    role: node.role,
    specialty: node.specialty,
    title: node.title,
    objective: node.objective,
  });
  const defaults = getRoleDefaults(role);
  const modelPolicy =
    node.modelPolicy ??
    mergeModelPolicy(role, undefined, node.preferredModelId);
  return {
    ...node,
    role,
    objective: node.objective ?? node.title,
    tools: node.tools?.length ? node.tools : defaults.tools,
    modelPolicy,
    maxIterations: node.maxIterations ?? defaults.maxIterations,
    timeoutMs: node.timeoutMs ?? defaults.timeoutMs,
    depth: node.depth ?? 0,
    parentTaskId: node.parentTaskId ?? '',
    preferredModelId:
      node.preferredModelId ?? modelPolicy.preferredModels?.[0],
    recommendedTier:
      node.recommendedTier ?? modelPolicy.preferredTier ?? node.recommendedTier,
    specialty: node.specialty ?? defaults.specialty,
    retryLimit: node.retryLimit ?? defaults.retryLimit,
  };
}

export function taskNodeToSubagent(
  node: TaskNode,
  context = '',
): Subagent {
  const enriched = enrichTaskNodeAsSubagent(node);
  return {
    id: enriched.id,
    role: enriched.role!,
    objective: enriched.objective ?? enriched.title,
    parentTaskId: enriched.parentTaskId ?? '',
    allowedPaths: enriched.ownedPaths,
    deniedPaths: enriched.deniedPaths,
    tools: enriched.tools ?? [],
    context,
    modelPolicy: enriched.modelPolicy!,
    dependencies: enriched.deps,
    status: taskStatusToSubagentStatus(enriched.status),
    maxIterations: enriched.maxIterations,
    timeoutMs: enriched.timeoutMs,
    depth: enriched.depth,
    result: enriched.result,
  };
}

export function workerDiffsToFileLists(diffs: Array<{ path: string; isNew?: boolean }>): {
  filesCreated: string[];
  filesModified: string[];
} {
  const filesCreated: string[] = [];
  const filesModified: string[] = [];
  for (const d of diffs) {
    if (d.isNew) {
      filesCreated.push(d.path);
    } else {
      filesModified.push(d.path);
    }
  }
  return { filesCreated, filesModified };
}

export function attachResult(node: TaskNode, result: SubagentResult): TaskNode {
  return { ...node, result };
}
