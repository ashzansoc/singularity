import type { ComplexityLane } from '../fastpath/classifier.js';
import type { ExecutionPlan, TaskNode } from '../types.js';

/** How Singularity executes a user goal. */
export type ExecutionMode = 'single' | 'parallel' | 'large_team';

/** Configurable limits for multi-agent workflows. */
export interface MultiAgentLimits {
  maxAgents: number;
  maxConcurrentAgents: number;
  maxAgentRetries: number;
  maxTotalTokenBudget: number;
  maxWorkflowDurationMs: number;
}

export const DEFAULT_MULTI_AGENT_LIMITS: MultiAgentLimits = {
  maxAgents: 30,
  maxConcurrentAgents: 8,
  maxAgentRetries: 2,
  maxTotalTokenBudget: 2_000_000,
  maxWorkflowDurationMs: 30 * 60_000,
};

export interface AllocationInput {
  goal: string;
  plan: ExecutionPlan;
  complexityLane: ComplexityLane;
  repositoryFileCount?: number;
  limits?: Partial<MultiAgentLimits>;
}

export interface AllocationResult {
  mode: ExecutionMode;
  recommendedConcurrency: number;
  plan: ExecutionPlan;
  agentCount: number;
}

export interface AllocatedTask extends TaskNode {
  assignedAgentId: string;
  assignedModel?: string;
  contextScope: string[];
  deliverable: string;
}
