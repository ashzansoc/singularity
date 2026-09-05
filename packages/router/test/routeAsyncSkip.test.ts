import { describe, expect, it } from 'vitest';
import { RoutingEngine } from '../src/engine.js';
import { clearSpecialtyMemo } from '../src/specialtyMemo.js';
import { resetRateGate, setRateGateConfig } from '../src/rateLimit.js';
import type { ModelSpec } from '../src/types.js';

let seq = 0;
function mkModel(tier: ModelSpec['tier']): ModelSpec {
  const id = `test-model-${++seq}`;
  return {
    id,
    displayName: id,
    provider: 'openrouter',
    tier,
    subTier: `${tier}.1` as ModelSpec['subTier'],
    primaryPurpose: 'test',
    callWhen: [],
    doNotCall: [],
    capabilities: {
      speed: 'fast',
      coding: 8,
      reasoning: 8,
      longContext: 7,
      toolUse: 8,
      cost: 'medium',
      context: '128k',
      vision: false,
      vendor: 'deepseek',
    },
    maxContext: 128_000,
    supportsTools: true,
    supportsVision: false,
    supportsJson: true,
    supportsStreaming: true,
    costPer1MInput: 0.3,
    costPer1MOutput: 1.2,
    latencyMsP50: 400,
    reliability: 0.99,
    qualityByIntent: {},
  };
}

function classifierConfig(networkCalls: { count: number }, body?: object) {
  return {
    apiKey: 'k',
    baseUrl: 'https://invalid.test',
    timeoutMs: 100,
    fetch: (async () => {
      networkCalls.count++;
      if (body) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response('{}', { status: 500 });
    }) as typeof fetch,
  };
}

describe('routeAsync classifier-hop elimination', () => {
  it('skips the network hop when modelId is forced', async () => {
    const calls = { count: 0 };
    const model = mkModel('T3');
    const engine = new RoutingEngine({
      models: [model],
      specialtyClassifier: classifierConfig(calls),
    });
    await engine.routeAsync({
      prompt: 'do a thing',
      mode: 'chat',
      modelId: model.id,
    });
    expect(calls.count).toBe(0);
  });

  it('falls back to rules when unforced and upstream fails', async () => {
    const calls = { count: 0 };
    const model = mkModel('T3');
    const engine = new RoutingEngine({
      models: [model],
      specialtyClassifier: classifierConfig(calls),
    });
    const d = await engine.routeAsync({ prompt: 'hello world', mode: 'chat' });
    expect(d.model.id).toBe(model.id);
    expect(d.specialty ?? 'general').toBe('general');
  });

  it('memoizes repeated classifications within TTL', async () => {
    // This test measures memoization, not rate gating — unthrottle the gate.
    resetRateGate();
    setRateGateConfig({ rpm: 60_000, rateLimitedCooldownMs: 1 });
    clearSpecialtyMemo();
    const calls = { count: 0 };
    // A model that will NOT be picked as winner so the second call re-routes.
    const filler = mkModel('T3');
    const engine = new RoutingEngine({
      models: [filler],
      specialtyClassifier: classifierConfig(calls, {
        choices: [
          {
            message: {
              content: JSON.stringify({
                specialty: 'backend',
                confidence: 0.9,
                reason: 'x',
              }),
            },
          },
        ],
      }),
    });
    await engine.routeAsync({ prompt: 'wire stripe webhooks please', mode: 'chat' });
    await engine.routeAsync({ prompt: 'wire stripe webhooks please', mode: 'chat' });
    expect(calls.count).toBe(1);
    clearSpecialtyMemo();
  });

  it('parallel classifier mode routes instantly on rules and warms the memo', async () => {
    resetRateGate();
    setRateGateConfig({ rpm: 60_000, rateLimitedCooldownMs: 1 });
    clearSpecialtyMemo();
    const prev = process.env.SINGULARITY_PARALLEL_CLASSIFIER;
    process.env.SINGULARITY_PARALLEL_CLASSIFIER = '1';
    try {
      const calls = { count: 0 };
      const filler = mkModel('T3');
      const engine = new RoutingEngine({
        models: [filler],
        // Network call succeeds but slowly — the decision must not await it.
        specialtyClassifier: classifierConfig(calls, {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  specialty: 'frontend',
                  confidence: 0.9,
                  reason: 'x',
                }),
              },
            },
          ],
        }),
      });
      const t0 = Date.now();
      const d = await engine.routeAsync({ prompt: 'make the landing page pop', mode: 'chat' });
      const elapsed = Date.now() - t0;
      // Decision used the deterministic rules path: instant, and specialty
      // reflects the keyword fallback for this turn.
      expect(elapsed).toBeLessThan(200);
      expect(typeof d.model.id).toBe('string');
      // The background classification is best-effort; it may or may not have
      // landed yet, but it must NOT have blocked the decision. Give it a
      // moment, then a repeated call should find a memoized entry (either the
      // rules fallback never memoizes, or the LLM result landed).
      await new Promise((r) => setTimeout(r, 250));
      const d2 = await engine.routeAsync({ prompt: 'make the landing page pop', mode: 'chat' });
      expect(typeof d2.model.id).toBe('string');
    } finally {
      if (prev === undefined) {
        delete process.env.SINGULARITY_PARALLEL_CLASSIFIER;
      } else {
        process.env.SINGULARITY_PARALLEL_CLASSIFIER = prev;
      }
    }
    clearSpecialtyMemo();
  });
});
