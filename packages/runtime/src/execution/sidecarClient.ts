/**
 * Optional Agent Framework sidecar client (stdio JSON lines).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentFrameworkSidecarClient } from '../execution/substrate.js';
import { runScheduler, type SchedulerOptions, type SchedulerResult } from '../scheduler/scheduler.js';
import type { ExecutionPlan, RuntimeEvent } from '../types.js';

export interface SidecarClientOptions {
  pythonPath?: string;
  scriptPath?: string;
}

export class StdioAgentFrameworkSidecar implements AgentFrameworkSidecarClient {
  private proc: ChildProcessWithoutNullStreams | undefined;

  constructor(private readonly opts: SidecarClientOptions = {}) {}

  async healthy(): Promise<boolean> {
    try {
      const resp = await this.request<{ ok?: boolean }>({ op: 'health' });
      return resp.ok === true;
    } catch {
      return false;
    }
  }

  async runWorkflow(
    plan: ExecutionPlan,
    opts: Omit<SchedulerOptions, 'orchestrator'> & {
      onWorkflowEvent?: (ev: RuntimeEvent) => void;
    },
  ): Promise<SchedulerResult> {
    const resp = await this.request<{ ok?: boolean; reason?: string }>({
      op: 'run_workflow',
      plan,
    });
    if (resp.ok) {
      return runScheduler(plan, opts as SchedulerOptions);
    }
    opts.onWorkflowEvent?.({
      kind: 'workflow_progress',
      ts: Date.now(),
      message: `Agent Framework unavailable (${resp.reason ?? 'unknown'}); using native scheduler`,
    });
    return runScheduler(plan, opts as SchedulerOptions);
  }

  private async request<T>(payload: Record<string, unknown>): Promise<T> {
    const proc = this.ensureProcess();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sidecar_timeout')), 5_000);
      const onLine = (line: string): void => {
        clearTimeout(timer);
        rl.off('line', onLine);
        try {
          resolve(JSON.parse(line) as T);
        } catch (err) {
          reject(err);
        }
      };
      const rl = createInterface({ input: proc.stdout });
      rl.on('line', onLine);
      proc.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  private ensureProcess(): ChildProcessWithoutNullStreams {
    if (this.proc) {
      return this.proc;
    }
    const script =
      this.opts.scriptPath ??
      new URL('../../../../services/agent-framework-sidecar/main.py', import.meta.url).pathname;
    this.proc = spawn(this.opts.pythonPath ?? 'python3', [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return this.proc;
  }

  dispose(): void {
    this.proc?.kill();
    this.proc = undefined;
  }
}
