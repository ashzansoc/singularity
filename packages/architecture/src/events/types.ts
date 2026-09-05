import {
  newRelayEventId as newEventId,
  parseRelayEventTypeName,
  relayEventTypeName,
} from '@singularity/context';

// Re-export the relay name helpers so downstream consumers keep the same API,
// while ALSO binding them locally (a bare `export { x } from` does not create a
// local binding, so the uses below would otherwise be "Cannot find name").
export { newEventId, parseRelayEventTypeName, relayEventTypeName };

export const DOMAIN_EVENT_TYPES = [
  'SESSION_STARTED',
  'SESSION_COMPLETED',
  'USER_INTENT_CAPTURED',
  'PLAN_CREATED',
  'PLAN_UPDATED',
  'CODE_CHANGE_STARTED',
  'CODE_CHANGE_COMPLETED',
  'FILE_CREATED',
  'FILE_MODIFIED',
  'FILE_DELETED',
  'ARCHITECTURAL_CHANGE_DETECTED',
  'COMMIT_CREATED',
  'COMMIT_PUSHED',
  'PR_CREATED',
  'PR_UPDATED',
  'PR_MERGED',
  'TEST_CREATED',
  'TEST_STARTED',
  'TEST_PASSED',
  'TEST_FAILED',
  'TEST_REGRESSION',
  'DEPLOYMENT_CREATED',
  'DEPLOYMENT_STARTED',
  'DEPLOYMENT_SUCCEEDED',
  'DEPLOYMENT_FAILED',
  'DEPLOYMENT_ROLLED_BACK',
  'SERVICE_CREATED',
  'SERVICE_MODIFIED',
  'SERVICE_DELETED',
  'DEPENDENCY_ADDED',
  'DEPENDENCY_REMOVED',
  'ADR_CANDIDATE_DETECTED',
  'ADR_CREATED',
  'ADR_UPDATED',
  'ADR_SUPERSEDED',
  'ARCHITECTURE_VALIDATION_REQUESTED',
  'ARCHITECTURE_VALIDATION_COMPLETED',
  'INCIDENT_REPORTED',
  'INCIDENT_UPDATED',
  'INCIDENT_RESOLVED',
  'METRIC_OBSERVED',
  'METRIC_THRESHOLD_BREACHED',
  'METRIC_RECOVERED',
  'ARCHITECTURE_DRIFT_DETECTED',
  'ARCHITECTURE_DRIFT_SCAN_REQUESTED',
  'ARCHITECTURE_EVOLUTION_PROPOSED',
  'ARCHITECTURE_DEBUG_CONTEXT_READY',
  'ARCHITECTURE_IMPACT_ANALYSIS_REQUESTED',
  'ARCHITECTURE_IMPACT_ANALYSIS_COMPLETED',
  'ARCHITECTURE_MISSION_RISK_ASSESSMENT_REQUESTED',
  'ARCHITECTURE_MISSION_RISK_ASSESSMENT_COMPLETED',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export interface DomainEvent {
  event_type: DomainEventType;
  event_version: number;
  event_id: string;
  timestamp: string;
  project_id: string;
  session_id?: string;
  task_id?: string;
  parent_event_id?: string;
  trace_id?: string;
  commit_id?: string;
  changed_files?: string[];
  payload?: Record<string, unknown>;
}

export function eventTypeName(type: DomainEventType, version = 1): string {
  return relayEventTypeName(type, version);
}

export function parseEventTypeName(name: string): { type: string; version: number } {
  return parseRelayEventTypeName(name);
}

export function createDomainEvent(
  partial: Omit<DomainEvent, 'event_id' | 'timestamp' | 'event_version'> & {
    event_id?: string;
    timestamp?: string;
    event_version?: number;
  },
): DomainEvent {
  return {
    event_version: partial.event_version ?? 1,
    event_id: partial.event_id ?? newEventId(),
    timestamp: partial.timestamp ?? new Date().toISOString(),
    event_type: partial.event_type,
    project_id: partial.project_id,
    session_id: partial.session_id,
    task_id: partial.task_id,
    parent_event_id: partial.parent_event_id,
    trace_id: partial.trace_id,
    commit_id: partial.commit_id,
    changed_files: partial.changed_files,
    payload: partial.payload,
  };
}

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): Promise<void>;
}
