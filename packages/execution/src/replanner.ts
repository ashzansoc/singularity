import type { ExecutionPlan, TaskNode } from '@singularity/runtime';
import { createRemediationPlan, type RemediationReplanRequest } from '@singularity/runtime';
import type { LlmPort } from '@singularity/runtime';
import type { ExecutionGraph } from './graph.js';
import type { ExecutionStore } from './persistence/store.js';
import type { ExecutionEvent } from './events/types.js';

export type RetryPolicy = {
  maxRetries: number;
  backoffMs: number;
};

export const DEFAULT_RETRY_POLICIES: Record<string, RetryPolicy> = {
  timeout: { maxRetries: 2, backoffMs: 5000 },
  tool_failure: { maxRetries: 2, backoffMs: 3000 },
  provider_error: { maxRetries: 3, backoffMs: 8000 },
  verification_fail: { maxRetries: 1, backoffMs: 0 },
  merge_conflict: { maxRetries: 2, backoffMs: 2000 },
  default: { maxRetries: 1, backoffMs: 1000 },
};

export interface ReplannerOptions {
  llm: LlmPort;
  store: ExecutionStore;
  graph: ExecutionGraph;
  executionId: string;
  onEvent?: (event: ExecutionEvent) => void;
}

function emitEvent(
  opts: ReplannerOptions,
  kind: ExecutionEvent['kind'],
  message: string,
  taskId?: string,
  payload?: Record<string, unknown>,
): void {
  const event: ExecutionEvent = {
    id: `${opts.executionId}:${Date.now()}:${kind}`,
    executionId: opts.executionId,
    kind,
    taskId,
    message,
    payload,
    ts: Date.now(),
  };
  opts.store.appendEvent(event);
  opts.onEvent?.(event);
}

export function getRetryPolicy(failureClass: string): RetryPolicy {
  return DEFAULT_RETRY_POLICIES[failureClass] ?? DEFAULT_RETRY_POLICIES.default;
}

export function shouldRetry(failureClass: string, attemptCount: number): boolean {
  const policy = getRetryPolicy(failureClass);
  return attemptCount < policy.maxRetries;
}

export async function createCorrectiveTasks(
  opts: ReplannerOptions,
  failedTask: TaskNode,
  failureClass: string,
  failureMessage: string,
): Promise<TaskNode[]> {
  emitEvent(opts, 'ReplannerTriggered', `Replanner triggered for ${failedTask.id}: ${failureClass}`, failedTask.id, {
    failureClass,
    failureMessage,
  });

  opts.graph.updateTaskStatus(failedTask.id, 'cancelled');

  const correctiveId = `${failedTask.id}-fix-${Date.now()}`;
  const corrective: TaskNode = {
    id: correctiveId,
    title: `Fix: ${failedTask.title}`,
    description: failureMessage,
    deps: failedTask.deps,
    ownedPaths: failedTask.ownedPaths,
    expectedOutput: `Resolve failure: ${failureMessage}`,
    estimatedTokens: failedTask.estimatedTokens,
    recommendedTier: failedTask.recommendedTier,
    priority: failedTask.priority + 10,
    retryLimit: 1,
    status: 'ready',
    parentTaskId: failedTask.id,
    acceptanceCriteria: [`Address: ${failureMessage}`],
  };

  opts.graph.addTask(corrective);

  return [corrective];
}

export async function createRemediationTasks(
  opts: ReplannerOptions,
  req: RemediationReplanRequest,
): Promise<ExecutionPlan> {
  emitEvent(opts, 'ReplannerTriggered', 'Remediation replan requested', undefined, { missionId: req.missionId });
  const plan = await createRemediationPlan(req, { llm: opts.llm, sessionId: opts.executionId });
  for (const node of plan.nodes) {
    opts.graph.addTask(node);
  }
  return plan;
}
