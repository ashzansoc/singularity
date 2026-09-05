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
import type { ExecutionStore } from './store.js';

export class MemoryExecutionStore implements ExecutionStore {
  private executions = new Map<string, ExecutionRecord>();
  private tasks = new Map<string, Map<string, TaskNode>>();
  private deps = new Map<string, TaskDependency[]>();
  private attempts = new Map<string, TaskAttempt[]>();
  private artifacts = new Map<string, TaskArtifact[]>();
  private integrations = new Map<string, IntegrationRecord>();
  private verifications = new Map<string, VerificationRecord[]>();
  private events = new Map<string, ExecutionEvent[]>();
  private plans = new Map<string, ExecutionPlan>();
  private checkpoints = new Map<string, { batchIndex: number; completedTaskIds: string[]; inFlightTaskIds: string[] }>();

  upsertExecution(record: ExecutionRecord): void {
    this.executions.set(record.id, record);
  }

  getExecution(id: string): ExecutionRecord | undefined {
    return this.executions.get(id);
  }

  listExecutions(workspaceRoot: string): ExecutionRecord[] {
    return [...this.executions.values()].filter(e => e.workspaceRoot === workspaceRoot);
  }

  getActiveExecution(sessionId: string): ExecutionRecord | undefined {
    return [...this.executions.values()].find(
      e => e.sessionId === sessionId && !['completed', 'failed', 'cancelled'].includes(e.status),
    );
  }

  upsertTask(executionId: string, task: TaskNode): void {
    const map = this.tasks.get(executionId) ?? new Map();
    map.set(task.id, task);
    this.tasks.set(executionId, map);
  }

  getTask(executionId: string, taskId: string): TaskNode | undefined {
    return this.tasks.get(executionId)?.get(taskId);
  }

  listTasks(executionId: string): TaskNode[] {
    return [...(this.tasks.get(executionId)?.values() ?? [])];
  }

  addDependency(dep: TaskDependency & { executionId: string }): void {
    const list = this.deps.get(dep.executionId) ?? [];
    list.push({ fromTaskId: dep.fromTaskId, toTaskId: dep.toTaskId, kind: dep.kind, reason: dep.reason });
    this.deps.set(dep.executionId, list);
  }

  listDependencies(executionId: string): TaskDependency[] {
    return this.deps.get(executionId) ?? [];
  }

  insertAttempt(executionId: string, taskId: string, attempt: TaskAttempt): void {
    const key = `${executionId}:${taskId}`;
    const list = this.attempts.get(key) ?? [];
    list.push(attempt);
    this.attempts.set(key, list);
  }

  listAttempts(executionId: string, taskId: string): TaskAttempt[] {
    return this.attempts.get(`${executionId}:${taskId}`) ?? [];
  }

  insertArtifact(artifact: TaskArtifact): void {
    const list = this.artifacts.get(artifact.taskId) ?? [];
    list.push(artifact);
    this.artifacts.set(artifact.taskId, list);
  }

  listArtifacts(executionId: string, taskId?: string): TaskArtifact[] {
    if (taskId) {
      return this.artifacts.get(taskId) ?? [];
    }
    const tasks = this.listTasks(executionId);
    return tasks.flatMap(t => this.artifacts.get(t.id) ?? []);
  }

  upsertIntegration(record: IntegrationRecord): void {
    this.integrations.set(record.executionId, record);
  }

  getIntegration(executionId: string): IntegrationRecord | undefined {
    return this.integrations.get(executionId);
  }

  insertVerification(record: VerificationRecord): void {
    const list = this.verifications.get(record.executionId) ?? [];
    list.push(record);
    this.verifications.set(record.executionId, list);
  }

  getLatestVerification(executionId: string): VerificationRecord | undefined {
    const list = this.verifications.get(executionId) ?? [];
    return list[list.length - 1];
  }

  appendEvent(event: ExecutionEvent): void {
    const list = this.events.get(event.executionId) ?? [];
    list.push(event);
    this.events.set(event.executionId, list);
  }

  listEvents(executionId: string, limit?: number): ExecutionEvent[] {
    const list = this.events.get(executionId) ?? [];
    return limit ? list.slice(-limit) : list;
  }

  savePlan(executionId: string, plan: ExecutionPlan): void {
    this.plans.set(executionId, plan);
    for (const node of plan.nodes) {
      this.upsertTask(executionId, node);
    }
  }

  getPlan(executionId: string): ExecutionPlan | undefined {
    return this.plans.get(executionId);
  }

  saveCheckpoint(executionId: string, batchIndex: number, completedTaskIds: string[], inFlightTaskIds: string[]): void {
    this.checkpoints.set(executionId, { batchIndex, completedTaskIds, inFlightTaskIds });
    const exec = this.executions.get(executionId);
    if (exec) {
      exec.checkpointBatch = batchIndex;
      exec.updatedAt = Date.now();
    }
  }

  getCheckpoint(executionId: string): { batchIndex: number; completedTaskIds: string[]; inFlightTaskIds: string[] } | undefined {
    return this.checkpoints.get(executionId);
  }

  close(): void {
    this.executions.clear();
    this.tasks.clear();
    this.deps.clear();
    this.attempts.clear();
    this.artifacts.clear();
    this.integrations.clear();
    this.verifications.clear();
    this.events.clear();
    this.plans.clear();
    this.checkpoints.clear();
  }
}
