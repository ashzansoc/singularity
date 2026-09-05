import type { ExecutionStore } from './persistence/store.js';
import type { ExecutionCheckpoint, ExecutionStatus } from './types.js';

export interface CheckpointState {
  batchIndex: number;
  completedTaskIds: string[];
  inFlightTaskIds: string[];
  status: ExecutionStatus;
}

export function saveCheckpoint(
  store: ExecutionStore,
  executionId: string,
  state: CheckpointState,
): ExecutionCheckpoint {
  store.saveCheckpoint(executionId, state.batchIndex, state.completedTaskIds, state.inFlightTaskIds);
  const exec = store.getExecution(executionId);
  if (exec) {
    exec.status = state.status;
    exec.checkpointBatch = state.batchIndex;
    exec.updatedAt = Date.now();
    store.upsertExecution(exec);
  }
  return {
    executionId,
    batchIndex: state.batchIndex,
    completedTaskIds: state.completedTaskIds,
    inFlightTaskIds: state.inFlightTaskIds,
    status: state.status,
    savedAt: Date.now(),
  };
}

export function loadCheckpoint(store: ExecutionStore, executionId: string): CheckpointState | undefined {
  const cp = store.getCheckpoint(executionId);
  if (!cp) return undefined;
  const exec = store.getExecution(executionId);
  return {
    batchIndex: cp.batchIndex,
    completedTaskIds: cp.completedTaskIds,
    inFlightTaskIds: cp.inFlightTaskIds,
    status: exec?.status ?? 'paused',
  };
}

export function canResume(store: ExecutionStore, executionId: string): boolean {
  const exec = store.getExecution(executionId);
  const cp = store.getCheckpoint(executionId);
  return !!exec && !!cp && ['paused', 'running'].includes(exec.status);
}
