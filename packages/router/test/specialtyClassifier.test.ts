import { describe, expect, it, vi } from 'vitest';
import { createRoutingEngine } from '../src/engine.js';
import { FRONTEND_OWNER_MODEL_ID } from '../src/specialty.js';
import { classifySpecialty, parseSpecialtyContent } from '../src/specialtyClassifier.js';

process.env.SINGULARITY_NEMOTRON_ROUTER = '0';

describe('Nemotron specialty classifier', () => {
  it('parses frontend specialty from LLM JSON', () => {
    const parsed = parseSpecialtyContent(
      '{"specialty":"frontend","confidence":0.93,"reason":"polish landing page","modelId":"deepseek/deepseek-v4-pro"}',
    );
    expect(parsed.specialty).toBe('frontend');
    expect(parsed.modelId).toBe(FRONTEND_OWNER_MODEL_ID);
  });

  it('uses Nemotron response when fetch succeeds', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"specialty":"frontend","confidence":0.91,"reason":"visual polish without saying react"}',
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await classifySpecialty('Make the landing page feel less cluttered and more premium', {
      config: {
        apiKey: 'test-key',
        fetch: fetchMock as unknown as typeof fetch,
        timeoutMs: 2000,
      },
    });

    expect(result.source).toBe('llm');
    expect(result.specialty).toBe('frontend');
    expect(result.modelId).toBe(FRONTEND_OWNER_MODEL_ID);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('falls back to keywords when Nemotron times out', async () => {
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>(() => {
          /* never resolves */
        }),
    );

    const result = await classifySpecialty('Build a React dashboard UI with Tailwind', {
      config: {
        apiKey: 'test-key',
        fetch: fetchMock as unknown as typeof fetch,
        timeoutMs: 30,
      },
    });

    expect(result.source).toBe('timeout');
    expect(result.specialty).toBe('frontend');
  });

  it('routeAsync pins Qwen when Nemotron says frontend', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"specialty":"frontend","confidence":0.95,"reason":"ui work"}',
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const engine = createRoutingEngine({
      specialtyClassifier: {
        apiKey: 'test-key',
        fetch: fetchMock as unknown as typeof fetch,
        timeoutMs: 2000,
      },
    });

    const decision = await engine.routeAsync({
      prompt: 'Make this screen feel calmer and more premium',
      mode: 'agent',
    });

    expect(decision.specialty).toBe('frontend');
    expect(decision.model.id).toBe(FRONTEND_OWNER_MODEL_ID);
  });
});
