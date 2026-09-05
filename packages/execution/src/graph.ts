import {
  buildDag,
  criticalPathLength,
  getReadyNodes,
  type Dag,
} from '@singularity/runtime';
import type { ExecutionPlan, TaskNode } from '@singularity/runtime';
import type { TaskDependency, EnrichedExecutionGraph } from './types.js';
import type { ExecutionStore } from './persistence/store.js';

/** Mutable DAG wrapper with persistence and dynamic task insertion. */
export class ExecutionGraph {
  private dag: Dag;
  private extraDeps: TaskDependency[] = [];
  private paused = new Set<string>();

  constructor(
    private readonly executionId: string,
    private plan: ExecutionPlan,
    private readonly store?: ExecutionStore,
  ) {
    this.dag = buildDag(plan.nodes);
    if (store) {
      for (const node of plan.nodes) {
        store.upsertTask(executionId, node);
      }
    }
  }

  getPlan(): ExecutionPlan {
    return this.plan;
  }

  getDag(): Dag {
    return this.dag;
  }

  getDependencies(): TaskDependency[] {
    return [...this.extraDeps];
  }

  getCriticalPathLength(): number {
    return criticalPathLength(this.dag);
  }

  getReadyNodes(done: ReadonlySet<string>): TaskNode[] {
    const exclude = new Set([...this.paused]);
    return getReadyNodes(this.dag, done, exclude);
  }

  getExecutionBatches(): TaskNode[][] {
    const done = new Set<string>();
    const batches: TaskNode[][] = [];
    const total = this.plan.nodes.length;
    let safety = 0;
    while (done.size < total && safety++ < total + 5) {
      const ready = this.getReadyNodes(done);
      if (ready.length === 0) break;
      batches.push(ready);
      for (const n of ready) {
        done.add(n.id);
      }
    }
    return batches;
  }

  addTask(task: TaskNode): void {
    this.plan = {
      ...this.plan,
      nodes: [...this.plan.nodes, task],
    };
    this.rebuildDag();
    this.store?.upsertTask(this.executionId, task);
  }

  addDependency(fromTaskId: string, toTaskId: string, kind: TaskDependency['kind'], reason?: string): void {
    const dep: TaskDependency = { fromTaskId, toTaskId, kind, reason };
    this.extraDeps.push(dep);
    const target = this.plan.nodes.find(n => n.id === toTaskId);
    if (target && !target.deps.includes(fromTaskId)) {
      target.deps = [...target.deps, fromTaskId];
      this.rebuildDag();
      this.store?.upsertTask(this.executionId, target);
    }
    this.store?.addDependency({ executionId: this.executionId, ...dep });
  }

  pauseSubtree(taskId: string): void {
    this.paused.add(taskId);
    const visit = (id: string): void => {
      for (const [parent, children] of this.dag.dependents) {
        if (parent === id) {
          for (const child of children) {
            this.paused.add(child);
            visit(child);
          }
        }
      }
    };
    visit(taskId);
  }

  resume(taskId: string): void {
    this.paused.delete(taskId);
  }

  updateTaskStatus(taskId: string, status: TaskNode['status']): void {
    const node = this.dag.nodes.get(taskId);
    if (!node) return;
    node.status = status;
    this.store?.upsertTask(this.executionId, node);
  }

  toEnrichedGraph(): EnrichedExecutionGraph {
    return {
      executionId: this.executionId,
      plan: this.plan,
      dependencies: this.getDependencies(),
      batches: this.getExecutionBatches(),
      criticalPathLength: this.getCriticalPathLength(),
    };
  }

  private rebuildDag(): void {
    this.dag = buildDag(this.plan.nodes);
  }
}

export function createExecutionGraph(
  executionId: string,
  plan: ExecutionPlan,
  store?: ExecutionStore,
): ExecutionGraph {
  return new ExecutionGraph(executionId, plan, store);
}
