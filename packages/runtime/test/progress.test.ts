import { describe, expect, it } from 'vitest';
import { calculateWorkflowProgress } from '../src/progress/calculator.js';
import type { ExecutionPlan, TaskNode } from '../src/types.js';

function plan(nodes: TaskNode[]): ExecutionPlan {
  return {
    id: 'p',
    goal: 'g',
    projectSummary: '',
    nodes,
    estimates: { totalTokens: 1, taskCount: nodes.length, criticalPathLength: 1 },
    createdAt: Date.now(),
  };
}

describe('calculateWorkflowProgress', () => {
  it('uses weighted completion not average of agent percentages', () => {
    const p = plan([
      {
        id: 'a',
        title: 'A',
        deps: [],
        ownedPaths: [],
        expectedOutput: 'x',
        estimatedTokens: 100,
        recommendedTier: 'T2',
        priority: 1,
        retryLimit: 1,
        status: 'done',
      },
      {
        id: 'b',
        title: 'B',
        deps: [],
        ownedPaths: [],
        expectedOutput: 'x',
        estimatedTokens: 100,
        recommendedTier: 'T2',
        priority: 1,
        retryLimit: 1,
        status: 'running',
        progress: 90,
      },
    ]);
    const prog = calculateWorkflowProgress(p);
    expect(prog.completedTasks).toBe(1);
    expect(prog.runningTasks).toBe(1);
    expect(prog.percent).toBeLessThan(90);
    expect(prog.percent).toBeGreaterThan(50);
  });

  it('returns 100% when all tasks done', () => {
    const p = plan([
      {
        id: 'a',
        title: 'A',
        deps: [],
        ownedPaths: [],
        expectedOutput: 'x',
        estimatedTokens: 10,
        recommendedTier: 'T2',
        priority: 1,
        retryLimit: 1,
        status: 'done',
      },
    ]);
    expect(calculateWorkflowProgress(p).percent).toBe(100);
  });
});
