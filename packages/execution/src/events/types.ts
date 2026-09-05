export type ExecutionEventKind =
  | 'ExecutionCreated'
  | 'ExecutionStarted'
  | 'ExecutionCompleted'
  | 'ExecutionFailed'
  | 'ExecutionPaused'
  | 'ExecutionResumed'
  | 'TaskCreated'
  | 'TaskReady'
  | 'TaskStarted'
  | 'TaskCompleted'
  | 'TaskFailed'
  | 'TaskBlocked'
  | 'TaskRetry'
  | 'DependencyAdded'
  | 'BatchStarted'
  | 'BatchCompleted'
  | 'IntegrationStarted'
  | 'IntegrationCompleted'
  | 'IntegrationFailed'
  | 'VerificationStarted'
  | 'VerificationCompleted'
  | 'VerificationFailed'
  | 'ReplannerTriggered'
  | 'CheckpointSaved';

export interface ExecutionEvent {
  id: string;
  executionId: string;
  kind: ExecutionEventKind;
  taskId?: string;
  message: string;
  payload?: Record<string, unknown>;
  ts: number;
}
