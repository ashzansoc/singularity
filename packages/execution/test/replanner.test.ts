import { describe, expect, it } from 'vitest';
import { createCorrectiveTasks } from '../src/replanner.js';
import { createExecutionGraph } from '../src/graph.js';
import { MemoryExecutionStore } from '../src/persistence/memory.js';
import type { ExecutionPlan } from '@singularity/runtime';

function makePlan(nodes: ExecutionPlan['nodes']): ExecutionPlan {
  return {
    id: 'plan-1',
    goal: 'test',
    projectSummary: 'test',
    nodes,
    estimates: { totalTokens: 10, taskCount: nodes.length, criticalPathLength: 1 },
    createdAt: Date.now(),
  };
}

describe('replanner', () => {
  it('does not deadlock when creating corrective tasks', async () => {
    const plan = makePlan([
      { id: 'TASK-001', title: 'A', deps: [], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
      { id: 'TASK-002', title: 'B', deps: ['TASK-001'], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
    ]);
    const store = new MemoryExecutionStore();
    const graph = createExecutionGraph('exec-1', plan, store);
    const failed = plan.nodes[0]!;
    await createCorrectiveTasks(
      { llm: { complete: async () => ({ content: '', modelId: 'test' }) }, store, graph, executionId: 'exec-1' },
      failed,
      'tool_failure',
      'boom',
    );
    const done = new Set<string>([failed.id]);
    const ready = graph.getReadyNodes(done);
    expect(ready.some(t => t.id.startsWith(`${failed.id}-fix-`))).toBe(true);
  });
});
