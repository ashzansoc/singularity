import { describe, expect, it } from 'vitest';
import { createSingularityAI } from '../src/runtime.js';

process.env.SINGULARITY_NEMOTRON_ROUTER = '0';

describe('prompt pipeline integration', () => {
  it('compiles Prompt IR when messages are omitted', async () => {
    const ai = createSingularityAI({
      workspaceId: 'test-ws',
      adapter: { localEcho: true },
      promptBudgetTokens: 4000,
    });

    const result = await ai.complete({
      prompt: 'Explain this selection',
      mode: 'chat',
      cacheable: false,
      temperature: 0,
      modelId: 'local/qwen-coder-7b',
      builderUpdate: {
        intent: 'DEBUG',
        selection: {
          uri: 'file:///a.ts',
          text: 'const x = 1;',
          startLine: 1,
          endLine: 1,
        },
        currentFileUri: 'file:///a.ts',
        files: [
          {
            uri: 'file:///a.ts',
            content: 'const x = 1;\nconsole.log(x);',
            version: 1,
            languageId: 'typescript',
          },
        ],
        diagnostics: [
          {
            uri: 'file:///a.ts',
            severity: 'error',
            message: 'unused',
            line: 1,
          },
        ],
        terminal: [{ output: 'Error: boom', command: 'npm test' }],
      },
    });

    expect(result.fromCache).toBe(false);
    expect(result.prompt).toBeDefined();
    expect(result.prompt!.irHash.length).toBeGreaterThan(4);
    expect(result.prompt!.totalTokens).toBeGreaterThan(0);
    expect(result.prompt!.rendered.messages.some((m) => m.role === 'user')).toBe(true);
    expect(result.result.choices[0]?.message.content).toBeTruthy();
  });

  it('reuses local IR cache on identical compile', async () => {
    const ai = createSingularityAI({
      workspaceId: 'test-ws-2',
      adapter: { localEcho: true },
    });

    const req = {
      prompt: 'hello world',
      mode: 'chat' as const,
      cacheable: false,
      temperature: 0,
      modelId: 'local/qwen-coder-7b',
      sessionId: 'sess-ir',
      builderUpdate: { intent: 'GENERAL' as const },
    };

    const first = await ai.complete(req);
    ai.cache.responseCache.clear();
    ai.cache.semanticCache.clear();

    const second = await ai.complete(req);
    expect(first.prompt?.irHash).toBe(second.prompt?.irHash);
    expect(second.prompt?.fromIrCache).toBe(true);
  });
});
