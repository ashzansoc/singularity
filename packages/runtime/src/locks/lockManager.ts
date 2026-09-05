import { normalizePath } from '../ports.js';

export interface LockLease {
  id: string;
  paths: string[];
  taskId: string;
  acquiredAt: number;
}

export interface LockManagerOptions {
  /** Default acquire timeout in ms. */
  timeoutMs?: number;
}

interface Waiter {
  paths: string[];
  taskId: string;
  resolve: (lease: LockLease | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Optimistic per-file lock manager.
 * acquire → lease → commit/abort → release; waiters queue on conflict.
 */
export class LockManager {
  private readonly held = new Map<string, string>(); // path → leaseId
  private readonly leases = new Map<string, LockLease>();
  private readonly waiters: Waiter[] = [];
  private readonly timeoutMs: number;
  private seq = 0;

  constructor(opts: LockManagerOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** Paths currently locked. */
  get lockedPaths(): string[] {
    return [...this.held.keys()];
  }

  async acquire(
    paths: string[],
    taskId: string,
    timeoutMs = this.timeoutMs,
  ): Promise<LockLease> {
    const normalized = uniquePaths(paths);
    if (normalized.length === 0) {
      const lease: LockLease = {
        id: `lease-${++this.seq}`,
        paths: [],
        taskId,
        acquiredAt: Date.now(),
      };
      this.leases.set(lease.id, lease);
      return lease;
    }

    const tryNow = (): LockLease | undefined => {
      if (normalized.some((p) => this.held.has(p))) {
        return undefined;
      }
      const lease: LockLease = {
        id: `lease-${++this.seq}`,
        paths: normalized,
        taskId,
        acquiredAt: Date.now(),
      };
      for (const p of normalized) {
        this.held.set(p, lease.id);
      }
      this.leases.set(lease.id, lease);
      return lease;
    };

    const immediate = tryNow();
    if (immediate) {
      return immediate;
    }

    return new Promise<LockLease>((resolve, reject) => {
      const waiter: Waiter = {
        paths: normalized,
        taskId,
        resolve: (lease) => {
          if (!lease) {
            reject(new LockTimeoutError(taskId, normalized));
          } else {
            resolve(lease);
          }
        },
        timer: setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) {
            this.waiters.splice(idx, 1);
          }
          waiter.resolve(undefined);
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  /** Mark successful edit; keeps lease until release. */
  commit(leaseId: string): void {
    if (!this.leases.has(leaseId)) {
      throw new Error(`Unknown lease ${leaseId}`);
    }
  }

  /** Discard edits conceptually; same as release for MVP locks. */
  abort(leaseId: string): void {
    this.release(leaseId);
  }

  release(leaseId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease) {
      return;
    }
    for (const p of lease.paths) {
      if (this.held.get(p) === leaseId) {
        this.held.delete(p);
      }
    }
    this.leases.delete(leaseId);
    this.drainWaiters();
  }

  private drainWaiters(): void {
    // Fair FIFO: grant first waiter whose paths are free
    for (let i = 0; i < this.waiters.length; i++) {
      const w = this.waiters[i]!;
      if (w.paths.some((p) => this.held.has(p))) {
        continue;
      }
      this.waiters.splice(i, 1);
      clearTimeout(w.timer);
      const lease: LockLease = {
        id: `lease-${++this.seq}`,
        paths: w.paths,
        taskId: w.taskId,
        acquiredAt: Date.now(),
      };
      for (const p of w.paths) {
        this.held.set(p, lease.id);
      }
      this.leases.set(lease.id, lease);
      w.resolve(lease);
      return;
    }
  }
}

export class LockTimeoutError extends Error {
  readonly taskId: string;
  readonly paths: string[];

  constructor(taskId: string, paths: string[]) {
    super(`Lock timeout for task ${taskId} on ${paths.join(', ')}`);
    this.name = 'LockTimeoutError';
    this.taskId = taskId;
    this.paths = paths;
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map(normalizePath))];
}
