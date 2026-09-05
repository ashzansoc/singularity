import * as vscode from 'vscode';
import type { RuntimeEvent } from '@singularity/runtime';
import type { SingularityAI } from '@singularity/router';
import {
  runRuntimeInIde,
  type RunRuntimeRequest,
  type RunRuntimeResponse,
} from './runtimeBridge.js';

/**
 * Chat participant for DAG / Runtime.
 *
 * Runtime subagent integration is paused — Agent mode stays sequential.
 * Re-enable by restoring the previous handler from git and flipping
 * RUNTIME_SUBAGENT_INTEGRATION_ENABLED in the Singularity extension.
 */
export function registerRuntimeChatParticipant(
  context: vscode.ExtensionContext,
  _getAI: () => SingularityAI | undefined,
): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant(
    'singularity.dag',
    async (
      request: vscode.ChatRequest,
      _chatContext: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      _token: vscode.CancellationToken,
    ): Promise<vscode.ChatResult> => {
      stream.markdown(
        '**Runtime subagent / DAG execution is paused.** Use default **Agent** mode for sequential coding.',
      );
      if (request.prompt?.trim()) {
        stream.markdown(`\n\nYour goal was:\n\n> ${request.prompt.trim()}`);
      }
      return {};
    },
  );

  participant.iconPath = new vscode.ThemeIcon('server-process');
  context.subscriptions.push(participant);
  return participant;
}

export function formatRuntimeMarkdown(result: RunRuntimeResponse): string {
  const lines: string[] = [];
  lines.push(`\n\n# DAG Runtime (${result.ok ? 'ok' : 'failed'})`);
  if (result.plan) {
    lines.push(`\n## Plan (${result.plan.taskCount} subagents)`);
    for (const t of result.plan.tasks) {
      const role = t.role ? ` \`(${t.role})\`` : '';
      const deps = t.deps?.length ? ` ← ${t.deps.join(', ')}` : '';
      const status = t.status ? ` [${t.status}]` : '';
      lines.push(
        `- **${t.id}**${role}${status}: ${t.title}${deps} — \`${t.ownedPaths.join('`, `') || '∅'}\``,
      );
    }
    const mermaid = tasksToMermaid(result.plan.tasks);
    if (mermaid) {
      lines.push(`\n\`\`\`mermaid\n${mermaid}\n\`\`\``);
    }
  }
  lines.push('\n## Summary');
  lines.push(result.summary);
  if (result.usage) {
    lines.push(
      `\n## Usage\n- tokens in/out: ${result.usage.inputTokens}/${result.usage.outputTokens}\n- est. cost: $${result.usage.estimatedCost.toFixed(4)}\n- latency: ${result.usage.latencyMs}ms`,
    );
  }
  if (result.verification) {
    lines.push(`\n## Verification\n${result.verification.summary}`);
  }
  if (result.appliedPaths?.length) {
    lines.push('\n## Files applied');
    for (const p of result.appliedPaths) {
      lines.push(`- ${p}`);
    }
  }
  if (result.error) {
    lines.push(`\n## Error\n${result.error}`);
  }
  return lines.join('\n');
}

function tasksToMermaid(
  tasks: Array<{ id: string; title?: string; deps?: string[]; role?: string }>,
): string {
  const lines = ['flowchart TD'];
  for (const t of tasks) {
    const label = `${t.role ?? 'task'}: ${t.id}`.replace(/"/g, "'");
    lines.push(`  ${sanitizeId(t.id)}["${label}"]`);
  }
  for (const t of tasks) {
    for (const d of t.deps ?? []) {
      lines.push(`  ${sanitizeId(d)} --> ${sanitizeId(t.id)}`);
    }
  }
  return lines.join('\n');
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

export type SingularityAiApi = {
  runRuntime: (
    req: RunRuntimeRequest & {
      /** Cancellation from chat UI propagated into engine + provider calls. */
      signal?: AbortSignal;
    },
    onEvent?: (ev: RuntimeEvent) => void,
    onWorkflowSnapshot?: (payload: unknown) => void,
  ) => Promise<RunRuntimeResponse>;
};

/** Kept for API consumers that still call runRuntime via the extension export. */
export { runRuntimeInIde };
