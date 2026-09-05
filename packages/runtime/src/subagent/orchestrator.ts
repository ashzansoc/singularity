/**
 * SubagentOrchestrator — normalize plans, apply role defaults, emit lifecycle,
 * prepare per-node filtered context. Does NOT replace the DAG scheduler.
 */

import { buildDag, criticalPathLength } from '../graph/dag.js';
import type { ExecutionPlan, RuntimeEvent, TaskNode } from '../types.js';
import {
  buildSubagentContext,
  collectDependencyResults,
} from './context.js';
import { enrichTaskNodeAsSubagent, subagentSpecToTaskNode } from './mappers.js';
import { SubagentManager } from './manager.js';
import { getRoleDefaults, inferRoleFromText } from './roleCatalog.js';
import type { SubagentBounds } from './types.js';

export interface OrchestratorOptions {
  bounds?: Partial<SubagentBounds>;
  onEvent?: (event: RuntimeEvent) => void;
  /** Ensure tester → reviewer tails on complex plans (default true). */
  ensureReviewTail?: boolean;
}

export interface RawPlanWithSubagents {
  projectSummary?: string;
  codingStandards?: string;
  nodes?: Array<Record<string, unknown>>;
  subagents?: Array<Record<string, unknown>>;
}

/**
 * Thin orchestrator over planner output + live scheduler hooks.
 */
export class SubagentOrchestrator {
  readonly manager: SubagentManager;
  private readonly ensureReviewTail: boolean;
  private readonly onEvent?: (event: RuntimeEvent) => void;

  constructor(options: OrchestratorOptions = {}) {
    this.manager = new SubagentManager(options.bounds, options.onEvent);
    this.ensureReviewTail = options.ensureReviewTail !== false;
    this.onEvent = options.onEvent;
  }

  getBounds(): SubagentBounds {
    return this.manager.getBounds();
  }

  /**
   * Normalize ExecutionPlan: enrich nodes as subagents, optional review tail.
   */
  normalize(plan: ExecutionPlan): ExecutionPlan {
    const nodes = plan.nodes.map((n) => enrichTaskNodeAsSubagent(n));

    let next: ExecutionPlan = { ...plan, nodes };

    if (this.ensureReviewTail) {
      next = this.maybeAppendReviewTail(next);
    }

    for (const n of next.nodes) {
      this.onEvent?.({
        kind: 'subagent_created',
        ts: Date.now(),
        taskId: n.id,
        message: `Subagent ${n.role ?? 'general'}: ${n.id}`,
        data: {
          role: n.role,
          objective: n.objective ?? n.title,
          deps: n.deps,
          ownedPaths: n.ownedPaths,
          tools: n.tools,
          modelPolicy: n.modelPolicy,
          status: n.status,
        },
      });
    }

    try {
      const dag = buildDag(next.nodes);
      next = {
        ...next,
        estimates: {
          ...next.estimates,
          taskCount: next.nodes.length,
          criticalPathLength: criticalPathLength(dag),
          totalTokens: next.nodes.reduce((s, n) => s + n.estimatedTokens, 0),
        },
      };
    } catch {
      // leave estimates as-is if DAG invalid (finalizePlan already validated)
    }

    return next;
  }

  /**
   * Prepare filtered context immediately before a worker runs.
   * Mutates the live DAG node in place — replacing the object breaks scheduler
   * retries (DAG keeps a stale `running` ref while plan.nodes gets a new pending one).
   */
  prepareTaskContext(plan: ExecutionPlan, task: TaskNode): TaskNode {
    const enriched = enrichTaskNodeAsSubagent(task);
    const depResults = collectDependencyResults(plan, enriched);
    const filtered = buildSubagentContext({
      task: enriched,
      plan,
      parentContext: plan.structuredContext,
      dependencyResults: depResults,
    });
    Object.assign(task, enriched, { filteredContext: filtered });
    const idx = plan.nodes.findIndex((n) => n.id === task.id);
    if (idx >= 0) {
      plan.nodes[idx] = task;
    }
    return task;
  }

  /**
   * Convert raw planner JSON that may use `subagents` alias into nodes.
   */
  static coerceRawPlan(raw: RawPlanWithSubagents): {
    projectSummary?: string;
    codingStandards?: string;
    nodes: Array<Record<string, unknown>>;
  } {
    const fromSubagents = Array.isArray(raw.subagents) ? raw.subagents : [];
    const fromNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
    const source = fromNodes.length ? fromNodes : fromSubagents;

    const nodes = source.map((n, i) => {
      const role = (n.role as string | undefined) ?? undefined;
      const objective = String(
        n.objective ?? n.title ?? n.id ?? `Task ${i + 1}`,
      );
      const inferredRole = role ?? inferRoleFromText(objective) ?? undefined;
      return {
        ...n,
        id: String(n.id ?? `task-${i + 1}`),
        title: String(n.title ?? objective),
        objective,
        role: inferredRole,
        deps: n.deps ?? n.dependencies ?? [],
        ownedPaths: n.ownedPaths ?? [],
      };
    });

    return {
      projectSummary: raw.projectSummary,
      codingStandards: raw.codingStandards,
      nodes,
    };
  }

  private maybeAppendReviewTail(plan: ExecutionPlan): ExecutionPlan {
    const hasReviewer = plan.nodes.some((n) => n.role === 'reviewer');
    const hasTester = plan.nodes.some((n) => n.role === 'tester');
    const implementers = plan.nodes.filter((n) =>
      ['frontend', 'backend', 'database', 'debugger'].includes(
        String(n.role ?? ''),
      ),
    );

    if (implementers.length < 2 || plan.nodes.length < 3) {
      return plan;
    }

    const nodes = [...plan.nodes];
    const leaves = nodes.filter(
      (n) =>
        !nodes.some((other) => other.deps.includes(n.id)) &&
        n.role !== 'reviewer' &&
        n.role !== 'tester',
    );

    if (!hasTester && leaves.length) {
      const testerDefaults = getRoleDefaults('tester');
      const tester = subagentSpecToTaskNode({
        id: 'tests-auto',
        role: 'tester',
        objective: 'Create and run tests for parallel implementation work',
        dependencies: leaves.map((l) => l.id),
        ownedPaths: ['.singularity/tests'],
        tools: testerDefaults.tools,
        modelPolicy: testerDefaults.modelPolicy,
        maxIterations: testerDefaults.maxIterations,
        retryLimit: testerDefaults.retryLimit,
      });
      if (nodes.some((n) => n.id === tester.id)) {
        tester.id = `tests-auto-${nodes.length + 1}`;
      }
      nodes.push(tester);
    }

    const afterTester = nodes.find((n) => n.role === 'tester');
    if (!hasReviewer) {
      const reviewerDefaults = getRoleDefaults('reviewer');
      const deps = afterTester ? [afterTester.id] : leaves.map((l) => l.id);
      const reviewer = subagentSpecToTaskNode({
        id: 'review-auto',
        role: 'reviewer',
        objective: 'Independent review of implementation and tests',
        dependencies: deps,
        ownedPaths: [],
        tools: reviewerDefaults.tools,
        modelPolicy: reviewerDefaults.modelPolicy,
        maxIterations: reviewerDefaults.maxIterations,
        retryLimit: reviewerDefaults.retryLimit,
      });
      if (nodes.some((n) => n.id === reviewer.id)) {
        reviewer.id = `review-auto-${nodes.length + 1}`;
      }
      nodes.push(reviewer);
    }

    return { ...plan, nodes };
  }
}

export function createSubagentOrchestrator(
  options?: OrchestratorOptions,
): SubagentOrchestrator {
  return new SubagentOrchestrator(options);
}
