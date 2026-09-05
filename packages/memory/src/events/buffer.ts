import { RelayEventBuffer } from '@singularity/context';
import type { MemoryMetricsCollector } from '../metrics.js';
import { createMemoryEvent, type MemoryEvent } from './schemas.js';
import { eventPriority } from './priorities.js';

/**
 * Coding-plane event buffer. `append` is synchronous and never throws.
 *
 * Implementation lives in the shared Neural Relay fabric
 * (@singularity/context/relay). This module wires the memory event factory,
 * metrics, the priority-based shed policy, and the test saturator so the
 * public `LocalMemoryBuffer` symbol behaves exactly as before.
 */
export class LocalMemoryBuffer {
  /** Visible for the shared outbox publisher wiring. */
  readonly relay: RelayEventBuffer<MemoryEvent>;
  private readonly dropped = 0;

  constructor(opts?: {
    walPath?: string;
    max?: number;
    metrics?: MemoryMetricsCollector;
  }) {
    const max = opts?.max ?? 20_000;
    this.relay = new RelayEventBuffer<MemoryEvent>({
      walPath: opts?.walPath,
      max,
      metrics: opts?.metrics,
      create: (partial) => createMemoryEvent(partial as never),
      shedVictimIndex: (events, _max) => {
        // Original `shed()`: pick the highest-priority (worst) event to drop;
        // when even the worst is low priority, drop the oldest instead.
        let idx = 0;
        let worst = 0;
        for (let i = 0; i < events.length; i++) {
          const p = eventPriority(events[i]!.event_type);
          if (p >= worst) {
            worst = p;
            idx = i;
          }
        }
        return worst <= 1 ? 0 : idx;
      },
    });
  }

  append(
    event: Omit<MemoryEvent, 'event_id' | 'timestamp'> & Partial<MemoryEvent>,
  ): void {
    this.relay.append(event as never);
  }

  drain(max = 64): MemoryEvent[] {
    return this.relay.drain(max);
  }

  peekDepth(): number {
    return this.relay.peekDepth();
  }

  get droppedCount(): number {
    return this.relay.droppedCount + this.dropped;
  }

  saturateForTest(): void {
    this.relay.saturateForTest(() =>
      createMemoryEvent({ event_type: 'task.started', project_id: 'sat' }),
    );
  }

  clearWal(): void {
    this.relay.clearWal();
  }
}