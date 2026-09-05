import { describe, expect, it } from 'vitest';
import { createSingularityAI } from '../src/runtime.js';

process.env.SINGULARITY_NEMOTRON_ROUTER = '0';

describe('SingularityAI', () => {
  it('completes via local model and serves L4 cache on repeat', async () => {
    const ai = createSingularityAI({
      workspaceId: 'test-ws',
      adapter: { localEcho: true },
    });

    const req = {
      prompt: 'Explain what a mutex is in one sentence',
      mode: 'chat' as const,
      cacheable: true,
      temperature: 0,
      modelId: 'local/qwen-coder-7b',
    };

    const first = await ai.complete(req);
    expect(first.fromCache).toBe(false);
    expect(first.result.choices[0]?.message.content).toBeTruthy();
    expect(first.decision.model.provider).toBe('local');
    expect(first.prefixHints.promptCacheKey || first.prefixHints.cacheControl).toBeTruthy();

    const second = await ai.complete(req);
    expect(second.fromCache).toBe(true);
    expect(second.cacheLayer).toBe('L4');
    expect(second.result.choices[0]?.message.content).toBe(
      first.result.choices[0]?.message.content,
    );

    const snap = ai.status();
    expect(snap.cacheMetrics.layers.L4?.hits).toBeGreaterThanOrEqual(1);
  });

  it('exposes status with catalog size', () => {
    const ai = createSingularityAI({ workspaceId: 'ws' });
    expect(ai.status().catalogSize).toBeGreaterThan(0);
  });

  it('completeStream honors a forced modelId (regression: routed model was used)', async () => {
    const ai = createSingularityAI({
      workspaceId: 'test-ws',
      adapter: { localEcho: true },
    });

    const requested = 'local/qwen-coder-7b';
    const seen: Array<{ delta?: string; modelId?: string; done?: boolean }> = [];
    for await (const ev of ai.completeStream({
      prompt: 'Explain what a mutex is',
      mode: 'chat',
      temperature: 0,
      sessionId: 'forced-model-stream',
      modelId: requested,
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Explain what a mutex is' },
      ],
      skipPromptPipeline: true,
      maxTokens: 40,
    })) {
      seen.push(ev);
    }

    // Every emitted event that carries a modelId must be the forced one.
    const emittedModels = seen.map((s) => s.modelId).filter(Boolean);
    expect(emittedModels.length).toBeGreaterThan(0);
    for (const m of emittedModels) {
      expect(m).toBe(requested);
    }
    expect(seen.some((s) => s.delta)).toBe(true);
    expect(seen.some((s) => s.done)).toBe(true);
  });
});
