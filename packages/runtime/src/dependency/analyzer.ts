import { buildDag, criticalPathLength, pathsIntersect } from '../graph/dag.js';
import { normalizePath } from '../ports.js';
import type { ExecutionPlan, TaskNode } from '../types.js';

export type DependencyKind =
  | 'explicit'
  | 'file'
  | 'symbol'
  | 'interface'
  | 'artifact'
  | 'resource';

export interface TaskDependency {
  fromTaskId: string;
  toTaskId: string;
  kind: DependencyKind;
  reason?: string;
}

export type ParallelSafety = 'safe' | 'resource_conflict' | 'unsafe';

export interface RepoContext {
  symbolOwners?: Map<string, string>;
  interfaceOwners?: Map<string, string>;
}

export interface DependencyAnalyzerResult {
  plan: ExecutionPlan;
  dependencies: TaskDependency[];
  batches: TaskNode[][];
  criticalPathLength: number;
}

function collectPaths(task: TaskNode): string[] {
  const paths = new Set<string>();
  for (const p of task.ownedPaths ?? []) paths.add(normalizePath(p));
  for (const p of task.affectedFiles ?? []) paths.add(normalizePath(p));
  return [...paths];
}

function collectSymbols(task: TaskNode): string[] {
  return [...(task.affectedSymbols ?? [])];
}

function collectInterfaces(task: TaskNode): string[] {
  return [...(task.interfaces ?? [])];
}

export function canRunInParallel(a: TaskNode, b: TaskNode): ParallelSafety {
  if (pathsIntersect(collectPaths(a), collectPaths(b))) {
    return 'resource_conflict';
  }
  const symA = new Set(collectSymbols(a));
  for (const s of collectSymbols(b)) {
    if (symA.has(s)) return 'resource_conflict';
  }
  const ifaceA = new Set(collectInterfaces(a));
  for (const i of collectInterfaces(b)) {
    if (ifaceA.has(i)) return 'unsafe';
  }
  return 'safe';
}

export function analyzeDependencies(
  plan: ExecutionPlan,
  context: RepoContext = {},
): DependencyAnalyzerResult {
  const dependencies: TaskDependency[] = [];
  const nodes = plan.nodes.map(n => ({ ...n, deps: [...n.deps] }));

  for (const n of nodes) {
    for (const d of n.deps) {
      dependencies.push({ fromTaskId: d, toTaskId: n.id, kind: 'explicit' });
    }
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const safety = canRunInParallel(a, b);
      if (safety === 'safe') continue;

      const hasExplicit = b.deps.includes(a.id) || a.deps.includes(b.id);
      if (hasExplicit) continue;

      const fromId = a.priority >= b.priority ? a.id : b.id;
      const toId = fromId === a.id ? b.id : a.id;
      const kind = safety === 'unsafe' ? 'interface' : 'file';
      const reason = safety === 'unsafe'
        ? 'interface/API contract overlap'
        : 'file or symbol overlap';

      dependencies.push({ fromTaskId: fromId, toTaskId: toId, kind, reason });

      const target = nodes.find(n => n.id === toId);
      if (target && !target.deps.includes(fromId)) {
        target.deps = [...target.deps, fromId];
      }
    }
  }

  if (context.symbolOwners) {
    for (const n of nodes) {
      for (const sym of collectSymbols(n)) {
        const owner = context.symbolOwners.get(sym);
        if (owner && owner !== n.id && !n.deps.includes(owner)) {
          dependencies.push({ fromTaskId: owner, toTaskId: n.id, kind: 'symbol', reason: `symbol ${sym}` });
          n.deps = [...n.deps, owner];
        }
      }
    }
  }

  if (context.interfaceOwners) {
    for (const n of nodes) {
      for (const iface of collectInterfaces(n)) {
        const owner = context.interfaceOwners.get(iface);
        if (owner && owner !== n.id && !n.deps.includes(owner)) {
          dependencies.push({ fromTaskId: owner, toTaskId: n.id, kind: 'interface', reason: `interface ${iface}` });
          n.deps = [...n.deps, owner];
        }
      }
    }
  }

  const highRiskGoal = /\b(auth|security|migration|schema|deploy|production|breaking)\b/i.test(plan.goal);
  if (highRiskGoal) {
    const sorted = [...nodes].sort((x, y) => x.priority - y.priority || x.id.localeCompare(y.id));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (!curr.deps.includes(prev.id)) {
        dependencies.push({
          fromTaskId: prev.id,
          toTaskId: curr.id,
          kind: 'resource',
          reason: `high risk goal — sequentialized`,
        });
        curr.deps = [...curr.deps, prev.id];
      }
    }
  }

  const dag = buildDag(nodes);
  const batches: TaskNode[][] = [];
  const done = new Set<string>();
  let safety = 0;
  while (done.size < nodes.length && safety++ < nodes.length + 5) {
    const ready = nodes.filter(n => {
      if (done.has(n.id)) return false;
      return n.deps.every(d => done.has(d));
    });
    if (ready.length === 0) break;
    batches.push(ready);
    for (const n of ready) done.add(n.id);
  }

  return {
    plan: { ...plan, nodes, estimates: { ...plan.estimates, criticalPathLength: criticalPathLength(dag) } },
    dependencies,
    batches,
    criticalPathLength: criticalPathLength(dag),
  };
}

export function getExecutionBatches(plan: ExecutionPlan): TaskNode[][] {
  return analyzeDependencies(plan).batches;
}
