import { z } from 'zod';
import {
  InMemoryRelayBus,
  newRelayEventId,
  type RelayHandler,
} from '@singularity/context';

export const MEMORY_EVENT_TYPES = [
  'conversation.completed',
  'task.started',
  'task.completed',
  'task.failed',
  'agent.discovery',
  'agent.decision',
  'agent.warning',
  'agent.error',
  'code.changed',
  'commit.created',
  'pull_request.created',
  'test.completed',
  'architecture.decision',
  'architecture.rejected',
  'architecture.superseded',
  'human.feedback',
  'deployment.completed',
  'incident.detected',
  'USER_INTENT_CAPTURED',
  'CODE_CHANGE_COMPLETED',
  'FILE_CREATED',
  'FILE_MODIFIED',
  'FILE_DELETED',
  'COMMIT_CREATED',
  'PR_CREATED',
  'ADR_CREATED',
  'ADR_SUPERSEDED',
] as const;

export type MemoryEventType = (typeof MEMORY_EVENT_TYPES)[number];

export const MemoryEventSchema = z.object({
  event_id: z.string(),
  project_id: z.string().min(1),
  agent_id: z.string().optional(),
  task_id: z.string().optional(),
  event_type: z.string(),
  timestamp: z.string(),
  critical: z.boolean().optional(),
  payload: z.record(z.unknown()).optional(),
});
export type MemoryEvent = z.infer<typeof MemoryEventSchema>;

export function newEventId(): string {
  return newRelayEventId();
}

export function createMemoryEvent(
  partial: Omit<MemoryEvent, 'event_id' | 'timestamp'> & Partial<MemoryEvent>,
): MemoryEvent {
  return {
    event_id: partial.event_id ?? newEventId(),
    timestamp: partial.timestamp ?? new Date().toISOString(),
    project_id: partial.project_id,
    agent_id: partial.agent_id,
    task_id: partial.task_id,
    event_type: partial.event_type,
    critical: partial.critical,
    payload: partial.payload,
  };
}

export type EventHandler = (event: MemoryEvent) => void | Promise<void>;

export interface EventBus {
  publish(event: MemoryEvent): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): Promise<void>;
}

export class InMemoryEventBus implements EventBus {
  /** Visible for the shared outbox publisher wiring. */
  readonly relay: InMemoryRelayBus<MemoryEvent>;
  private readonly inner: InMemoryRelayBus<MemoryEvent>;

  constructor() {
    this.inner = new InMemoryRelayBus<MemoryEvent>();
    this.relay = this.inner;
  }

  async publish(event: MemoryEvent): Promise<void> {
    return this.inner.publish(event);
  }

  async subscribe(eventType: string, handler: EventHandler): Promise<void> {
    return this.inner.subscribe(eventType, handler as RelayHandler<MemoryEvent>);
  }
}
