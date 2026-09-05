import type { ExecutionPlan, TaskNode, TaskStatus } from '@singularity/runtime';

/** Lifecycle status of an execution run. */
export type ExecutionStatus =
  | 'pending'
  | 'planning'
  | 'running'
  | 'integrating'
  | 'verifying'
  | 'replanning'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export type DependencyKind =
  | 'explicit'
  | 'file'
  | 'symbol'
  | 'interface'
  | 'artifact'
  | 'resource';

export interface TaskDependency {
  fromTaskId: string;
  toTaskId: string;
  kind: DependencyKind;
  reason?: string;
}

export interface TaskAttempt {
  attemptNumber: number;
  agentId?: string;
  modelId?: string;
  status: TaskStatus;
  startedAt?: number;
  completedAt?: number;
  failureClass?: string;
}

export interface TaskArtifact {
  taskId: string;
  kind: string;
  path?: string;
  sha256?: string;
  jsonPayload?: Record<string, unknown>;
  createdAt: number;
}

export interface IntegrationRecord {
  executionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  reportJson?: Record<string, unknown>;
  appliedPaths?: string[];
  createdAt: number;
  completedAt?: number;
}

export type VerificationVerdict = 'PASS' | 'FAIL' | 'PASS_WITH_WARNINGS';

export interface VerificationRecord {
  executionId: string;
  verdict: VerificationVerdict;
  reportJson?: Record<string, unknown>;
  createdAt: number;
}

export interface ExecutionRecord {
  id: string;
  objective: string;
  status: ExecutionStatus;
  sessionId?: string;
  workspaceRoot: string;
  plan?: ExecutionPlan;
  criticalPathJson?: number[];
  createdAt: number;
  updatedAt: number;
  checkpointBatch?: number;
}

export interface EnrichedExecutionGraph {
  executionId: string;
  plan: ExecutionPlan;
  dependencies: TaskDependency[];
  batches: TaskNode[][];
  criticalPathLength: number;
}

export interface ExecutionCheckpoint {
  executionId: string;
  batchIndex: number;
  completedTaskIds: string[];
  inFlightTaskIds: string[];
  status: ExecutionStatus;
  savedAt: number;
}
