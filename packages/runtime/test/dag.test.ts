import { describe, expect, it } from 'vitest';
import {
  buildDag,
  criticalPathLength,
  DagError,
  getReadyNodes,
  pathsIntersect,
  topoSort,
} from '../src/graph/dag.js';
import type { TaskNode } from '../src/types.js';

function node(
  partial: Partial<TaskNode> & Pick<TaskNode, 'id' | 'deps' | 'ownedPaths'>,
): TaskNode {
  return {
    title: partial.id,
    expectedOutput: '',
    estimatedTokens: 100,
    recommendedTier: 'T2',
    priority: 0,
    retryLimit: 1,
    status: 'pending',
    ...partial,
  };
}

describe('DAG', () => {
  it('topologically sorts a simple chain', () => {
    const nodes = [
      node({ id: 'a', deps: [], ownedPaths: ['a.ts'] }),
      node({ id: 'b', deps: ['a'], ownedPaths: ['b.ts'] }),
      node({ id: 'c', deps: ['b'], ownedPaths: ['c.ts'] }),
    ];
    const dag = buildDag(nodes);
    expect(topoSort(dag)).toEqual(['a', 'b', 'c']);
    expect(criticalPathLength(dag)).toBe(3);
  });

  it('exposes parallel ready-set when deps are satisfied', () => {
    const nodes = [
      node({ id: 'root', deps: [], ownedPaths: ['r.ts'], priority: 1 }),
      node({ id: 'left', deps: ['root'], ownedPaths: ['l.ts'], priority: 5 }),
      node({ id: 'right', deps: ['root'], ownedPaths: ['r2.ts'], priority: 3 }),
    ];
    const dag = buildDag(nodes);
    expect(getReadyNodes(dag, new Set()).map((n) => n.id)).toEqual(['root']);
    expect(getReadyNodes(dag, new Set(['root'])).map((n) => n.id)).toEqual([
      'left',
      'right',
    ]);
  });

  it('detects cycles', () => {
    expect(() =>
      buildDag([
        node({ id: 'a', deps: ['b'], ownedPaths: ['a.ts'] }),
        node({ id: 'b', deps: ['a'], ownedPaths: ['b.ts'] }),
      ]),
    ).toThrow(DagError);
  });

  it('detects path intersections', () => {
    expect(pathsIntersect(['src/a.ts', 'src/b.ts'], ['src/b.ts'])).toBe(true);
    expect(pathsIntersect(['src/a.ts'], ['src/b.ts'])).toBe(false);
  });
});
