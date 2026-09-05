import type { OutcomeMetricsCollector } from '../metrics.js';
import type { VerificationPlan } from '../domain/types.js';
import { IntelligenceWorkerPool } from '../workers/pool.js';
import type { VerificationContext, VerificationResult } from './adapter.js';
import type { VerificationRunner } from './runner.js';

export class VerificationScheduler {
  readonly pool: IntelligenceWorkerPool;
  private readonly inflight = new Set<string>();

  constructor(
    concurrency: number,
    private readonly runner: VerificationRunner,
    private readonly metrics?: OutcomeMetricsCollector,
  ) {
    this.pool = new IntelligenceWorkerPool(concurrency);
  }

  isInflight(key: string): boolean {
    return this.inflight.has(key);
  }

  enqueue(
    key: string,
    plan: VerificationPlan,
    context: VerificationContext,
  ): Promise<VerificationResult> {
    if (this.inflight.has(key)) {
      return Promise.resolve({
        result: 'UNKNOWN',
        stdout: '',
        stderr: 'duplicate in-flight verification',
        durationMs: 0,
        timedOut: false,
        source: 'dedup',
      });
    }
    this.inflight.add(key);
    this.metrics?.setQueueDepth(this.pool.pending + this.pool.running);
    return this.pool
      .run(() => this.runner.run(plan, context))
      .finally(() => {
        this.inflight.delete(key);
        this.metrics?.setQueueDepth(this.pool.pending + this.pool.running);
      });
  }
}
