import { describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider } from '../src/providers/openrouter.js';
import { LocalProvider } from '../src/providers/local.js';
import { DirectProvider } from '../src/providers/direct.js';
import { ProviderError } from '../src/providers/types.js';
import { ModelAdapter } from '../src/providers/adapter.js';
import { DEFAULT_MODEL_CATALOG } from '../src/models/catalog.js';

describe('OpenRouterProvider', () => {
  it('posts to /chat/completions with auth headers', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      // Provider default base URL (OPENROUTER_DEFAULT_BASE_URL) is openrouter.ai/api/v1;
      // the explicit-baseUrl override case is covered by the "respects an explicit
      // baseUrl override" test below.
      expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-key');
      expect(headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('deepseek/deepseek-v4');
      expect(body.messages).toHaveLength(1);

      return new Response(
        JSON.stringify({
          id: 'gen-1',
          model: 'deepseek/deepseek-v4',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const provider = new OpenRouterProvider({
      apiKey: 'test-key',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await provider.chatCompletions({
      model: 'deepseek/deepseek-v4',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      maxTokens: 100,
    });

    expect(result.choices[0]!.message.content).toBe('ok');
    expect(result.usage?.totalTokens).toBe(12);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('respects an explicit baseUrl override', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://openrouter.ai/api/v1/chat/completions');
      return new Response(
        JSON.stringify({
          id: 'gen-2',
          model: 'x',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200 },
      );
    });

    const provider = new OpenRouterProvider({
      apiKey: 'test-key',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await provider.chatCompletions({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('forwards response_format json_schema', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: { name: 'ctx', schema: { type: 'object' } },
      });
      return new Response(
        JSON.stringify({
          id: 'gen-3',
          model: 'x',
          choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
        }),
        { status: 200 },
      );
    });

    const provider = new OpenRouterProvider({
      apiKey: 'test-key',
      fetch: fetchMock as unknown as typeof fetch,
    });

    await provider.chatCompletions({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: {
        type: 'json_schema',
        json_schema: { name: 'ctx', schema: { type: 'object' } },
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('throws when API key is missing', async () => {
    const provider = new OpenRouterProvider({ apiKey: '' });
    await expect(
      provider.chatCompletions({
        model: 'x',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('LocalProvider / DirectProvider', () => {
  it('echoes when configured', async () => {
    const local = new LocalProvider({ echo: true });
    const result = await local.chatCompletions({
      model: 'local/qwen-coder-7b',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(result.choices[0]!.message.content).toContain('ping');
  });

  it('direct provider throws not implemented', async () => {
    const direct = new DirectProvider('anthropic');
    await expect(
      direct.chatCompletions({
        model: 'claude',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow(/not implemented/);
  });
});

describe('ModelAdapter', () => {
  it('routes local models to LocalProvider', async () => {
    const adapter = new ModelAdapter({ localEcho: true });
    const localModel = DEFAULT_MODEL_CATALOG.find((m) => m.provider === 'local')!;
    const result = await adapter.complete(localModel, {
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.choices[0]!.message.content).toContain('hello');
  });
});
