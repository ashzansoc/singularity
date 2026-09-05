import * as vscode from 'vscode';
import type { SingularityAI } from '@singularity/router';
import type { AgentExecutor } from '@singularity/runtime';
import { ExecutionBridge } from './executionBridge.js';

let bridge: ExecutionBridge | undefined;

export function activateExecutionBridge(
  context: vscode.ExtensionContext,
  ai: SingularityAI,
  executor: AgentExecutor,
): ExecutionBridge {
  bridge = new ExecutionBridge(ai, executor, {
    enabled: vscode.workspace.getConfiguration('singularity.execution').get<boolean>('enabled', false),
    autoPlanThreshold: vscode.workspace.getConfiguration('singularity.execution').get<'low' | 'medium' | 'high'>('autoPlanThreshold', 'medium'),
    maxConcurrentAgents: vscode.workspace.getConfiguration('singularity.execution').get<number>('maxConcurrentAgents', 8),
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('singularity.execution.shouldUseEngine', (goal: string) => {
      return bridge!.shouldUseEngine(String(goal ?? ''));
    }),
    vscode.commands.registerCommand('singularity.execution.run', async (req: {
      goal: string;
      sessionId: string;
      workspaceRoot: string;
      executionId?: string;
      maxConcurrentAgents?: number;
    }) => {
      const result = await bridge!.run({
        goal: req.goal,
        sessionId: req.sessionId,
        workspaceRoot: req.workspaceRoot,
        executionId: req.executionId,
        onTodoProjection: async (md) => {
          await vscode.commands.executeCommand('singularity.execution.projectTodo', req.sessionId, md);
        },
      });
      return {
        ok: result.ok,
        executionId: result.executionId,
        summary: result.summary,
        taskCount: result.plan.nodes.length,
        criticalPathLength: result.plan.estimates.criticalPathLength,
        appliedPaths: result.appliedPaths,
      };
    }),
    vscode.commands.registerCommand('singularity.execution.resume', async (executionId: string) => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      const result = await bridge!.resume(executionId, folder?.uri.fsPath ?? '', '');
      return {
        ok: result.ok,
        executionId: result.executionId,
        summary: result.summary,
        taskCount: result.plan.nodes.length,
        criticalPathLength: result.plan.estimates.criticalPathLength,
        appliedPaths: result.appliedPaths,
      };
    }),
    vscode.commands.registerCommand('singularity.execution.projectTodo', async (_sessionId: string, markdown: string) => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return;
      const uri = vscode.Uri.joinPath(folder.uri, 'todo.md');
      await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown, 'utf8'));
    }),
  );

  return bridge;
}

export function getExecutionBridge(): ExecutionBridge | undefined {
  return bridge;
}
