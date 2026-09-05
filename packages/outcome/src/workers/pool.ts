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
