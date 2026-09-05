import type {
  ExecutionRecord,
  IntegrationRecord,
  TaskArtifact,
  TaskAttempt,
  TaskDependency,
  VerificationRecord,
} from '../types.js';
import type { ExecutionEvent } from '../events/types.js';
import type { ExecutionPlan, TaskNode } from '@singularity/runtime';

export interface ExecutionStore {
  upsertExecution(record: ExecutionRecord): void;
  getExecution(id: string): ExecutionRecord | undefined;
  listExecutions(workspaceRoot: string): ExecutionRecord[];
  getActiveExecution(sessionId: string): ExecutionRecord | undefined;

  upsertTask(executionId: string, task: TaskNode): void;
  getTask(executionId: string, taskId: string): TaskNode | undefined;
  listTasks(executionId: string): TaskNode[];

  addDependency(dep: TaskDependency & { executionId: string }): void;
  listDependencies(executionId: string): TaskDependency[];

  insertAttempt(executionId: string, taskId: string, attempt: TaskAttempt): void;
  listAttempts(executionId: string, taskId: string): TaskAttempt[];

  insertArtifact(artifact: TaskArtifact): void;
  listArtifacts(executionId: string, taskId?: string): TaskArtifact[];

  upsertIntegration(record: IntegrationRecord): void;
  getIntegration(executionId: string): IntegrationRecord | undefined;

  insertVerification(record: VerificationRecord): void;
  getLatestVerification(executionId: string): VerificationRecord | undefined;

  appendEvent(event: ExecutionEvent): void;
  listEvents(executionId: string, limit?: number): ExecutionEvent[];

  savePlan(executionId: string, plan: ExecutionPlan): void;
  getPlan(executionId: string): ExecutionPlan | undefined;

  saveCheckpoint(executionId: string, batchIndex: number, completedTaskIds: string[], inFlightTaskIds: string[]): void;
  getCheckpoint(executionId: string): { batchIndex: number; completedTaskIds: string[]; inFlightTaskIds: string[] } | undefined;

  close(): void;
}
