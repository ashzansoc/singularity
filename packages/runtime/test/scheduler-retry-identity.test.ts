import { describe, expect, it } from 'vitest';
import { ContextBus } from '../src/bus/contextBus.js';
import { createSubagentOrchestrator, runScheduler, type ExecutionPlan, type TaskNode, type LlmPort } from '../src/index.js';
import { InMemoryWorkspace } from '../src/index.js';

describe('scheduler retry identity', () => {
  it('retries the same DAG node after prepareTaskContext (no false cancel)', async () => {
    const node: TaskNode = {
      id: 'main',
      title: 'Implement',
      deps: [],
      ownedPaths: ['src'],
      expectedOutput: 'ok',
      estimatedTokens: 100,
      recommendedTier: 'T2',
      specialty: 'general',
      priority: 1,
      retryLimit: 2,
      status: 'pending',
      attempts: 0,
      role: 'frontend',
      objective: 'Implement',
    };
    const plan: ExecutionPlan = {
      id: 'p',
      goal: 'test',
      projectSummary: 'test',
      nodes: [node],
      estimates: { totalTokens: 100, taskCount: 1, criticalPathLength: 1 },
      createdAt: Date.now(),
    };

    let calls = 0;
    const llm: LlmPort = {
      async complete() {
        calls++;
        if (calls < 3) {
          throw new Error('provider boom');
        }
        return {
          text: JSON.stringify({
            summary: 'done',
            diffs: [{ path: 'src/a.ts', content: 'export const a = 1;\n' }],
          }),
          tokensUsed: 10,
          modelId: 'test-model',
        };
      },
    };

    const orchestrator = createSubagentOrchestrator();
    orchestrator.normalize(plan);

    const result = await runScheduler(plan, {
      llm,
      workspace: new InMemoryWorkspace({}),
      bus: new ContextBus(),
      concurrency: 2,
      orchestrator,
      enableSubagentLoop: false,
    });

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.events.some((e) => e.kind === 'task_retry')).toBe(true);
    expect(
      result.events.some((e) =>
        /deps unmet|never scheduled/.test(e.message),
      ),
    ).toBe(false);
  });
});
