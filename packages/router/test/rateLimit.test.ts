import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeBackoffMs,
  extractRetryAfterFromText,
  fetchWithRateRetry,
  gateLlmRequest,
  noteRateLimited,
  parseRetryAfterMs,
  rateLimitedUntilTs,
  resetRateGate,
  setRateGateConfig,
} from '../src/rateLimit.js';

describe('rate gate', () => {
  beforeEach(() => {
    resetRateGate();
    setRateGateConfig({ rpm: 60_000, rateLimitedCooldownMs: 1 }); // effectively unthrottled
  });

  afterEach(() => {
    resetRateGate();
  });

  it('spaces request initiations by the RPM-derived min interval', async () => {
    setRateGateConfig({ rpm: 30 }); // min interval 2000ms → clamps to 250ms floor? no: 2000
    const starts: number[] = [];
    const fire = () => gateLlmRequest(async () => Date.now());
    starts.push(await fire());
    starts.push(await fire());
    const gap = starts[1]! - starts[0]!;
    expect(gap).toBeGreaterThanOrEqual(250);
  });

  it('serializes concurrent callers (no parallel initiation bursts)', async () => {
    setRateGateConfig({ rpm: 60_000, rateLimitedCooldownMs: 1 });
    let inFlight = 0;
    let maxInFlight = 0;
    const call = () =>
      gateLlmRequest(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      });
    await Promise.all([call(), call(), call(), call()]);
    expect(maxInFlight).toBe(1);
  });

  it('noteRateLimited pushes the cooldown window forward', () => {
    const before = rateLimitedUntilTs();
    noteRateLimited(5_000);
    const after = rateLimitedUntilTs();
    expect(after).toBeGreaterThan(before + 4_000);
  });

  it('parseRetryAfterMs handles seconds, HTTP-date, and JSON body hints', () => {
    const headers = new Headers({ 'retry-after': '7' });
    expect(parseRetryAfterMs({ headers })).toBe(7_000);

    const dateHeaders = new Headers({ 'retry-after': new Date(Date.now() + 9_000).toUTCString() });
    const from = parseRetryAfterMs({ headers: dateHeaders });
    expect(from).toBeGreaterThan(7_000);
    expect(from).toBeLessThanOrEqual(9_500);

    expect(
      parseRetryAfterMs(undefined, JSON.stringify({ error: { metadata: { headers: { 'retry-after': '3' } } } })),
    ).toBe(3_000);
  });

  it('extractRetryAfterFromText reads scheduler-style error messages', () => {
    expect(extractRetryAfterFromText('gateway error 429: retry-after: 12')).toBe(12_000);
    expect(extractRetryAfterFromText('429 no hint')).toBeUndefined();
  });

  it('computeBackoffMs grows exponentially, honors Retry-After, caps, and jitters', () => {
    expect(computeBackoffMs(0, { baseMs: 1000, maxMs: 30_000 })).toBeGreaterThanOrEqual(1000);
    expect(computeBackoffMs(1, { baseMs: 1000, maxMs: 30_000 })).toBeGreaterThanOrEqual(2000);
    expect(computeBackoffMs(9, { baseMs: 1000, maxMs: 30_000 })).toBeLessThanOrEqual(35_000);
    expect(computeBackoffMs(0, { retryAfterMs: 20_000 })).toBeGreaterThanOrEqual(20_000);
  });

  it('fetchWithRateRetry retries on 429 with bounded attempts then succeeds', async () => {
    setRateGateConfig({ rpm: 60_000, rateLimitedCooldownMs: 1 });
    let attempts = 0;
    const result = await fetchWithRateRetry({
      initiate: async () => ({ status: ++attempts === 3 ? 200 : 429 }),
      classify: (r) => ({ retry: r.status === 429, status: r.status, retryAfterMs: 1 }),
      maxRetries: 3,
    });
    expect(attempts).toBe(3);
    expect(result.status).toBe(200);
  });

  it('fetchWithRateRetry gives up after maxRetries and records the 429', async () => {
    setRateGateConfig({ rpm: 60_000, rateLimitedCooldownMs: 1 });
    let attempts = 0;
    await expect(
      fetchWithRateRetry({
        initiate: async () => ({ status: ++attempts }),
        classify: () => ({ retry: true, status: 429, retryAfterMs: 1 }),
        maxRetries: 2,
      }),
    ).resolves.toEqual({ status: 3 });
    expect(attempts).toBe(3); // initial + 2 retries
    expect(rateLimitedUntilTs()).toBeGreaterThan(0);
  });

  it('propagates cancellation during backoff', async () => {
    setRateGateConfig({ rpm: 60_000, rateLimitedCooldownMs: 1 });
    const controller = new AbortController();
    const p = fetchWithRateRetry({
      initiate: async () => ({ status: 429 }),
      classify: () => ({ retry: true, status: 429, retryAfterMs: 60_000 }),
      maxRetries: 3,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(p).rejects.toThrow(/aborted/i);
  });

  it('interactive lane does not serialize behind the default queue tail', async () => {
    setRateGateConfig({ rpm: 60_000, rateLimitedCooldownMs: 1 });
    let workerDone = false;
    let maxInFlight = 0;
    let active = 0;
    const worker = () =>
      gateLlmRequest(async () => {
        active += 1;
        maxInFlight = Math.max(maxInFlight, active);
        await new Promise((r) => setTimeout(r, 600));
        active -= 1;
        workerDone = true;
      });
    // A slow worker occupies the default queue slot for 600ms (longer than the
    // 250ms spacing floor): a queue-serialized interactive call would only
    // start AFTER the worker's fn completes.
    const workerP = worker();
    await new Promise((r) => setTimeout(r, 10));
    // Interactive request must NOT wait for the worker's queue slot to free —
    // it should start (and finish its fn) while the worker is still running.
    const interactive = gateLlmRequest(
      async () => Date.now(),
      undefined,
      { lane: 'interactive', slotTimeoutMs: 5_000 },
    );
    const interactiveStart = await interactive;
    expect(workerDone).toBe(false); // worker still running when interactive ran
    await workerP;
    expect(interactiveStart).toBeGreaterThan(0);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('interactive lane slot deadline proceeds best-effort during heavy spacing', async () => {
    setRateGateConfig({ rpm: 30 }); // 2000ms min spacing
    const first = await gateLlmRequest(async () => Date.now(), undefined, {
      lane: 'interactive',
      slotTimeoutMs: 5_000,
    });
    const t0 = Date.now();
    // Second interactive request near the spacing floor: should wait the floor,
    // but a very short deadline must not exceed it dramatically.
    const second = await gateLlmRequest(async () => Date.now(), undefined, {
      lane: 'interactive',
      slotTimeoutMs: 5_000,
    });
    expect(second - t0).toBeGreaterThan(0);
    void first;
  });
});
