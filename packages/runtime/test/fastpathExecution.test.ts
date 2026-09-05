import { describe, expect, it } from 'vitest';
import { createRuntimeEngine } from '../src/runtime.js';
import { InMemoryWorkspace, InMemoryEditPort } from '../src/ports.js';
import type { LlmCompleteRequest, LlmCompleteResult, LlmPort, LlmStreamDelta } from '../src/ports.js';

/** LLM stub that streams one JSON diff and counts every call. */
function countingLlm(response: string): { llm: LlmPort; count(): number; calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  const bump = (role: string) => {
    calls.push(role);
    n += 1;
  };
  const llm: LlmPort = {
    async complete(req: LlmCompleteRequest): Promise<LlmCompleteResult> {
      bump(req.role);
      return { text: response, modelId: 'test-model', tokensUsed: 10 };
    },
    async *completeStream(req: LlmCompleteRequest): AsyncIterable<LlmStreamDelta> {
      bump(req.role);
      yield { delta: response, modelId: 'test-model' };
      yield { done: true, tokensUsed: 10 };
    },
  };
  return { llm, count: () => n, calls };
}

const TYPED_DIFF = JSON.stringify({
  summary: 'renamed',
  diffs: [{ path: 'src/a.ts', newContent: 'const b = 1;' }],
});

describe('Phase 13 fast-path execution guarantees', () => {
  it('FAST goal = exactly ONE llm call, no planner/worker/integrator/verifier', async () => {
    const { llm, count, calls } = countingLlm(TYPED_DIFF);
    const engine = createRuntimeEngine({
      llm,
      workspace: new InMemoryWorkspace({ 'src/a.ts': 'const a = 1;' }),
      edit: new InMemoryEditPort(new InMemoryWorkspace({ 'src/a.ts': 'const a = 1;' })),
      enableVerification: true,
      enableSubagentLoop: true,
    });
    const result = await engine.run({ goal: 'in src/a.ts rename a to b' });
    expect(result.fastPath).toBe(true);
    expect(result.ok).toBe(true);
    expect(count()).toBe(1);
    expect(calls[0]).toBe('worker');
  });

  it('fast-path stream emits incremental deltas before finishing', async () => {
    const { llm } = countingLlm(TYPED_DIFF);
    const deltas: string[] = [];
    const engine = createRuntimeEngine({
      llm,
      workspace: new InMemoryWorkspace({ 'src/a.ts': 'const a = 1;' }),
      edit: new InMemoryEditPort(new InMemoryWorkspace({ 'src/a.ts': 'const a = 1;' })),
      onEvent: (ev) => {
        if (ev.kind === 'subagent_progress_delta') {
          deltas.push(String((ev.data as { lane?: string })?.lane));
        }
      },
    });
    await engine.run({ goal: 'Fix this typo in utils file src/a.ts' });
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((l) => l === 'fastpath')).toBe(true);
  });

  it('DEEP goal still runs full planning + verification', async () => {
    const planJson = JSON.stringify({
      projectSummary: 'demo',
      nodes: [
        {
          id: 'impl',
          title: 'implement',
          role: 'backend',
          objective: 'do the thing',
          deps: [],
          ownedPaths: ['src/x.ts'],
          expectedOutput: 'diff',
          estimatedTokens: 100,
          recommendedTier: 'T2',
        },
      ],
    });
    const { llm, calls } = countingLlm(planJson);
    const engine = createRuntimeEngine({
      llm,
      workspace: new InMemoryWorkspace({ 'src/x.ts': 'export const x = 1;' }),
      edit: new InMemoryEditPort(new InMemoryWorkspace({})),
      enableVerification: true,
    });
    const result = await engine.run({
      goal: 'Migrate the database schema for the users table',
      maxConcurrentSubagents: 2,
    });
    expect(result.fastPath ?? false).toBe(false);
    // planner + worker at minimum
    expect(calls).toContain('planner');
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
});
