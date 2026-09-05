import type { TaskNode } from '../types.js';
import { normalizePath } from '../ports.js';

export class DagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DagError';
  }
}

export interface Dag {
  nodes: Map<string, TaskNode>;
  /** id → direct dependents */
  dependents: Map<string, string[]>;
}

/** Build adjacency maps and validate the task graph. */
export function buildDag(nodes: TaskNode[]): Dag {
  const map = new Map<string, TaskNode>();
  for (const n of nodes) {
    if (map.has(n.id)) {
      throw new DagError(`Duplicate task id: ${n.id}`);
    }
    map.set(n.id, n);
  }

  const dependents = new Map<string, string[]>();
  for (const n of nodes) {
    for (const d of n.deps) {
      if (!map.has(d)) {
        throw new DagError(`Task ${n.id} depends on unknown node ${d}`);
      }
      const list = dependents.get(d) ?? [];
      list.push(n.id);
      dependents.set(d, list);
    }
  }

  // Cycle detection via DFS colors
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of map.keys()) {
    color.set(id, WHITE);
  }

  const visit = (id: string, stack: string[]): void => {
    color.set(id, GRAY);
    const node = map.get(id)!;
    for (const dep of node.deps) {
      const c = color.get(dep)!;
      if (c === GRAY) {
        throw new DagError(`Cycle detected: ${[...stack, id, dep].join(' → ')}`);
      }
      if (c === WHITE) {
        visit(dep, [...stack, id]);
      }
    }
    color.set(id, BLACK);
  };

  for (const id of map.keys()) {
    if (color.get(id) === WHITE) {
      visit(id, []);
    }
  }

  return { nodes: map, dependents };
}

/** Kahn topological order; throws on cycle (already validated by buildDag). */
export function topoSort(dag: Dag): string[] {
  const indegree = new Map<string, number>();
  for (const id of dag.nodes.keys()) {
    indegree.set(id, 0);
  }
  for (const n of dag.nodes.values()) {
    indegree.set(n.id, n.deps.length);
  }

  const queue = [...indegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([id]) => id)
    .sort();
  const order: string[] = [];

  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const child of dag.dependents.get(id) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) {
        queue.push(child);
        queue.sort();
      }
    }
  }

  if (order.length !== dag.nodes.size) {
    throw new DagError('Cycle detected during topo sort');
  }
  return order;
}

/**
 * Nodes whose deps are all in `done` and whose status is pending/ready.
 * Sorted by priority desc, then id.
 */
export function getReadyNodes(
  dag: Dag,
  done: ReadonlySet<string>,
  exclude: ReadonlySet<string> = new Set(),
): TaskNode[] {
  const ready: TaskNode[] = [];
  for (const n of dag.nodes.values()) {
    if (done.has(n.id) || exclude.has(n.id)) {
      continue;
    }
    if (n.status === 'done' || n.status === 'failed' || n.status === 'cancelled' || n.status === 'running') {
      continue;
    }
    const depsOk = n.deps.every((d) => done.has(d));
    if (depsOk) {
      ready.push(n);
    }
  }
  return ready.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

/** True when two path sets intersect (normalized). */
export function pathsIntersect(a: string[], b: string[]): boolean {
  const setB = new Set(b.map(normalizePath));
  for (const p of a) {
    if (setB.has(normalizePath(p))) {
      return true;
    }
  }
  return false;
}

/** Longest dependency chain length (for estimates). */
export function criticalPathLength(dag: Dag): number {
  const memo = new Map<string, number>();
  const depth = (id: string): number => {
    if (memo.has(id)) {
      return memo.get(id)!;
    }
    const n = dag.nodes.get(id)!;
    if (n.deps.length === 0) {
      memo.set(id, 1);
      return 1;
    }
    const d = 1 + Math.max(...n.deps.map(depth));
    memo.set(id, d);
    return d;
  };
  let max = 0;
  for (const id of dag.nodes.keys()) {
    max = Math.max(max, depth(id));
  }
  return max;
}
