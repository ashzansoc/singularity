import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RequestTracer,
  computeMetrics,
  hashPromptForTrace,
} from '../src/telemetry/requestTrace.js';

describe('RequestTracer', () => {
  let traceDir: string;
  let tracer: RequestTracer;

  beforeEach(() => {
    traceDir = mkdtempSync(join(tmpdir(), 'sing-trace-'));
    tracer = new RequestTracer();
    tracer.setEnabled(true);
    tracer.setTraceDir(traceDir);
  });

  afterEach(() => {
    tracer.setEnabled(process.env.SINGULARITY_TRACE !== '0');
  });

  it('writes a JSONL record with derived metrics on finish', () => {
    const id = tracer.begin({ source: 'test' });
    tracer.mark(id, 'routing_started');
    tracer.mark(id, 'routing_finished');
    tracer.mark(id, 'model_request_started');
    tracer.mark(id, 'first_token_received');
    tracer.addUsage(id, { completionTokens: 100 });
    tracer.setTokenFlow(id, 100, 90);
    tracer.finish(id, { ok: true });

    const file = join(traceDir, 'requests.jsonl');
    expect(existsSync(file)).toBe(true);
    const rec = JSON.parse(readFileSync(file, 'utf8')) as {
      requestId: string;
      ok: boolean;
      ttftMs?: number;
      totalRequestMs?: number;
      completionTokens?: number;
      modelTps?: number;
      effectiveTps?: number;
      routingLatencyMs?: number;
      phases: Array<{ phase: string; ts: number }>;
    };
    expect(rec.ok).toBe(true);
    expect(rec.completionTokens).toBe(100);
    expect(rec.totalRequestMs).toBeGreaterThanOrEqual(0);
    expect(rec.ttftMs).toBeGreaterThanOrEqual(0);
    expect(rec.modelTps).toBeGreaterThan(0);
    expect(rec.effectiveTps).toBeGreaterThan(0);
    expect(rec.routingLatencyMs).toBeGreaterThanOrEqual(0);
    expect(rec.phases.some((p) => p.phase === 'request_finished')).toBe(true);
  });

  it('keeps the first first_token_received timestamp', () => {
    const id = tracer.begin({});
    tracer.mark(id, 'first_token_received');
    const first = tracer.snapshot(id)!.phases.find((p) => p.phase === 'first_token_received')!.ts;
    tracer.mark(id, 'first_token_received');
    const again = tracer.snapshot(id)!.phases.find((p) => p.phase === 'first_token_received')!.ts;
    expect(again).toBe(first);
  });

  it('no-ops safely when disabled', () => {
    tracer.setEnabled(false);
    const id = tracer.begin({});
    tracer.mark(id, 'routing_started');
    tracer.finish(id, { ok: true });
    expect(existsSync(join(traceDir, 'requests.jsonl'))).toBe(false);
  });

  it('evicts beyond the active ring and still finishes old traces gracefully', () => {
    const first = tracer.begin({});
    for (let i = 0; i < 100; i++) {
      tracer.begin({});
    }
    // first was evicted; mark/finish must not throw
    tracer.mark(first, 'request_finished');
    tracer.finish(first, { ok: true });
    expect(existsSync(join(traceDir, 'requests.jsonl'))).toBe(false);
  });

  it('computeMetrics derives nonModelLatencyMs and handles missing phases', () => {
    const now = Date.now();
    const rec = computeMetrics({
      requestId: 'x',
      phases: [
        { phase: 'request_received', ts: now },
        { phase: 'model_request_started', ts: now + 50 },
        { phase: 'first_token_received', ts: now + 150 },
        { phase: 'request_finished', ts: now + 450 },
      ],
      completionTokens: 300,
      tokensForwarded: 300,
      createdAt: now,
    });
    expect(rec.ttftMs).toBe(150);
    expect(rec.modelGenerationMs).toBe(400);
    expect(rec.totalRequestMs).toBe(450);
    expect(rec.nonModelLatencyMs).toBe(50);
    expect(rec.modelTps).toBeCloseTo(300 / 0.3, 0);
    expect(rec.effectiveTps).toBeCloseTo(300 / 0.45, 0);
  });

  it('hashPromptForTrace is stable and short', () => {
    expect(hashPromptForTrace('hello')).toBe(hashPromptForTrace('hello'));
    expect(hashPromptForTrace('hello')).not.toBe(hashPromptForTrace('world'));
    expect(hashPromptForTrace('hello')).toHaveLength(12);
  });
});
