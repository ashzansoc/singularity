import { describe, expect, it, vi } from 'vitest';
import { createLlmDecisionEngine } from '../src/llmDecision.js';

describe('LlmDecisionEngine', () => {
  it('instantly routes greetings without network', async () => {
    const engine = createLlmDecisionEngine({ apiKey: 'test', timeoutMs: 50 });
    const d = await engine.decide({ prompt: 'hello' });
    expect(d.source).toBe('rules');
    expect(d.modelId).toBe('deepseek/deepseek-v4-flash-0731');
    expect(d.latencyMs).toBe(0);
    expect(d.subTier).toBe('T0.1');
  });

  it('falls back within timeout when fetch hangs', async () => {
    const fetchMock = vi.fn(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    const engine = createLlmDecisionEngine({
      apiKey: 'test',
      timeoutMs: 80,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const started = Date.now();
    const d = await engine.decide({ prompt: 'refactor the auth module carefully' });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(500);
    expect(d.source === 'timeout' || d.source === 'error' || d.source === 'rules').toBe(true);
    expect(d.modelId.length).toBeGreaterThan(0);
  });

  it('parses LLM JSON when fetch succeeds', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"tier":"T3","subTier":"T3.1","modelId":"deepseek/deepseek-v4-pro-0813","intent":"DEBUG","confidence":0.9,"reason":"bug"}',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const engine = createLlmDecisionEngine({
      apiKey: 'test',
      timeoutMs: 1000,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const d = await engine.decide({ prompt: 'fix the null pointer bug in parser' });
    expect(d.source).toBe('llm');
    expect(d.modelId).toBe('deepseek/deepseek-v4-pro-0813');
    expect(d.tier).toBe('T3');
  });
});
