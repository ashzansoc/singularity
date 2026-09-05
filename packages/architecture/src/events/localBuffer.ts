import { RelayEventBuffer } from '@singularity/context';
import type { ArchitectureMetricsCollector } from '../metrics.js';
import { createDomainEvent, type DomainEvent } from './types.js';

const DEFAULT_MAX = 20_000;

/**
 * Coding-plane event buffer.
 * `append` is synchronous and never throws to the caller.
 * WAL flush is best-effort; coding continues if disk is unavailable.
 *
 * Implementation lives in the shared Neural Relay fabric
 * (@singularity/context/relay) — this module only wires the architecture
 * event factory + metrics so public symbols remain unchanged.
 */
export class LocalEventBuffer {
  /** Visible for shared outbox wiring. */
  readonly relay: RelayEventBuffer<DomainEvent>;
  private readonly dropped = 0;

  constructor(opts?: {
    walPath?: string;
    max?: number;
    metrics?: ArchitectureMetricsCollector;
  }) {
    this.relay = new RelayEventBuffer<DomainEvent>({
      walPath: opts?.walPath,
      max: opts?.max ?? DEFAULT_MAX,
      metrics: opts?.metrics,
      create: (partial) => createDomainEvent(partial as never) as DomainEvent,
    });
  }

  /** Non-blocking. Do not await. */
  append(
    event: Omit<DomainEvent, 'event_id' | 'timestamp' | 'event_version'> &
      Partial<DomainEvent>,
  ): void {
    this.relay.append(event as never);
  }

  drain(max = 64): DomainEvent[] {
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