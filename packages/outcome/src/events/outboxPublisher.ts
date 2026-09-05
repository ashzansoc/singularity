import { RelayOutboxPublisher, type RelayBus } from '@singularity/context';
import type { OutcomeMetricsCollector } from '../metrics.js';
import { LocalEventBuffer } from './localBuffer.js';
import type { OutcomeEvent, EventBus } from './types.js';

/**
 * Background drain: LocalEventBuffer → InMemoryEventBus.
 * Failures retry; coding is never involved.
 *
 * Implementation lives in the shared Neural Relay fabric
 * (@singularity/context/relay); this module passes the outcome buffer/bus and
 * keeps the public `OutboxPublisher` symbol (and its 1000ms default interval)
 * unchanged.
 */
export class OutboxPublisher {
  private readonly inner: RelayOutboxPublisher<OutcomeEvent>;

  constructor(
    buffer: LocalEventBuffer,
    bus: EventBus,
    metrics?: OutcomeMetricsCollector,
    intervalMs = 1_000,
  ) {
    // `bus` is always the concrete InMemoryEventBus at runtime (the subsystem
    // types the field as EventBus). Reach through to its shared relay handle.
    const concrete = bus as EventBus & { relay: RelayBus<OutcomeEvent> };
    this.inner = new RelayOutboxPublisher<OutcomeEvent>(
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

export type { OutcomeEvent };