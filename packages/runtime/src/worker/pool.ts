/**
 * Simple concurrency-limited async worker pool.
 */
export class WorkerPool {
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
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}
