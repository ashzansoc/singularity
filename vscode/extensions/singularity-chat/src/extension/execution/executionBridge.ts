import * as vscode from 'vscode';
import {
  createExecutionEngine,
  renderTodoMd,
  type ExecutionRunResult,
} from '@singularity/execution';
import {
  classifyComplexity,
  createLlmPortFromSingularityAI,
  type ComplexityLane,
  type AgentExecutor,
  type LlmPort,
} from '@singularity/runtime';
import type { SingularityAI } from '@singularity/router';

export interface ExecutionBridgeConfig {
  enabled: boolean;
  autoPlanThreshold: 'low' | 'medium' | 'high';
  maxConcurrentAgents: number;
}

function laneMeetsThreshold(lane: ComplexityLane, threshold: ExecutionBridgeConfig['autoPlanThreshold']): boolean {
  const order: ComplexityLane[] = ['fast', 'medium', 'deep'];
  const laneIdx = order.indexOf(lane);
  const thresholdIdx = threshold === 'low' ? 0 : threshold === 'medium' ? 1 : 2;
  return laneIdx >= thresholdIdx;
}

export class ExecutionBridge {
  private llm?: LlmPort;

  constructor(
    private readonly ai: SingularityAI,
    private readonly executor: AgentExecutor,
    private config: ExecutionBridgeConfig,
  ) {}

  updateConfig(config: Partial<ExecutionBridgeConfig>): void {
    this.config = { ...this.config, ...config };
  }

  shouldUseEngine(goal: string): boolean {
    if (!this.config.enabled) return false;
    if (/^# Task:/m.test(goal) && /\bExecution ID:\s*\S+/m.test(goal) && /\bTask ID:\s*\S+/m.test(goal)) {
      return false;
    }
    return laneMeetsThreshold(classifyComplexity(goal), this.config.autoPlanThreshold);
  }

  private getLlm(): LlmPort {
    if (!this.llm) {
      this.llm = createLlmPortFromSingularityAI({ ai: this.ai });
    }
    return this.llm;
  }

  async run(opts: {
    goal: string;
    sessionId: string;
    workspaceRoot: string;
    executionId?: string;
    onTodoProjection?: (md: string) => void;
    signal?: AbortSignal;
  }): Promise<ExecutionRunResult & { todoMd: string }> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }

    const engine = createExecutionEngine({
      workspaceRoot: opts.workspaceRoot,
      sessionId: opts.sessionId,
      llm: this.getLlm(),
      workspace: {
        readFile: async (path) => {
          try {
            const uri = vscode.Uri.joinPath(folder.uri, path);
            return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
          } catch {
            return undefined;
          }
        },
      },
      edit: {
        applyDiffs: async () => ({ applied: [], conflicts: [] }),
      },
      executor: this.executor,
      flags: {
        enabled: this.config.enabled,
        maxConcurrentAgents: this.config.maxConcurrentAgents,
        autoPlanThreshold: this.config.autoPlanThreshold,
      },
      onTodoProjection: opts.onTodoProjection,
      signal: opts.signal,
    });

    const result = await engine.run(opts.goal, opts.executionId);
    const todoMd = renderTodoMd(result.plan);
    return { ...result, todoMd };
  }

  async resume(executionId: string, workspaceRoot: string, sessionId: string): Promise<ExecutionRunResult> {
    const engine = createExecutionEngine({
      workspaceRoot,
      sessionId,
      llm: this.getLlm(),
      workspace: { readFile: async () => undefined },
      edit: { applyDiffs: async () => ({ applied: [], conflicts: [] }) },
      executor: this.executor,
      flags: { enabled: true, maxConcurrentAgents: this.config.maxConcurrentAgents },
    });
    return engine.resume(executionId);
  }
}

export function registerExecutionBridge(
  context: vscode.ExtensionContext,
  ai: SingularityAI,
  executor: AgentExecutor,
): ExecutionBridge {
  const config = vscode.workspace.getConfiguration('singularity.execution');
  const bridge = new ExecutionBridge(ai, executor, {
    enabled: config.get<boolean>('enabled', false),
    autoPlanThreshold: config.get<'low' | 'medium' | 'high'>('autoPlanThreshold', 'medium'),
    maxConcurrentAgents: config.get<number>('maxConcurrentAgents', 8),
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('singularity.execution')) {
        const cfg = vscode.workspace.getConfiguration('singularity.execution');
        bridge.updateConfig({
          enabled: cfg.get<boolean>('enabled', false),
          autoPlanThreshold: cfg.get<'low' | 'medium' | 'high'>('autoPlanThreshold', 'medium'),
          maxConcurrentAgents: cfg.get<number>('maxConcurrentAgents', 8),
        });
      }
    }),
  );

  return bridge;
}
