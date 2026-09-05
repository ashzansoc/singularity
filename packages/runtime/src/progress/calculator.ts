/**
 * Weighted workflow progress from task DAG completion — never average agent percentages.
 */

import type { ExecutionPlan, TaskNode, TaskStatus } from '../types.js';

const ACTIVE: ReadonlySet<TaskStatus> = new Set([
  'running',
  'ready',
  'verifying' as TaskStatus,
]);

export interface WorkflowProgress {
  /** 0–100 when determinable; undefined when indeterminate */
  percent?: number;
  label: 'Working' | 'Analyzing' | 'Waiting' | 'Verifying' | 'Complete' | 'Failed';
  completedWeight: number;
  totalWeight: number;
  completedTasks: number;
  runningTasks: number;
  queuedTasks: number;
  blockedTasks: number;
  failedTasks: number;
  totalTasks: number;
}

function taskWeight(node: TaskNode): number {
  return Math.max(1, node.estimatedTokens || 1, node.priority || 1);
}

function normalizeStatus(status: TaskStatus): TaskStatus {
  if (status === 'ready') {
    return 'queued' as TaskStatus;
  }
  if (status === 'done') {
    return 'done';
  }
  return status;
}

export function isTaskCompleted(status: TaskStatus): boolean {
  const s = normalizeStatus(status);
  return s === 'done' || (s as string) === 'completed';
}

export function isTaskRunning(status: TaskStatus): boolean {
  return ACTIVE.has(status) || status === 'running';
}

export function isTaskQueued(status: TaskStatus): boolean {
  const s = normalizeStatus(status);
  return s === 'pending' || (s as string) === 'queued' || s === 'ready';
}

export function isTaskBlocked(status: TaskStatus): boolean {
  return (status as string) === 'blocked' || (status as string) === 'waiting';
}

export function calculateWorkflowProgress(plan: ExecutionPlan): WorkflowProgress {
  const nodes = plan.nodes;
  const totalTasks = nodes.length;
  if (totalTasks === 0) {
    return {
      percent: 100,
      label: 'Complete',
      completedWeight: 0,
      totalWeight: 0,
      completedTasks: 0,
      runningTasks: 0,
      queuedTasks: 0,
      blockedTasks: 0,
      failedTasks: 0,
      totalTasks: 0,
    };
  }

  let completedWeight = 0;
  let totalWeight = 0;
  let completedTasks = 0;
  let runningTasks = 0;
  let queuedTasks = 0;
  let blockedTasks = 0;
  let failedTasks = 0;
  let verifying = 0;

  for (const node of nodes) {
    const w = taskWeight(node);
    totalWeight += w;
    const status = node.status;

    if (isTaskCompleted(status)) {
      completedWeight += w;
      completedTasks++;
    } else if (status === 'failed') {
      failedTasks++;
    } else if ((status as string) === 'verifying') {
      verifying++;
      completedWeight += w * 0.9;
    } else if (isTaskRunning(status)) {
      runningTasks++;
      completedWeight += w * 0.35;
    } else if (isTaskBlocked(status)) {
      blockedTasks++;
    } else if (isTaskQueued(status)) {
      queuedTasks++;
    }
  }

  const allDone = completedTasks === totalTasks;
  const allFailed = failedTasks === totalTasks;
  const percent =
    totalWeight > 0 ? Math.min(100, Math.round((completedWeight / totalWeight) * 100)) : undefined;

  let label: WorkflowProgress['label'] = 'Working';
  if (allDone) {
    label = 'Complete';
  } else if (allFailed) {
    label = 'Failed';
  } else if (verifying > 0) {
    label = 'Verifying';
  } else if (runningTasks === 0 && queuedTasks > 0 && blockedTasks > 0) {
    label = 'Waiting';
  } else if (runningTasks === 0 && queuedTasks === totalTasks) {
    label = 'Analyzing';
  }

  return {
    percent: allDone ? 100 : percent,
    label,
    completedWeight,
    totalWeight,
    completedTasks,
    runningTasks,
    queuedTasks,
    blockedTasks,
    failedTasks,
    totalTasks,
  };
}

export function agentProgressLabel(node: TaskNode): string | undefined {
  if (isTaskCompleted(node.status)) {
    return undefined;
  }
  if (node.progress !== undefined && node.progress >= 0 && node.progress <= 100) {
    return `${node.progress}%`;
  }
  if ((node.status as string) === 'verifying') {
    return 'Verifying';
  }
  if (isTaskBlocked(node.status)) {
    return node.waitingReason ? `Waiting — ${node.waitingReason}` : 'Waiting';
  }
  if (isTaskRunning(node.status)) {
    return 'Working';
  }
  if (isTaskQueued(node.status)) {
    return 'Queued';
  }
  return 'Working';
}
