export type EventPriority = 1 | 2 | 3 | 4 | 5;

const PRIORITY: Record<string, EventPriority> = {
  'architecture.decision': 1,
  'architecture.rejected': 1,
  'architecture.superseded': 1,
  ADR_CREATED: 1,
  ADR_SUPERSEDED: 1,
  'human.feedback': 1,
  'task.completed': 2,
  'task.failed': 2,
  'deployment.completed': 2,
  'incident.detected': 2,
  'commit.created': 2,
  COMMIT_CREATED: 2,
  'pull_request.created': 2,
  PR_CREATED: 2,
  'agent.decision': 2,
  'agent.discovery': 3,
  'agent.warning': 3,
  'agent.error': 3,
  'test.completed': 3,
  'code.changed': 4,
  CODE_CHANGE_COMPLETED: 4,
  FILE_CREATED: 4,
  FILE_MODIFIED: 4,
  FILE_DELETED: 4,
  USER_INTENT_CAPTURED: 4,
  'conversation.completed': 4,
  'task.started': 5,
};

export function eventPriority(eventType: string): EventPriority {
  return PRIORITY[eventType] ?? 4;
}
