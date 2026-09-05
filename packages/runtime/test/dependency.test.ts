import { describe, expect, it } from 'vitest';
import { analyzeDependencies, canRunInParallel } from '../src/dependency/analyzer.js';
import type { ExecutionPlan, TaskNode } from '../src/types.js';

function baseNode(id: string, overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id,
    title: id,
    deps: [],
    ownedPaths: [],
    expectedOutput: '',
    estimatedTokens: 10,
    recommendedTier: 'fast',
    priority: 1,
    retryLimit: 1,
    status: 'pending',
    ...overrides,
  };
}

function makePlan(nodes: TaskNode[]): ExecutionPlan {
  return {
    id: 'p1',
    goal: 'test goal',
    projectSummary: 'summary',
    nodes,
    estimates: { totalTokens: 100, taskCount: nodes.length, criticalPathLength: 1 },
    createdAt: Date.now(),
  };
}

describe('DependencyAnalyzer', () => {
  it('marks file overlap as resource conflict', () => {
    const a = baseNode('A', { ownedPaths: ['src/foo.ts'] });
    const b = baseNode('B', { ownedPaths: ['src/foo.ts'] });
    expect(canRunInParallel(a, b)).toBe('resource_conflict');
  });

  it('allows parallel when paths do not overlap', () => {
    const a = baseNode('A', { ownedPaths: ['src/a.ts'] });
    const b = baseNode('B', { ownedPaths: ['src/b.ts'] });
    expect(canRunInParallel(a, b)).toBe('safe');
  });

  it('adds implicit deps for overlapping files', () => {
    const plan = makePlan([
      baseNode('A', { ownedPaths: ['src/shared.ts'], priority: 2 }),
      baseNode('B', { ownedPaths: ['src/shared.ts'], priority: 1 }),
    ]);
    const result = analyzeDependencies(plan);
    expect(result.dependencies.some(d => d.kind === 'file')).toBe(true);
    expect(result.batches).toHaveLength(2);
  });

  it('honors explicit deps', () => {
    const plan = makePlan([
      baseNode('A'),
      baseNode('B', { deps: ['A'] }),
    ]);
    const result = analyzeDependencies(plan);
    expect(result.batches[0].map(n => n.id)).toEqual(['A']);
    expect(result.batches[1].map(n => n.id)).toEqual(['B']);
  });
});
