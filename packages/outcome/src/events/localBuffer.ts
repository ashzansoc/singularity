import { RelayEventBuffer } from '@singularity/context';
import type { OutcomeMetricsCollector } from '../metrics.js';
import { createOutcomeEvent, type OutcomeEvent } from './types.js';

const DEFAULT_MAX = 20_000;

/**
 * Coding-plane event buffer.
 * `append` is synchronous and never throws to the caller.
 *
 * Implementation lives in the shared Neural Relay fabric
 * (@singularity/context/relay) — this module wires the outcome event factory +
 * metrics so public symbols remain unchanged.
 */
export class LocalEventBuffer {
  /** Visible for the shared outbox publisher wiring. */
  readonly relay: RelayEventBuffer<OutcomeEvent>;
  private readonly dropped = 0;

  constructor(opts?: {
    walPath?: string;
    max?: number;
    metrics?: OutcomeMetricsCollector;
  }) {
    this.relay = new RelayEventBuffer<OutcomeEvent>({
      walPath: opts?.walPath,
      max: opts?.max ?? DEFAULT_MAX,
      metrics: opts?.metrics,
      create: (partial) => createOutcomeEvent(partial as never) as OutcomeEvent,
    });
  }

  /** Non-blocking. Do not await. */
  append(
    event: Omit<OutcomeEvent, 'event_id' | 'timestamp' | 'event_version'> &
      Partial<OutcomeEvent>,
  ): void {
    this.relay.append(event as never);
  }

  drain(max = 64): OutcomeEvent[] {
    return this.relay.drain(max);
  }

  peekDepth(): number {
    return this.relay.peekDepth();
  }

  get droppedCount(): number {
    return this.relay.droppedCount + this.dropped;
  }

  clearWal(): void {
    this.relay.clearWal();
  }
}