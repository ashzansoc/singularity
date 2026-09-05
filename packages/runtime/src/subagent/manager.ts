/**
 * SubagentManager — spawn bounds, live DAG insertion, usage aggregation.
 */

import { buildDag, criticalPathLength } from '../graph/dag.js';
import type { ExecutionPlan, RuntimeEvent, TaskNode } from '../types.js';
import { subagentSpecToTaskNode } from './mappers.js';
import type {
  SubagentBounds,
  SubagentDependencyRequest,
  SubagentResult,
  SubagentSpec,
  SubagentUsage,
} from './types.js';
import { DEFAULT_SUBAGENT_BOUNDS } from './types.js';

export class SubagentManager {
  private readonly bounds: SubagentBounds;
  private spawnedChildren = 0;
  private readonly onEvent?: (event: RuntimeEvent) => void;

  constructor(
    bounds?: Partial<SubagentBounds>,
    onEvent?: (event: RuntimeEvent) => void,
  ) {
    this.bounds = { ...DEFAULT_SUBAGENT_BOUNDS, ...bounds };
    this.onEvent = onEvent;
  }

  getBounds(): SubagentBounds {
    return { ...this.bounds };
  }

  canSpawn(plan: ExecutionPlan, parent: TaskNode): {
    ok: boolean;
    reason?: string;
  } {
    const depth = (parent.depth ?? 0) + 1;
    if (depth > this.bounds.maxSubagentDepth) {
      return {
        ok: false,
        reason: `maxSubagentDepth ${this.bounds.maxSubagentDepth} exceeded`,
      };
    }
    if (plan.nodes.length >= this.bounds.maxTotalSubagents) {
      return {
        ok: false,
        reason: `maxTotalSubagents ${this.bounds.maxTotalSubagents} exceeded`,
      };
    }
    const childrenOfParent = plan.nodes.filter(
      (n) => n.parentTaskId === parent.id,
    ).length;
    if (
      childrenOfParent >= this.bounds.maxSpawnedChildren ||
      this.spawnedChildren >= this.bounds.maxSpawnedChildren * plan.nodes.length
    ) {
      // Per-parent cap is the meaningful one
      if (childrenOfParent >= this.bounds.maxSpawnedChildren) {
        return {
          ok: false,
          reason: `maxSpawnedChildren ${this.bounds.maxSpawnedChildren} for parent ${parent.id}`,
        };
      }
    }
    return { ok: true };
  }

  /**
   * Insert a child subagent into the live plan. Returns the new node or null.
   */
  spawnChild(
    plan: ExecutionPlan,
    parent: TaskNode,
    request: SubagentDependencyRequest | SubagentSpec,
  ): TaskNode | null {
    const check = this.canSpawn(plan, parent);
    if (!check.ok) {
      this.onEvent?.({
        kind: 'subagent_cancelled',
        ts: Date.now(),
        taskId: parent.id,
        message: `Spawn rejected: ${check.reason}`,
        data: { reason: check.reason, request },
      });
      return null;
    }

    const spec: SubagentSpec =
      'type' in request && request.type === 'dependency_request'
        ? {
            id: `${parent.id}-${request.requestedRole}-${plan.nodes.length + 1}`,
            role: request.requestedRole,
            objective: request.objective,
            ownedPaths: request.ownedPaths ?? [],
            dependencies: [parent.id],
            parentTaskId: parent.id,
            depth: (parent.depth ?? 0) + 1,
          }
        : {
            ...(request as SubagentSpec),
            parentTaskId: parent.id,
            depth: (parent.depth ?? 0) + 1,
            dependencies: (request as SubagentSpec).dependencies ?? [parent.id],
          };

    // Avoid id collisions
    if (plan.nodes.some((n) => n.id === spec.id)) {
      spec.id = `${spec.id}-${Date.now().toString(36)}`;
    }

    const node = subagentSpecToTaskNode(spec, { parentTaskId: parent.id });
    plan.nodes.push(node);
    this.spawnedChildren += 1;

    // Refresh estimates
    try {
      const dag = buildDag(plan.nodes);
      plan.estimates = {
        totalTokens: plan.nodes.reduce((s, n) => s + n.estimatedTokens, 0),
        taskCount: plan.nodes.length,
        criticalPathLength: criticalPathLength(dag),
      };
    } catch {
      // Invalid DAG — remove node
      plan.nodes.pop();
      this.spawnedChildren -= 1;
      return null;
    }

    this.onEvent?.({
      kind: 'subagent_created',
      ts: Date.now(),
      taskId: node.id,
      message: `Spawned ${node.role} subagent ${node.id} from ${parent.id}`,
      data: {
        role: node.role,
        parentTaskId: parent.id,
        depth: node.depth,
        objective: node.objective,
      },
    });

    return node;
  }

  /**
   * Spawn a debugger/fixer after review rejection.
   */
  spawnFixer(
    plan: ExecutionPlan,
    reviewer: TaskNode,
    reviewSummary: string,
  ): TaskNode | null {
    const implementers = reviewer.deps
      .map((id) => plan.nodes.find((n) => n.id === id))
      .filter((n): n is TaskNode => Boolean(n));
    const ownedPaths = [
      ...new Set(implementers.flatMap((n) => n.ownedPaths)),
    ];
    return this.spawnChild(plan, reviewer, {
      id: `fix-${reviewer.id}`,
      role: 'debugger',
      objective: `Fix review issues: ${reviewSummary}`.slice(0, 500),
      ownedPaths: ownedPaths.length ? ownedPaths : reviewer.ownedPaths,
      dependencies: [reviewer.id],
      parentTaskId: reviewer.id,
      depth: (reviewer.depth ?? 0) + 1,
      retryLimit: 1,
    });
  }
}

export function aggregateUsage(
  results: Array<{ usage?: SubagentUsage; tokensUsed?: number; modelId?: string }>,
): SubagentUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let estimatedCost = 0;
  let latencyMs = 0;
  let model = 'aggregate';
  for (const r of results) {
    if (r.usage) {
      inputTokens += r.usage.inputTokens;
      outputTokens += r.usage.outputTokens;
      cachedTokens += r.usage.cachedTokens;
      estimatedCost += r.usage.estimatedCost;
      latencyMs += r.usage.latencyMs;
      model = r.usage.model || model;
    } else if (r.tokensUsed) {
      inputTokens += Math.floor(r.tokensUsed * 0.6);
      outputTokens += Math.ceil(r.tokensUsed * 0.4);
      model = r.modelId ?? model;
    }
  }
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    estimatedCost,
    latencyMs,
    model,
  };
}

export function collectSubagentResults(
  plan: ExecutionPlan,
): SubagentResult[] {
  return plan.nodes
    .map((n) => n.result)
    .filter((r): r is SubagentResult => Boolean(r));
}
