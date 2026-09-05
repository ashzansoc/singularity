/**
 * AgentAllocationEngine — dynamically sizes specialist teams from task complexity,
 * DAG shape, repository scope, and configured limits.
 */

import { buildDag } from '../graph/dag.js';
import { resolveModelRouting } from '../subagent/modelPolicy.js';
import { inferRoleFromText } from '../subagent/roleCatalog.js';
import type { ExecutionPlan, TaskNode } from '../types.js';
import {
  DEFAULT_MULTI_AGENT_LIMITS,
  type AllocationInput,
  type AllocationResult,
  type ExecutionMode,
  type MultiAgentLimits,
} from './types.js';

const ROLE_CONTEXT_SCOPES: Record<string, string[]> = {
  explorer: ['**/*'],
  researcher: ['**/*'],
  frontend: ['frontend/**', 'src/**/ui/**', '**/*.{tsx,jsx,vue,svelte,css}'],
  backend: ['backend/**', 'server/**', 'api/**', 'src/**/api/**', '**/*.{ts,js,py,go,rs}'],
  database: ['**/migrations/**', '**/schema/**', '**/*.sql', 'prisma/**'],
  tester: ['**/*.{test,spec}.*', 'tests/**', '**/__tests__/**'],
  reviewer: ['**/*'],
  debugger: ['**/*'],
  integrator: ['**/*'],
};

function mergeLimits(partial?: Partial<MultiAgentLimits>): MultiAgentLimits {
  return { ...DEFAULT_MULTI_AGENT_LIMITS, ...partial };
}

function dagWidth(plan: ExecutionPlan): number {
  const dag = buildDag(plan.nodes);
  let max = 0;
  for (const node of plan.nodes) {
    if (node.deps.length === 0) {
      max = Math.max(max, 1);
    }
  }
  const indegree = new Map<string, number>();
  for (const n of plan.nodes) {
    indegree.set(n.id, n.deps.length);
  }
  const layers: string[][] = [];
  let frontier = plan.nodes.filter((n) => n.deps.length === 0).map((n) => n.id);
  while (frontier.length) {
    layers.push(frontier);
    const next: string[] = [];
    for (const id of frontier) {
      for (const dep of dag.dependents.get(id) ?? []) {
        const d = (indegree.get(dep) ?? 1) - 1;
        indegree.set(dep, d);
        if (d === 0) {
          next.push(dep);
        }
      }
    }
    frontier = next;
    max = Math.max(max, frontier.length, layers[layers.length - 1]?.length ?? 0);
  }
  return Math.max(max, plan.nodes.length > 1 ? 2 : 1);
}

export function decideExecutionMode(input: AllocationInput): ExecutionMode {
  const count = input.plan.nodes.length;
  if (count <= 1) {
    return 'single';
  }
  if (input.complexityLane === 'fast') {
    return 'single';
  }
  if (input.complexityLane === 'medium' || count <= 5) {
    return 'parallel';
  }
  const width = dagWidth(input.plan);
  if (count >= 10 || width >= 6) {
    return 'large_team';
  }
  return 'parallel';
}

function contextScopeForTask(task: TaskNode): string[] {
  if (task.ownedPaths.length) {
    const owned = task.ownedPaths.map((p) => (p.includes('*') ? p : `${p.split('/').slice(0, -1).join('/')}/**`));
    return [...new Set([...owned, ...(task.neighborPaths ?? [])])];
  }
  const role = task.role ?? inferRoleFromText(task.title + ' ' + (task.objective ?? ''));
  return ROLE_CONTEXT_SCOPES[String(role)] ?? ['**/*'];
}

function deliverableForTask(task: TaskNode): string {
  if (task.expectedOutput?.trim()) {
    return task.expectedOutput.trim();
  }
  const role = task.role ?? 'specialist';
  return `${role} output for: ${task.objective ?? task.title}`;
}

function allocateAgentId(task: TaskNode, index: number): string {
  return task.assignedAgentId ?? `agent-${String(index + 1).padStart(2, '0')}`;
}

/**
 * Enrich plan nodes with agent ids, models, context scopes, and deliverables.
 * Trims task count to maxAgents when necessary (preserving dependency closure).
 */
export function allocateAgents(input: AllocationInput): AllocationResult {
  const limits = mergeLimits(input.limits);
  const mode = decideExecutionMode(input);
  let nodes = [...input.plan.nodes];

  if (nodes.length > limits.maxAgents) {
    nodes = trimToMaxAgents(nodes, limits.maxAgents);
  }

  const enriched: TaskNode[] = nodes.map((node, index) => {
    const routing = resolveModelRouting(node.modelPolicy);
    const assignedModel =
      node.assignedModel ?? node.preferredModelId ?? routing.modelId;
    return {
      ...node,
      assignedAgentId: allocateAgentId(node, index),
      assignedModel,
      contextScope: node.contextScope ?? contextScopeForTask(node),
      deliverable: node.deliverable ?? deliverableForTask(node),
      description: node.description ?? node.objective ?? node.title,
    };
  });

  const plan: ExecutionPlan = { ...input.plan, nodes: enriched };
  const recommendedConcurrency = Math.min(
    limits.maxConcurrentAgents,
    Math.max(1, dagWidth(plan)),
    enriched.length,
  );

  return {
    mode,
    recommendedConcurrency,
    plan,
    agentCount: enriched.length,
  };
}

/** Keep nodes on the critical dependency path + highest priority when over cap. */
function trimToMaxAgents(nodes: TaskNode[], max: number): TaskNode[] {
  if (nodes.length <= max) {
    return nodes;
  }
  const byPriority = [...nodes].sort((a, b) => b.priority - a.priority);
  const keep = new Set<string>();
  for (const n of byPriority.slice(0, max)) {
    keep.add(n.id);
    for (const d of n.deps) {
      keep.add(d);
    }
  }
  return nodes.filter((n) => keep.has(n.id));
}
