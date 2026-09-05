import { InMemoryRelayBus, type RelayHandler } from '@singularity/context';
import type { DomainEvent, EventBus, EventHandler } from './types.js';

/**
 * In-process bus used when SQLite outbox is unavailable.
 * Never used synchronously from the coding LLM path.
 *
 * Implementation lives in the shared Neural Relay fabric
 * (@singularity/context/relay) — this module only re-aliases it to the
 * architecture event types so public symbols remain unchanged.
 */
export class InMemoryEventBus implements EventBus {
  /** Visible for the shared outbox publisher wiring. */
  readonly relay: InMemoryRelayBus<DomainEvent>;
  private readonly inner: InMemoryRelayBus<DomainEvent>;

  constructor() {
    this.inner = new InMemoryRelayBus<DomainEvent>();
    this.relay = this.inner;
  }

  async publish(event: DomainEvent): Promise<void> {
    return this.inner.publish(event);
  }

  async subscribe(eventType: string, handler: EventHandler): Promise<void> {
    return this.inner.subscribe(eventType, handler as RelayHandler<DomainEvent>);
  }
}