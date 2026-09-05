import {
  parseRelayEventTypeName,
  relayEventTypeName,
} from '@singularity/context';

// Re-export the relay name helpers so downstream consumers keep the same API,
// while ALSO binding them locally (a bare `export { x } from` does not create a
// local binding).
import { newRelayEventId as newEventId } from '@singularity/context';
export { newEventId, parseRelayEventTypeName, relayEventTypeName };

export const OUTCOME_EVENT_TYPES = [
  'USER_INTENT_CAPTURED',
  'CODE_CHANGE_COMPLETED',
  'FILE_CREATED',
  'FILE_MODIFIED',
  'FILE_DELETED',
  'mission.created',
  'mission.updated',
  'mission.execution.updated',
  'requirements.extracted',
  'outcome.compiled',
  'verification.planned',
  'verification.requested',
  'verification.started',
  'verification.completed',
  'requirement.passed',
  'requirement.failed',
  'requirement.unknown',
  'outcome.achieved',
  'outcome.not_achieved',
  'outcome.blocked',
  'remediation.requested',
  'READY_FOR_VERIFICATION',
  'REVIEW_EVALUATE_REQUESTED',
  'REVIEW_REQUIRED',
  'REVIEW_STARTED',
  'REVIEW_APPROVED',
  'REVIEW_REJECTED',
  'REVIEW_CHANGES_REQUESTED',
  'REVIEW_EXPIRED',
  'REVIEW_SUPERSEDED',
] as const;

export type OutcomeEventType = (typeof OUTCOME_EVENT_TYPES)[number];

export interface OutcomeEvent {
  event_type: OutcomeEventType;
  event_version: number;
  event_id: string;
  timestamp: string;
  project_id: string;
  session_id?: string;
  task_id?: string;
  mission_id?: string;
  parent_event_id?: string;
  trace_id?: string;
  commit_id?: string;
  changed_files?: string[];
  payload?: Record<string, unknown>;
}

export function eventTypeName(type: OutcomeEventType, version = 1): string {
  return relayEventTypeName(type, version);
}

export function parseEventTypeName(name: string): { type: string; version: number } {
  return parseRelayEventTypeName(name);
}

export function createOutcomeEvent(
  partial: Omit<OutcomeEvent, 'event_id' | 'timestamp' | 'event_version'> & {
    event_id?: string;
    timestamp?: string;
    event_version?: number;
  },
): OutcomeEvent {
  return {
    event_version: partial.event_version ?? 1,
    event_id: partial.event_id ?? newEventId(),
    timestamp: partial.timestamp ?? new Date().toISOString(),
    event_type: partial.event_type,
    project_id: partial.project_id,
    session_id: partial.session_id,
    task_id: partial.task_id,
    mission_id: partial.mission_id,
    parent_event_id: partial.parent_event_id,
    trace_id: partial.trace_id,
    commit_id: partial.commit_id,
    changed_files: partial.changed_files,
    payload: partial.payload,
  };
}

export type EventHandler = (event: OutcomeEvent) => void | Promise<void>;

export interface EventBus {
  publish(event: OutcomeEvent): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): Promise<void>;
}
