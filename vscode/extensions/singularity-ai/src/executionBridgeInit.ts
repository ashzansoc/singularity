import * as vscode from 'vscode';
import {
  createExecutionEngine,
  renderTodoMd,
  type ExecutionEvent,
} from '@singularity/execution';
import {
  classifyComplexity,
  createLlmPortFromSingularityAI,
  type AgentExecutor,
  type AgentTaskContext,
  type AgentTaskResult,
  type ComplexityLane,
  type ToolPort,
} from '@singularity/runtime';
import type { SingularityAI } from '@singularity/router';
import { createVsCodeEditPort, createVsCodeWorkspacePort } from './runtimeBridge.js';

export interface ExecutionRunCommandRequest {
  goal: string;
  sessionId: string;
  workspaceRoot: string;
  executionId?: string;
  maxConcurrentAgents?: number;
  parentSessionId?: string;
  parentChatUri?: string;
  parentSessionResource?: string;
  parentRequestId?: string;
  executorKind?: 'extensionHost' | 'agentHost';
}

export interface ExecutionRunCommandResponse {
  ok: boolean;
  executionId: string;
  summary: string;
  taskCount?: number;
  criticalPathLength?: number;
  appliedPaths?: string[];
}

function laneMeetsThreshold(lane: ComplexityLane, threshold: 'low' | 'medium' | 'high'): boolean {
  const order: ComplexityLane[] = ['fast', 'medium', 'deep'];
  const laneIdx = order.indexOf(lane);
  const thresholdIdx = threshold === 'low' ? 0 : threshold === 'medium' ? 1 : 2;
  return laneIdx >= thresholdIdx;
}

function createExtensionHostExecutor(req: ExecutionRunCommandRequest): AgentExecutor {
  const workerSummaries: string[] = [];
  const parentSessionResource = req.parentSessionResource;
  const parentRequestId = req.parentRequestId;
  if (!parentSessionResource || !parentRequestId) {
    throw new Error('parentSessionResource and parentRequestId are required for extension-host executor');
  }

  return {
    async executeTask(ctx: AgentTaskContext): Promise<AgentTaskResult> {
      let phase: 'worker' | 'integration' | 'verification' = 'worker';
      let dependencySummaries: string[] | undefined;
      if (ctx.task.id === '__integration__') {
        phase = 'integration';
        dependencySummaries = [...workerSummaries];
      } else if (ctx.task.id === '__verification__') {
        phase = 'verification';
        dependencySummaries = [...workerSummaries];
      }

      const result = await vscode.commands.executeCommand<AgentTaskResult>('singularity.execution.executeTaskViaRunSubagent', {
        ...ctx,
        parentSessionResource,
        parentRequestId,
        phase,
        dependencySummaries,
      });

      const resolved = result ?? {
        taskId: ctx.task.id,
        ok: false,
        error: 'executeTaskViaRunSubagent returned no result',
        failureClass: 'provider_error',
      };

      if (resolved.ok && phase === 'worker' && (resolved.subagentResult?.summary || resolved.workerResult)) {
        const summary = resolved.subagentResult?.summary ?? `Task ${ctx.task.id} completed`;
        workerSummaries.push(`${ctx.task.id}: ${summary}`);
      }
      return resolved;
    },
    maxConcurrency: req.maxConcurrentAgents ?? cfg().get<number>('maxConcurrentAgents', 8),
  };
}

function createWorkbenchAgentHostExecutor(
  parentSessionId?: string,
  parentChatUri?: string,
): AgentExecutor {
  return {
    async executeTask(ctx: AgentTaskContext): Promise<AgentTaskResult> {
      const result = await vscode.commands.executeCommand<AgentTaskResult>('singularity.agentHost.executeTask', {
        ...ctx,
        parentSessionId: parentSessionId ?? ctx.sessionId,
        parentChatUri: parentChatUri ?? parentSessionId,
      });
      return result ?? {
        taskId: ctx.task.id,
        ok: false,
        error: 'Workbench executeTask returned no result',
        failureClass: 'provider_error',
      };
    },
    maxConcurrency: 8,
  };
}

function createVsCodeToolPort(_workspaceRoot: string): ToolPort {
	return {};
}

function cfg() {
  return vscode.workspace.getConfiguration('singularity.execution');
}

function isExecutionEngineWorkerPrompt(goal: string): boolean {
  return /^# Task:/m.test(goal) && /\bExecution ID:\s*\S+/m.test(goal) && /\bTask ID:\s*\S+/m.test(goal);
}

function shouldUseEngine(goal: string): boolean {
  if (!cfg().get<boolean>('enabled', false)) return false;
  if (isExecutionEngineWorkerPrompt(goal)) return false;
  const threshold = cfg().get<'low' | 'medium' | 'high'>('autoPlanThreshold', 'low');
  return laneMeetsThreshold(classifyComplexity(goal), threshold);
}

async function reportExecutionEvent(event: ExecutionEvent): Promise<void> {
  try {
    await vscode.commands.executeCommand('singularity.execution.reportEvent', event);
  } catch {
    // Workbench listener may not be registered yet in tests.
  }
}

async function projectExecutionTodo(sessionId: string, markdown: string): Promise<void> {
  try {
    await vscode.commands.executeCommand('singularity.execution.projectTodo', sessionId, markdown);
  } catch {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder.uri, 'todo.md'), Buffer.from(markdown, 'utf8'));
    }
  }
}

function resolveExecutor(req: ExecutionRunCommandRequest): AgentExecutor {
  const useAgentHost = req.executorKind === 'agentHost'
    || (!req.parentSessionResource && Boolean(req.parentChatUri));
  if (useAgentHost) {
    return createWorkbenchAgentHostExecutor(req.parentSessionId ?? req.sessionId, req.parentChatUri ?? req.sessionId);
  }
  return createExtensionHostExecutor(req);
}

function buildEngineOptions(
  ai: SingularityAI,
  req: ExecutionRunCommandRequest,
) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const workspaceRoot = req.workspaceRoot || folder?.uri.fsPath || '';
  const workspace = folder ? createVsCodeWorkspacePort(folder) : { readFile: async () => undefined };
  const edit = folder ? createVsCodeEditPort(folder) : { applyDiffs: async () => ({ applied: [], conflicts: [] }) };
  const llm = createLlmPortFromSingularityAI({ ai });
  const useExtensionHost = req.executorKind !== 'agentHost' && Boolean(req.parentSessionResource);
  const executor = resolveExecutor(req);

  return {
    workspaceRoot,
    sessionId: req.sessionId,
    llm,
    workspace,
    edit,
    tools: createVsCodeToolPort(workspaceRoot),
    executor,
    runPhasesViaExecutor: useExtensionHost,
    skipDesignPipeline: true,
    flags: {
      enabled: true,
      maxConcurrentAgents: req.maxConcurrentAgents ?? cfg().get<number>('maxConcurrentAgents', 8),
      autoPlanThreshold: cfg().get<'low' | 'medium' | 'high'>('autoPlanThreshold', 'low'),
    },
    onEvent: (event: ExecutionEvent) => {
      void reportExecutionEvent(event);
    },
    onTodoProjection: async (md: string) => {
      await projectExecutionTodo(req.sessionId, md);
    },
  };
}

async function runExecution(
  ai: SingularityAI,
  req: ExecutionRunCommandRequest,
): Promise<ExecutionRunCommandResponse> {
  const engine = createExecutionEngine(buildEngineOptions(ai, req));
  try {
    const result = await engine.run(req.goal, req.executionId);
    void renderTodoMd(result.plan);
    return {
      ok: result.ok,
      executionId: result.executionId,
      summary: result.summary,
      taskCount: result.plan.nodes.length,
      criticalPathLength: result.plan.estimates.criticalPathLength,
      appliedPaths: result.appliedPaths,
    };
  } finally {
    if (req.parentSessionResource) {
      try {
        await vscode.commands.executeCommand('singularity.execution.clearOwnedPaths', req.parentSessionResource);
      } catch {
        // ignore
      }
    }
  }
}

async function resumeExecution(ai: SingularityAI, executionId: string): Promise<ExecutionRunCommandResponse> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const req: ExecutionRunCommandRequest = {
    goal: '',
    sessionId: '',
    workspaceRoot: folder?.uri.fsPath ?? '',
    executionId,
  };
  const engine = createExecutionEngine(buildEngineOptions(ai, req));
  const result = await engine.resume(executionId);
  return {
    ok: result.ok,
    executionId: result.executionId,
    summary: result.summary,
    taskCount: result.plan.nodes.length,
    criticalPathLength: result.plan.estimates.criticalPathLength,
    appliedPaths: result.appliedPaths,
  };
}

export function registerExecutionBridge(context: vscode.ExtensionContext, ai: SingularityAI): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('singularity.execution.shouldUseEngine', (goal: string) => {
      return shouldUseEngine(String(goal ?? ''));
    }),
    vscode.commands.registerCommand('singularity.execution.run', async (req: ExecutionRunCommandRequest) => {
      return runExecution(ai, req);
    }),
    vscode.commands.registerCommand('singularity.execution.resume', async (executionId: string) => {
      return resumeExecution(ai, executionId);
    }),
  );
}
