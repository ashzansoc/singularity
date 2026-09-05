import { RelayOutboxPublisher, type RelayBus } from '@singularity/context';
import type { MemoryMetricsCollector } from '../metrics.js';
import { LocalMemoryBuffer } from './buffer.js';
import type { EventBus, MemoryEvent } from './schemas.js';

/**
 * Background drain: LocalMemoryBuffer → InMemoryEventBus.
 * Failures retry; coding is never involved.
 *
 * Implementation lives in the shared Neural Relay fabric
 * (@singularity/context/relay); this module passes the memory buffer/bus and
 * keeps the public `MemoryOutboxPublisher` symbol (and 40-tick flush default)
 * unchanged.
 */
export class MemoryOutboxPublisher {
  private readonly inner: RelayOutboxPublisher<MemoryEvent>;

  constructor(
    buffer: LocalMemoryBuffer,
    bus: EventBus,
    metrics?: MemoryMetricsCollector,
    intervalMs = 50,
  ) {
    // `bus` is always the concrete InMemoryEventBus at runtime (the subsystem
    // types the field as EventBus). Reach through to its shared relay handle.
    const concrete = bus as EventBus & { relay: RelayBus<MemoryEvent> };
    this.inner = new RelayOutboxPublisher<MemoryEvent>(
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

  async flush(maxTicks = 40): Promise<void> {
    await this.inner.flush(maxTicks);
  }
}

export interface EventPublisher {
  publish(event: Omit<MemoryEvent, 'event_id' | 'timestamp'> & Partial<MemoryEvent>): void;
}

export class BufferEventPublisher implements EventPublisher {
  constructor(private readonly buffer: LocalMemoryBuffer) {}

  publish(event: Omit<MemoryEvent, 'event_id' | 'timestamp'> & Partial<MemoryEvent>): void {
    this.buffer.append(event);
  }
}