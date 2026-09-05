import { describe, expect, it } from 'vitest';
import { parseSseDataLine, OpenRouterProvider } from '../src/providers/openrouter.js';

describe('parseSseDataLine', () => {
  it('parses content deltas', () => {
    const ev = parseSseDataLine(
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
    );
    expect(ev?.delta).toBe('Hello');
  });

  it('returns null for [DONE] and non-data lines', () => {
    expect(parseSseDataLine('data: [DONE]')).toBeNull();
    expect(parseSseDataLine(': keepalive')).toBeNull();
    expect(parseSseDataLine('event: ping')).toBeNull();
    expect(parseSseDataLine('')).toBeNull();
  });

  it('extracts reasoning deltas when present', () => {
    const ev = parseSseDataLine(
      'data: {"choices":[{"delta":{"reasoning":"thinking..."}}]}',
    );
    expect(ev?.reasoningDelta).toBe('thinking...');
    expect(ev?.delta).toBeUndefined();
  });

  it('captures usage on final chunks', () => {
    const ev = parseSseDataLine(
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
    );
    expect(ev?.usage?.completionTokens).toBe(5);
    expect(ev?.finishReason ?? null).toBeNull();
  });

  it('tolerates malformed JSON payloads', () => {
    expect(parseSseDataLine('data: {broken json')).toBeNull();
  });
});

describe('OpenRouterProvider.streamChatCompletions (mock fetch)', () => {
  it('yields deltas from an SSE body and falls back gracefully', async () => {
    const sseBody = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const provider = new OpenRouterProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      fetch: (async () =>
        new Response(sseBody, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })) as typeof fetch,
    });

      const deltas: string[] = [];
      let usage;
      for await (const ev of provider.streamChatCompletions({
        model: 'test/model',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        if (ev.delta) {
          deltas.push(ev.delta);
        }
        if (ev.usage) {
          usage = ev.usage;
        }
      }
      expect(deltas.join('')).toBe('Hello');
      expect(usage?.completionTokens).toBe(2);
    });
});
