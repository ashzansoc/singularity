import { newId } from './hash.js';
import type { IntelligenceJob, JobKind, JobStatus } from './types.js';

export class JobQueue {
  private readonly jobs = new Map<string, IntelligenceJob>();

  enqueue(
    kind: JobKind,
    opts?: {
      uri?: string;
      priority?: number;
      payload?: Record<string, unknown>;
      id?: string;
    },
  ): IntelligenceJob {
    const uri = opts?.uri;
    if (uri) {
      for (const j of this.jobs.values()) {
        if (j.kind === kind && j.uri === uri && j.status === 'queued') {
          j.priority = Math.max(j.priority, opts?.priority ?? j.priority);
          if (opts?.payload) {
            j.payload = { ...j.payload, ...opts.payload };
          }
          return j;
        }
      }
    }
    const job: IntelligenceJob = {
      id: opts?.id ?? newId('job'),
      kind,
      uri,
      priority: opts?.priority ?? 10,
      payload: opts?.payload,
      status: 'queued',
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  dequeue(kinds?: JobKind[]): IntelligenceJob | undefined {
    const ready = [...this.jobs.values()]
      .filter((j) => j.status === 'queued' && (!kinds || kinds.includes(j.kind)))
      .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    const next = ready[0];
    if (!next) {
      return undefined;
    }
    next.status = 'running';
    next.startedAt = Date.now();
    return next;
  }

  complete(id: string, error?: string): void {
    const j = this.jobs.get(id);
    if (!j) {
      return;
    }
    j.status = error ? 'error' : 'done';
    j.finishedAt = Date.now();
    j.error = error;
  }

  depth(status: JobStatus = 'queued'): number {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.status === status) {
        n++;
      }
    }
    return n;
  }

  list(status?: JobStatus): IntelligenceJob[] {
    const all = [...this.jobs.values()];
    return status ? all.filter((j) => j.status === status) : all;
  }

  peekLsp(): IntelligenceJob[] {
    return this.list('queued').filter((j) => j.kind === 'LSP_ENRICH');
  }
}
