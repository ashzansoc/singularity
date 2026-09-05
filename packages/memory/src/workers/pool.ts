export class IntelligenceWorkerPool {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(readonly concurrency: number) {
    if (concurrency < 1) {
      throw new Error('concurrency must be >= 1');
    }
  }

  get running(): number {
    return this.active;
  }

  get pending(): number {
    return this.queue.length;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
  ) {}

  get open(): boolean {
    return Date.now() < this.openUntil;
  }

  async exec<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    if (this.open) {
      return fallback;
    }
    try {
      const v = await fn();
      this.failures = 0;
      return v;
    } catch {
      this.failures += 1;
      if (this.failures >= this.threshold) {
        this.openUntil = Date.now() + this.cooldownMs;
      }
      return fallback;
    }
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openUntil = Date.now() + this.cooldownMs;
    }
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  delays: number[],
  onRetry?: () => void,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      onRetry?.();
      const wait = delays[i];
      if (wait === undefined) {
        break;
      }
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
