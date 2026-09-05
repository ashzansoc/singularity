/**
 * Lightweight request tracing for Singularity LLM requests.
 *
 * Every traced request gets a request ID and lifecycle timestamps. The sink is
 * an append-only JSONL file under `<workspace>/.singularity/traces/` (or
 * `SINGULARITY_TRACE_DIR`). No prompt content, API keys, or repository secrets
 * are recorded — only timings, token counts, model IDs, and short hashes.
 *
 * Enabled by default in dev; disable with SINGULARITY_TRACE=0.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export type TracePhase =
  | 'request_received'
  | 'context_started'
  | 'context_finished'
  | 'routing_started'
  | 'routing_finished'
  | 'planning_started'
  | 'planning_finished'
  | 'model_request_started'
  | 'first_token_received'
  | 'streaming_started'
  | 'tool_started'
  | 'tool_finished'
  | 'verification_started'
  | 'verification_finished'
  | 'request_finished';

/** All phases from the perf spec, in canonical order. */
export const TRACE_PHASES: readonly TracePhase[] = [
  'request_received',
  'context_started',
  'context_finished',
  'routing_started',
  'routing_finished',
  'planning_started',
  'planning_finished',
  'model_request_started',
  'first_token_received',
  'streaming_started',
  'tool_started',
  'tool_finished',
  'verification_started',
  'verification_finished',
  'request_finished',
];

export interface TracePhaseRecord {
  phase: TracePhase;
  ts: number;
}

export interface RequestTraceMetrics {
  /** ms from request_received to first_token_received. */
  ttftMs?: number;
  /** ms from model_request_started to request_finished. */
  modelGenerationMs?: number;
  /** ms from request_received to request_finished. */
  totalRequestMs?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  tokensReceived?: number;
  tokensForwarded?: number;
  /** completionTokens / (first_token → finish) seconds. */
  modelTps?: number;
  /** tokensForwarded / total wall seconds. */
  effectiveTps?: number;
  contextLatencyMs?: number;
  routingLatencyMs?: number;
  planningLatencyMs?: number;
  toolLatencyMs?: number;
  verificationLatencyMs?: number;
  /** total minus model generation time — orchestration overhead. */
  nonModelLatencyMs?: number;
}

export interface RequestTraceRecord extends RequestTraceMetrics {
  requestId: string;
  sessionId?: string;
  source?: string;
  modelId?: string;
  tier?: string;
  intent?: string;
  fromCache?: boolean;
  ok?: boolean;
  error?: string;
  promptHash?: string;
  /** True when the request ran the single-call fast lane (Step 8). */
  fastPath?: boolean;
  phases: TracePhaseRecord[];
  createdAt: number;
}

const MAX_ACTIVE_TRACES = 64;

class RequestTracer {
  private active = new Map<string, RequestTraceRecord>();
  private order: string[] = [];
  private traceDir: string | undefined;
  private enabled: boolean;

  constructor() {
    this.enabled = process.env.SINGULARITY_TRACE !== '0';
    if (process.env.SINGULARITY_TRACE === '1') {
      this.enabled = true;
    }
    const dir = process.env.SINGULARITY_TRACE_DIR;
    if (dir) {
      this.setTraceDir(dir);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setTraceDir(dir: string): void {
    try {
      mkdirSync(dir, { recursive: true });
      this.traceDir = dir;
    } catch {
      /* tracing must never break the request path */
    }
  }

  begin(opts?: {
    requestId?: string;
    sessionId?: string;
    source?: string;
    promptHash?: string;
  }): string {
    if (!this.enabled) {
      return opts?.requestId ?? '';
    }
    const requestId = opts?.requestId ?? `req-${randomUUID().slice(0, 8)}`;
    const record: RequestTraceRecord = {
      requestId,
      sessionId: opts?.sessionId,
      source: opts?.source,
      promptHash: opts?.promptHash,
      phases: [{ phase: 'request_received', ts: Date.now() }],
      createdAt: Date.now(),
    };
    this.active.set(requestId, record);
    this.order.push(requestId);
    while (this.order.length > MAX_ACTIVE_TRACES) {
      const evict = this.order.shift();
      if (evict) {
        this.active.delete(evict);
      }
    }
    return requestId;
  }

  mark(requestId: string, phase: TracePhase): void {
    if (!this.enabled || !requestId) {
      return;
    }
    const rec = this.active.get(requestId);
    if (!rec) {
      return;
    }
    // First occurrence wins for first_token_received; last wins elsewhere.
    const existing = rec.phases.find((p) => p.phase === phase);
    if (phase === 'first_token_received' && existing) {
      return;
    }
    if (existing) {
      existing.ts = Date.now();
    } else {
      rec.phases.push({ phase, ts: Date.now() });
    }
  }

  setMeta(
    requestId: string,
    meta: Partial<
      Pick<
        RequestTraceRecord,
        | 'sessionId'
        | 'source'
        | 'modelId'
        | 'tier'
        | 'intent'
        | 'fromCache'
        | 'ok'
        | 'error'
        | 'promptHash'
        | 'fastPath'
      >
    >,
  ): void {
    if (!this.enabled || !requestId) {
      return;
    }
    const rec = this.active.get(requestId);
    if (!rec) {
      return;
    }
    Object.assign(rec, meta);
  }

  addUsage(
    requestId: string,
    usage: { completionTokens?: number; reasoningTokens?: number },
  ): void {
    if (!this.enabled || !requestId) {
      return;
    }
    const rec = this.active.get(requestId);
    if (!rec) {
      return;
    }
    if (usage.completionTokens !== undefined) {
      rec.completionTokens = usage.completionTokens;
    }
    if (usage.reasoningTokens !== undefined) {
      rec.reasoningTokens = usage.reasoningTokens;
    }
  }

  setTokenFlow(requestId: string, tokensReceived: number, tokensForwarded: number): void {
    if (!this.enabled || !requestId) {
      return;
    }
    const rec = this.active.get(requestId);
    if (!rec) {
      return;
    }
    rec.tokensReceived = tokensReceived;
    rec.tokensForwarded = tokensForwarded;
  }

  finish(requestId: string, outcome?: { ok?: boolean; error?: string }): void {
    if (!this.enabled || !requestId) {
      return;
    }
    const rec = this.active.get(requestId);
    if (!rec) {
      return;
    }
    this.mark(requestId, 'request_finished');
    if (outcome?.ok !== undefined) {
      rec.ok = outcome.ok;
    }
    if (outcome?.error) {
      rec.error = outcome.error.slice(0, 300);
    }
    this.active.delete(requestId);
    this.write(rec);
  }

  /** Snapshot without finishing (for long-running runs that stream progress). */
  snapshot(requestId: string): RequestTraceRecord | undefined {
    return this.active.get(requestId);
  }

  private write(rec: RequestTraceRecord): void {
    if (!this.traceDir) {
      return;
    }
    try {
      appendFileSync(
        join(this.traceDir, 'requests.jsonl'),
        `${JSON.stringify(computeMetrics(rec))}\n`,
      );
    } catch {
      /* never break the request path on trace IO errors */
    }
  }
}

function tsOf(rec: RequestTraceRecord, phase: TracePhase): number | undefined {
  return rec.phases.find((p) => p.phase === phase)?.ts;
}

function spanOf(
  rec: RequestTraceRecord,
  start: TracePhase,
  end: TracePhase,
): number | undefined {
  const s = tsOf(rec, start);
  const e = tsOf(rec, end);
  if (s === undefined || e === undefined) {
    return undefined;
  }
  return Math.max(0, e - s);
}

export function computeMetrics(rec: RequestTraceRecord): RequestTraceRecord {
  const out: RequestTraceRecord = { ...rec };
  const received = tsOf(rec, 'request_received');
  const finished = tsOf(rec, 'request_finished');
  const firstToken = tsOf(rec, 'first_token_received');
  const modelStart = tsOf(rec, 'model_request_started');

  if (received !== undefined && finished !== undefined) {
    out.totalRequestMs = Math.max(0, finished - received);
  }
  if (firstToken !== undefined && received !== undefined) {
    out.ttftMs = Math.max(0, firstToken - received);
  }
  if (modelStart !== undefined && finished !== undefined) {
    out.modelGenerationMs = Math.max(0, finished - modelStart);
  }
  out.contextLatencyMs = spanOf(rec, 'context_started', 'context_finished');
  out.routingLatencyMs = spanOf(rec, 'routing_started', 'routing_finished');
  out.planningLatencyMs = spanOf(rec, 'planning_started', 'planning_finished');
  out.toolLatencyMs = spanOf(rec, 'tool_started', 'tool_finished');
  out.verificationLatencyMs = spanOf(
    rec,
    'verification_started',
    'verification_finished',
  );

  const tokens = rec.completionTokens ?? estimateTokensFromPhases(rec);
  out.completionTokens = rec.completionTokens ?? (tokens > 0 ? tokens : undefined);

  if (
    firstToken !== undefined &&
    finished !== undefined &&
    out.completionTokens
  ) {
    const sec = Math.max(0.001, (finished - firstToken) / 1000);
    out.modelTps = out.completionTokens / sec;
  }
  if (out.tokensForwarded !== undefined && out.totalRequestMs !== undefined) {
    out.effectiveTps =
      out.tokensForwarded / (Math.max(1, out.totalRequestMs) / 1000);
  }
  if (out.modelGenerationMs !== undefined && out.ttftMs !== undefined) {
    out.nonModelLatencyMs = Math.max(
      0,
      (out.totalRequestMs ?? 0) -
        Math.max(out.modelGenerationMs, out.ttftMs),
    );
  }
  return out;
}

/**
 * Fallback completion-token estimate when the provider does not report usage:
 * rough char-length proxy is unavailable here, so we only report when known.
 */
function estimateTokensFromPhases(_rec: RequestTraceRecord): number {
  return 0;
}

export function hashPromptForTrace(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 12);
}

/** Process-wide tracer singleton. */
export const requestTracer = new RequestTracer();

export { RequestTracer };

/** Convenience: begin a trace and return a scoped helper. */
export function startTrace(opts?: {
  requestId?: string;
  sessionId?: string;
  source?: string;
  promptHash?: string;
}): {
  requestId: string;
  mark: (phase: TracePhase) => void;
  setMeta: typeof requestTracer.setMeta extends (id: string, m: infer M) => void ? (m: M) => void : never;
  addUsage: (usage: { completionTokens?: number; reasoningTokens?: number }) => void;
  setTokenFlow: (tokensReceived: number, tokensForwarded: number) => void;
  finish: (outcome?: { ok?: boolean; error?: string }) => void;
} {
  const requestId = requestTracer.begin(opts);
  return {
    requestId,
    mark: (phase) => requestTracer.mark(requestId, phase),
    setMeta: (meta) => requestTracer.setMeta(requestId, meta),
    addUsage: (usage) => requestTracer.addUsage(requestId, usage),
    setTokenFlow: (r, f) => requestTracer.setTokenFlow(requestId, r, f),
    finish: (outcome) => requestTracer.finish(requestId, outcome),
  };
}
