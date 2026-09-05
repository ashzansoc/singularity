import { InMemoryRelayBus, type RelayHandler } from '@singularity/context';
import type { OutcomeEvent, EventBus, EventHandler } from './types.js';

/**
 * In-process bus used when SQLite outbox is unavailable.
 * Implementation lives in the shared Neural Relay fabric
 * (@singularity/context/relay) — this module only re-aliases it to the outcome
 * event types so public symbols remain unchanged.
 */
export class InMemoryEventBus implements EventBus {
  /** Visible for the shared outbox publisher wiring. */
  readonly relay: InMemoryRelayBus<OutcomeEvent>;
  private readonly inner: InMemoryRelayBus<OutcomeEvent>;

  constructor() {
    this.inner = new InMemoryRelayBus<OutcomeEvent>();
    this.relay = this.inner;
  }

  async publish(event: OutcomeEvent): Promise<void> {
    return this.inner.publish(event);
  }

  async subscribe(eventType: string, handler: EventHandler): Promise<void> {
    return this.inner.subscribe(eventType, handler as RelayHandler<OutcomeEvent>);
  }
}