/**
 * Execution substrate abstraction — native scheduler or optional Agent Framework sidecar.
 */

import { runScheduler, type SchedulerOptions, type SchedulerResult } from '../scheduler/scheduler.js';
import type { ExecutionPlan, RuntimeEvent } from '../types.js';

export interface WorkflowExecutionContext extends SchedulerOptions {
  plan: ExecutionPlan;
}

export interface ExecutionSubstrate {
  readonly name: 'native' | 'agent-framework';
  run(ctx: WorkflowExecutionContext): Promise<SchedulerResult>;
}

export class NativeExecutionSubstrate implements ExecutionSubstrate {
  readonly name = 'native' as const;

  async run(ctx: WorkflowExecutionContext): Promise<SchedulerResult> {
    const { plan, ...opts } = ctx;
    return runScheduler(plan, opts);
  }
}

export interface AgentFrameworkSidecarClient {
  healthy(): Promise<boolean>;
  runWorkflow(
    plan: ExecutionPlan,
    opts: Omit<SchedulerOptions, 'orchestrator'> & {
      onWorkflowEvent?: (ev: RuntimeEvent) => void;
    },
  ): Promise<SchedulerResult>;
}

/**
 * Agent Framework substrate — delegates orchestration timing to sidecar while
 * Singularity workers remain the executors (fallback to native on failure).
 */
export class AgentFrameworkExecutionSubstrate implements ExecutionSubstrate {
  readonly name = 'agent-framework' as const;

  constructor(
    private readonly sidecar: AgentFrameworkSidecarClient,
    private readonly fallback: NativeExecutionSubstrate = new NativeExecutionSubstrate(),
  ) {}

  async run(ctx: WorkflowExecutionContext): Promise<SchedulerResult> {
    try {
      const ok = await this.sidecar.healthy();
      if (!ok) {
        return this.fallback.run(ctx);
      }
      const { plan, ...opts } = ctx;
      return await this.sidecar.runWorkflow(plan, opts);
    } catch {
      return this.fallback.run(ctx);
    }
  }
}

export function createExecutionSubstrate(
  kind: 'native' | 'agent-framework',
  sidecar?: AgentFrameworkSidecarClient,
): ExecutionSubstrate {
  if (kind === 'agent-framework' && sidecar) {
    return new AgentFrameworkExecutionSubstrate(sidecar);
  }
  return new NativeExecutionSubstrate();
}
