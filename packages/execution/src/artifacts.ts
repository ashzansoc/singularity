import { createHash } from 'node:crypto';
import type { TaskArtifact } from './types.js';
import type { ExecutionStore } from './persistence/store.js';
import type { SubagentResult } from '@singularity/runtime';

export function hashPayload(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function createTaskArtifact(
  taskId: string,
  kind: string,
  payload: Record<string, unknown>,
  path?: string,
): TaskArtifact {
  return {
    taskId,
    kind,
    path,
    sha256: hashPayload(payload),
    jsonPayload: payload,
    createdAt: Date.now(),
  };
}

export function artifactFromSubagentResult(taskId: string, result: SubagentResult): TaskArtifact {
  return createTaskArtifact(taskId, 'subagent_result', result as unknown as Record<string, unknown>);
}

export class ArtifactStore {
  constructor(private readonly store: ExecutionStore) {}

  save(artifact: TaskArtifact): void {
    this.store.insertArtifact(artifact);
  }

  listForTask(taskId: string): TaskArtifact[] {
    return this.store.listArtifacts('', taskId);
  }

  listForExecution(executionId: string): TaskArtifact[] {
    return this.store.listArtifacts(executionId);
  }
}
