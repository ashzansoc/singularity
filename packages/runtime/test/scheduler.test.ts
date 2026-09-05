import { describe, expect, it } from 'vitest';
import { ContextBus } from '../src/bus/contextBus.js';
import {
  InMemoryEditPort,
  InMemoryWorkspace,
  type LlmPort,
} from '../src/ports.js';
import { runScheduler } from '../src/scheduler/scheduler.js';
import type { ExecutionPlan, TaskNode } from '../src/types.js';
import { WorkerPool } from '../src/worker/pool.js';

function makePlan(nodes: TaskNode[]): ExecutionPlan {
  return {
    id: 'test',
    goal: 'test',
    projectSummary: 'test',
    nodes,
    estimates: {
      totalTokens: 100,
      taskCount: nodes.length,
      criticalPathLength: 1,
    },
    createdAt: Date.now(),
  };
}

function task(
  id: string,
  ownedPaths: string[],
  deps: string[] = [],
): TaskNode {
  return {
    id,
    title: id,
    deps,
    ownedPaths,
    expectedOutput: 'ok',
    estimatedTokens: 100,
    recommendedTier: 'T2',
    priority: 0,
    retryLimit: 0,
    status: 'pending',
    attempts: 0,
  };
}

describe('WorkerPool concurrency', () => {
  it('caps concurrent runners', async () => {
    const pool = new WorkerPool(2);
    let running = 0;
    let maxRunning = 0;
    const jobs = Array.from({ length: 6 }, () =>
      pool.run(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 30));
        running--;
      }),
    );
    await Promise.all(jobs);
    expect(maxRunning).toBeLessThanOrEqual(2);
  });
});

describe('scheduler concurrency + ownership', () => {
  it('never runs intersecting ownedPaths in parallel', async () => {
    const timeline: string[] = [];
    let concurrentShared = 0;
    let maxShared = 0;

    const llm: LlmPort = {
      async complete(req) {
        if (req.role !== 'worker') {
          return { text: '{}', modelId: 'mock', tokensUsed: 1 };
        }
        const isA = req.prompt.includes('Task: a');
        const isB = req.prompt.includes('Task: b');
        if (isA || isB) {
          concurrentShared++;
          maxShared = Math.max(maxShared, concurrentShared);
          await new Promise((r) => setTimeout(r, 40));
          concurrentShared--;
        }
        const path = isA || isB ? 'shared.ts' : 'c.ts';
        timeline.push(path);
        return {
          text: JSON.stringify({
            diffs: [{ path, newContent: `from-${path}` }],
            busEvents: [],
          }),
          modelId: 'mock',
          tokensUsed: 10,
        };
      },
    };

    const workspace = new InMemoryWorkspace({
      'shared.ts': 'old',
      'c.ts': 'old',
    });
    const plan = makePlan([
      task('a', ['shared.ts']),
      task('b', ['shared.ts']),
      task('c', ['c.ts']),
    ]);

    const result = await runScheduler(plan, {
      llm,
      workspace,
      bus: new ContextBus(),
      concurrency: 4,
    });

    expect(result.ok).toBe(true);
    expect(maxShared).toBe(1);
    expect(result.results.filter((r) => r.status === 'ok')).toHaveLength(3);
  });

  it('runs independent tasks in parallel', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const llm: LlmPort = {
      async complete(req) {
        if (req.role !== 'worker') {
          return { text: '{}', modelId: 'mock', tokensUsed: 1 };
        }
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 50));
        concurrent--;
        const pathMatch = req.prompt.match(/Owned paths:\n- (.+)/);
        const path = pathMatch?.[1]?.trim() ?? 'x.ts';
        return {
          text: JSON.stringify({
            diffs: [{ path, newContent: 'x' }],
          }),
          modelId: 'mock',
          tokensUsed: 5,
        };
      },
    };

    const workspace = new InMemoryWorkspace({
      'a.ts': '1',
      'b.ts': '2',
      'c.ts': '3',
    });
    const plan = makePlan([
      task('a', ['a.ts']),
      task('b', ['b.ts']),
      task('c', ['c.ts']),
    ]);

    await runScheduler(plan, {
      llm,
      workspace,
      bus: new ContextBus(),
      concurrency: 3,
    });

    expect(maxConcurrent).toBeGreaterThan(1);
  });
});

describe('InMemoryEditPort', () => {
  it('applies newContent diffs', async () => {
    const ws = new InMemoryWorkspace({ 'a.ts': 'old' });
    const edit = new InMemoryEditPort(ws);
    const { applied, conflicts } = await edit.applyDiffs([
      { path: 'a.ts', unifiedDiff: '', newContent: 'new' },
    ]);
    expect(conflicts).toEqual([]);
    expect(applied).toEqual(['a.ts']);
    expect(await ws.readFile('a.ts')).toBe('new');
  });
});
