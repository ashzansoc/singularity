/**
 * Neural Relay — shared event fabric.
 *
 * Single generic implementation of the in-process event bus + WAL event buffer
 * + outbox publisher that used to be triplicated across @singularity/architecture,
 * @singularity/memory, and @singularity/outcome. This module owns ONLY transport:
 * it does not interpret, filter, or act on event payloads.
 *
 * Consumers instantiate with their own event type + metrics collector via the
 * thin re-export modules in each plane (e.g. architecture/events/memoryBus.ts),
 * so public symbols stay unchanged while the implementation lives here once.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** Minimal metrics surface shared by all three plane collectors. */
export interface RelayMetrics {
  setQueueDepth?(n: number): void;
  recordDropped?(): void;
  recordRetry?(): void;
  recordReceived?(): void;
}

/** Any event with the transport-relevant fields. */
export interface RelayEventLike {
  event_type: string;
  event_id: string;
  timestamp: string;
}

/** Create a fully-formed event from a partial (each plane supplies this). */
export type EventFactory<E> = (
  partial: Record<string, unknown>,
) => E;

export function newRelayEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Versioned name `<type>.v{n}` — same semantics as each plane's eventTypeName. */
export function relayEventTypeName<ET extends string>(type: ET, version = 1): string {
  return `${type}.v${version}`;
}

export function parseRelayEventTypeName(name: string): { type: string; version: number } {
  const m = /^(.*)\.v(\d+)$/.exec(name);
  if (!m) {
    return { type: name, version: 1 };
  }
  return { type: m[1]!, version: Number(m[2]) };
}

export type RelayHandler<E> = (event: E) => void | Promise<void>;

export interface RelayBus<E> {
  publish(event: E): Promise<void>;
  subscribe(eventType: string, handler: RelayHandler<E>): Promise<void>;
}

/**
 * In-process bus. Matches the per-plane buses exactly:
 * handlers can subscribe to a bare type or a versioned `<type>.v<n>` name,
 * and both receive events whose type matches. Wildcard `*` is also honored
 * (memory plane behavior).
 */
export class InMemoryRelayBus<E extends RelayEventLike> implements RelayBus<E> {
  private readonly handlers = new Map<string, RelayHandler<E>[]>();

  async publish(event: E): Promise<void> {
    const seen = new Set<RelayHandler<E>>();
    const typed = event.event_type as string;
    const keys = [typed, relayEventTypeName(typed as never)];
    for (const key of keys) {
      for (const h of this.handlers.get(key) ?? []) {
        seen.add(h);
      }
    }
    for (const [pattern, list] of this.handlers) {
      const parsed = parseRelayEventTypeName(pattern);
      if (parsed.type === typed || pattern === '*') {
        for (const h of list) {
          seen.add(h);
        }
      }
    }
    for (const h of seen) {
      await h(event);
    }
  }

  async subscribe(eventType: string, handler: RelayHandler<E>): Promise<void> {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }
}

export interface RelayBufferOptions<E> {
  walPath?: string;
  max?: number;
  metrics?: RelayMetrics;
  /** Create a full event from the partial passed to append (plane-specific). */
  create?: EventFactory<E>;
  /**
   * Optional capacity shed policy. Default (architecture/outcome behavior):
   * drop the oldest (FIFO). When provided (memory behavior), pick the victim.
   */
  shedVictimIndex?: (events: E[], max: number) => number;
}

/**
 * WAL event buffer. `append` is synchronous, never throws to the caller, and
 * replays previously-appended WAL lines on construction.
 */
export class RelayEventBuffer<E extends RelayEventLike> {
  private readonly memory: E[] = [];
  private readonly walPath?: string;
  private readonly max: number;
  private readonly metrics?: RelayMetrics;
  private readonly create: EventFactory<E>;
  private readonly shedVictim?: (events: E[], max: number) => number;
  private dropped = 0;

  constructor(opts: RelayBufferOptions<E>) {
    this.walPath = opts.walPath;
    this.max = opts.max ?? 20_000;
    this.metrics = opts.metrics;
    this.create = opts.create ?? ((partial) => partial as E);
    this.shedVictim = opts.shedVictimIndex;
    if (this.walPath) {
      try {
        mkdirSync(dirname(this.walPath), { recursive: true });
        this.replayWal();
      } catch {
        /* coding continues */
      }
    }
  }

  /** Non-blocking. Do not await. */
  append(
    event: Omit<E, 'event_id' | 'timestamp'> &
      Partial<E> &
      Record<string, unknown>,
  ): void {
    try {
      const full = this.create(event as Record<string, unknown>);
      this.metrics?.recordReceived?.();
      if (this.memory.length >= this.max) {
        if (this.shedVictim) {
          const idx = this.shedVictim(this.memory, this.max);
          this.memory.splice(idx, 1);
        } else {
          this.memory.shift();
        }
        this.dropped += 1;
        this.metrics?.recordDropped?.();
      }
      this.memory.push(full as E);
      this.metrics?.setQueueDepth?.(this.memory.length);
      this.flushWalLine(full as E);
    } catch {
      this.dropped += 1;
      this.metrics?.recordDropped?.();
    }
  }

  drain(max = 64): E[] {
    const n = Math.min(max, this.memory.length);
    return this.memory.splice(0, n);
  }

  peekDepth(): number {
    return this.memory.length;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  clearWal(): void {
    if (!this.walPath) {
      return;
    }
    try {
      writeFileSync(this.walPath, '');
    } catch {
      /* ignore */
    }
  }

  /** Test helper (memory plane): fill the ring to capacity with a fill event. */
  saturateForTest(fill: () => E): void {
    while (this.memory.length < this.max) {
      this.memory.push(fill());
    }
    this.metrics?.setQueueDepth?.(this.memory.length);
  }

  private flushWalLine(event: E): void {
    if (!this.walPath) {
      return;
    }
    try {
      appendFileSync(this.walPath, `${JSON.stringify(event)}\n`);
    } catch {
      /* still in memory */
    }
  }

  private replayWal(): void {
    if (!this.walPath || !existsSync(this.walPath)) {
      return;
    }
    try {
      const text = readFileSync(this.walPath, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) {
          continue;
        }
        try {
          const ev = JSON.parse(line) as E;
          if (ev?.event_type) {
            this.memory.push(ev);
          }
        } catch {
          /* skip bad line */
        }
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Background drain: RelayEventBuffer → RelayBus. Failures retry.
 * Interval default matches outcome (1000ms); each plane's re-export passes its own.
 */
export class RelayOutboxPublisher<E extends RelayEventLike> {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly buffer: RelayEventBuffer<E>,
    private readonly bus: RelayBus<E>,
    private readonly metrics?: RelayMetrics,
    private readonly intervalMs = 50,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    let n = 0;
    try {
      const batch = this.buffer.drain(32);
      for (const ev of batch) {
        try {
          await this.bus.publish(ev);
          n += 1;
        } catch {
          this.metrics?.recordRetry?.();
          this.buffer.append(ev as never);
        }
      }
      this.metrics?.setQueueDepth?.(this.buffer.peekDepth());
    } finally {
      this.running = false;
    }
    return n;
  }

  /** Test helper: drain until empty or max ticks. */
  async flush(maxTicks = 20): Promise<void> {
    for (let i = 0; i < maxTicks && this.buffer.peekDepth() > 0; i++) {
      await this.tick();
    }
  }
}