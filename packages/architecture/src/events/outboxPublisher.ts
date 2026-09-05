import { RelayOutboxPublisher, type RelayBus } from '@singularity/context';
import type { ArchitectureMetricsCollector } from '../metrics.js';
import { LocalEventBuffer } from './localBuffer.js';
import type { DomainEvent, EventBus } from './types.js';

/**
 * Background drain: LocalEventBuffer → InMemoryEventBus.
 * Failures retry; coding is never involved.
 *
 * Implementation lives in the shared Neural Relay fabric
 * (@singularity/context/relay); this module passes the architecture buffer/bus
 * and keeps the public `OutboxPublisher` symbol unchanged.
 */
export class OutboxPublisher {
  private readonly inner: RelayOutboxPublisher<DomainEvent>;

  constructor(
    buffer: LocalEventBuffer,
    bus: EventBus,
    metrics?: ArchitectureMetricsCollector,
    intervalMs = 50,
  ) {
    // `bus` is always the concrete InMemoryEventBus at runtime (the subsystem
    // types the field as EventBus). Reach through to its shared relay handle.
    const concrete = bus as EventBus & { relay: RelayBus<DomainEvent> };
    this.inner = new RelayOutboxPublisher<DomainEvent>(
      buffer.relay,
      concrete.relay,
      metrics,
      intervalMs,
    );
  }

  start(): void {
    this.inner.start();
  }

  stop(): void {
    this.inner.stop();
  }

  async tick(): Promise<number> {
    return this.inner.tick();
  }

  /** Test helper: drain until empty or max ticks. */
  async flush(maxTicks = 20): Promise<void> {
    await this.inner.flush(maxTicks);
  }
}

export type { DomainEvent };