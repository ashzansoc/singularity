import { describe, expect, it } from 'vitest';
import { createExecutionGraph } from '../src/graph.js';
import { MemoryExecutionStore } from '../src/persistence/memory.js';
import type { ExecutionPlan } from '@singularity/runtime';

function makePlan(nodes: ExecutionPlan['nodes']): ExecutionPlan {
  return {
    id: 'plan-1',
    goal: 'test',
    projectSummary: 'test plan',
    nodes,
    estimates: { totalTokens: 100, taskCount: nodes.length, criticalPathLength: 1 },
    createdAt: Date.now(),
  };
}

describe('ExecutionGraph', () => {
  it('derives batches from dependencies', () => {
    const plan = makePlan([
      { id: 'A', title: 'A', deps: [], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
      { id: 'B', title: 'B', deps: ['A'], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
      { id: 'C', title: 'C', deps: ['A'], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
    ]);
    const graph = createExecutionGraph('exec-1', plan);
    const batches = graph.getExecutionBatches();
    expect(batches).toHaveLength(2);
    expect(batches[0].map(n => n.id)).toEqual(['A']);
    expect(batches[1].map(n => n.id).sort()).toEqual(['B', 'C']);
  });

  it('supports dynamic task insertion', () => {
    const plan = makePlan([
      { id: 'A', title: 'A', deps: [], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
    ]);
    const store = new MemoryExecutionStore();
    const graph = createExecutionGraph('exec-1', plan, store);
    graph.addTask({
      id: 'B', title: 'B', deps: ['A'], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending',
    });
    expect(graph.getPlan().nodes).toHaveLength(2);
    expect(store.listTasks('exec-1')).toHaveLength(2);
  });

  it('fixture TASK-001..005 schedule matches DAG batches', () => {
    const plan = makePlan([
      { id: 'TASK-001', title: 'Setup', deps: [], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
      { id: 'TASK-002', title: 'Backend', deps: ['TASK-001'], ownedPaths: ['backend/'], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
      { id: 'TASK-003', title: 'Frontend', deps: ['TASK-001'], ownedPaths: ['frontend/'], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
      { id: 'TASK-004', title: 'Integrate', deps: ['TASK-002', 'TASK-003'], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
      { id: 'TASK-005', title: 'Verify', deps: ['TASK-004'], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
    ]);
    const graph = createExecutionGraph('exec-fixture', plan);
    const batches = graph.getExecutionBatches();
    expect(batches).toHaveLength(4);
    expect(batches[0].map(n => n.id)).toEqual(['TASK-001']);
    expect(batches[1].map(n => n.id).sort()).toEqual(['TASK-002', 'TASK-003']);
    expect(batches[2].map(n => n.id)).toEqual(['TASK-004']);
    expect(batches[3].map(n => n.id)).toEqual(['TASK-005']);
  });

  it('parallel batch dispatch records same-batch spawn times', async () => {
    const plan = makePlan([
      { id: 'TASK-001', title: 'Setup', deps: [], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
      { id: 'TASK-002', title: 'B', deps: ['TASK-001'], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
      { id: 'TASK-003', title: 'C', deps: ['TASK-001'], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
      { id: 'TASK-004', title: 'D', deps: ['TASK-002', 'TASK-003'], ownedPaths: [], expectedOutput: '', estimatedTokens: 10, recommendedTier: 'fast', priority: 1, retryLimit: 1, status: 'pending' },
    ]);
    const graph = createExecutionGraph('exec-parallel', plan);
    const done = new Set<string>();
    const dispatchLog: Array<{ taskId: string; at: number; batch: number }> = [];
    let batch = 0;
    while (done.size < plan.nodes.length) {
      const ready = graph.getReadyNodes(done);
      if (ready.length === 0) break;
      const wave = ready.slice(0, 8);
      batch++;
      await Promise.all(wave.map(async task => {
        dispatchLog.push({ taskId: task.id, at: Date.now(), batch });
        await new Promise(r => setTimeout(r, 5));
        done.add(task.id);
      }));
    }
    const batch2 = dispatchLog.filter(e => e.batch === 2).map(e => e.taskId).sort();
    expect(batch2).toEqual(['TASK-002', 'TASK-003']);
    const task004 = dispatchLog.find(e => e.taskId === 'TASK-004');
    expect(task004?.batch).toBe(3);
  });
});
