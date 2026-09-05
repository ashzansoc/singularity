import { describe, expect, it } from 'vitest';
import { ContextBus } from '../src/bus/contextBus.js';
import { integrateResults } from '../src/integrate/integrator.js';
import {
  InMemoryEditPort,
  InMemoryWorkspace,
  type LlmPort,
} from '../src/ports.js';
import type { ExecutionPlan, WorkerResult } from '../src/types.js';

const plan: ExecutionPlan = {
  id: 'p1',
  goal: 'merge',
  projectSummary: 'demo',
  nodes: [],
  estimates: { totalTokens: 0, taskCount: 0, criticalPathLength: 0 },
  createdAt: Date.now(),
};

describe('integrator', () => {
  it('applies diffs in completion order', async () => {
    const ws = new InMemoryWorkspace({
      'a.ts': 'A0',
      'b.ts': 'B0',
    });
    const edit = new InMemoryEditPort(ws);
    const order: string[] = [];
    const trackingEdit = {
      async applyDiffs(diffs: Parameters<InMemoryEditPort['applyDiffs']>[0]) {
        for (const d of diffs) {
          order.push(d.path);
        }
        return edit.applyDiffs(diffs);
      },
      async format() {},
    };

    const results: WorkerResult[] = [
      {
        taskId: 't1',
        status: 'ok',
        diffs: [{ path: 'a.ts', unifiedDiff: '', newContent: 'A1' }],
        busEvents: [],
        tokensUsed: 1,
        modelId: 'm',
      },
      {
        taskId: 't2',
        status: 'ok',
        diffs: [{ path: 'b.ts', unifiedDiff: '', newContent: 'B1' }],
        busEvents: [],
        tokensUsed: 1,
        modelId: 'm',
      },
    ];

    const llm: LlmPort = {
      async complete() {
        return { text: '{"diffs":[],"summary":"noop"}', modelId: 'm', tokensUsed: 1 };
      },
    };

    const out = await integrateResults(plan, results, {
      edit: trackingEdit,
      workspace: ws,
      llm,
      bus: new ContextBus(),
    });

    expect(order).toEqual(['a.ts', 'b.ts']);
    expect(out.appliedPaths).toEqual(['a.ts', 'b.ts']);
    expect(await ws.readFile('a.ts')).toBe('A1');
    expect(await ws.readFile('b.ts')).toBe('B1');
    expect(out.ok).toBe(true);
  });

  it('runs one LLM pass on residual ChangeRequests', async () => {
    const ws = new InMemoryWorkspace({
      'shared.ts': 'export const x = 1;',
    });
    const edit = new InMemoryEditPort(ws);
    const bus = new ContextBus();
    bus.emitKind('ChangeRequest', 't1', 'need export', { path: 'shared.ts' });

    let integratorCalls = 0;
    const llm: LlmPort = {
      async complete(req) {
        if (req.role === 'integrator') {
          integratorCalls++;
          return {
            text: JSON.stringify({
              diffs: [
                {
                  path: 'shared.ts',
                  newContent: 'export const x = 2;\nexport const y = 3;',
                },
              ],
              summary: 'fixed exports',
            }),
            modelId: 'integrator-model',
            tokensUsed: 20,
          };
        }
        return { text: '{}', modelId: 'm', tokensUsed: 1 };
      },
    };

    const out = await integrateResults(plan, [], {
      edit,
      workspace: ws,
      llm,
      bus,
    });

    expect(integratorCalls).toBe(1);
    expect(await ws.readFile('shared.ts')).toContain('y = 3');
    expect(out.ok).toBe(true);
  });
});
