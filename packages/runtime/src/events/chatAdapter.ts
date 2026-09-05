/**
 * Maps WorkflowEventStore snapshots to chat UI payloads.
 */

import {
  buildAgentTeamSummary,
  type AgentTeamAgentRow,
  type AgentTeamSummary,
  type WorkflowSnapshot,
} from './store.js';

export interface ChatAgentTeamProgressPayload {
  kind: 'agentTeam';
  id: string;
  workflowId: string;
  mission: string;
  expanded: boolean;
  summary: AgentTeamSummary;
  agents: AgentTeamAgentRow[];
  verificationPhase?: boolean;
  metrics?: {
    filesAnalyzed?: number;
    filesChanged?: number;
    testsRun?: number;
    regressions?: number;
  };
}

export function snapshotToChatPayload(
  snapshot: WorkflowSnapshot,
  opts?: {
    panelId?: string;
    expanded?: boolean;
    verificationPhase?: boolean;
    metrics?: ChatAgentTeamProgressPayload['metrics'];
  },
): ChatAgentTeamProgressPayload {
  const phaseLabel =
    snapshot.workflow.phase === 'verifying'
      ? 'Running verification…'
      : snapshot.workflow.phase === 'synthesizing'
        ? 'Synthesizing outcome…'
        : snapshot.workflow.phase === 'completed'
          ? 'Mission complete'
          : snapshot.workflow.phase === 'failed'
            ? 'Mission failed'
            : snapshot.workflow.phase === 'cancelled'
              ? 'Mission cancelled'
              : snapshot.progress.label;

  return {
    kind: 'agentTeam',
    id: opts?.panelId ?? `agent-team-${snapshot.workflow.workflowId}`,
    workflowId: snapshot.workflow.workflowId,
    mission: snapshot.workflow.goal,
    expanded: opts?.expanded ?? false,
    summary: buildAgentTeamSummary(snapshot.plan, phaseLabel),
    agents: snapshot.agents,
    verificationPhase: opts?.verificationPhase,
    metrics: opts?.metrics,
  };
}

export function compactTeamMarkdown(payload: ChatAgentTeamProgressPayload): string {
  const s = payload.summary;
  const pct = s.percent !== undefined ? ` · ${s.percent}%` : '';
  const lines = [
    `✦ **Singularity Mission**`,
    `"${payload.mission.slice(0, 120)}${payload.mission.length > 120 ? '…' : ''}"`,
    ``,
    `**${s.total} agents**${pct}`,
    `✓ ${s.completed} completed · ● ${s.working} working · ◌ ${s.queued} queued` +
      (s.blocked ? ` · ⚠ ${s.blocked} blocked` : '') +
      (s.failed ? ` · ✗ ${s.failed} failed` : ''),
    ``,
    `_${s.phaseLabel}_`,
  ];
  if (payload.metrics) {
    const m = payload.metrics;
    const parts: string[] = [];
    if (m.filesAnalyzed !== undefined) {
      parts.push(`${m.filesAnalyzed} files analyzed`);
    }
    if (m.filesChanged !== undefined) {
      parts.push(`${m.filesChanged} files changed`);
    }
    if (m.testsRun !== undefined) {
      parts.push(`${m.testsRun} tests`);
    }
    if (m.regressions !== undefined) {
      parts.push(`${m.regressions} regressions`);
    }
    if (parts.length) {
      lines.push('', parts.join(' · '));
    }
  }
  return lines.join('\n');
}

export function expandedAgentsMarkdown(agents: AgentTeamAgentRow[]): string {
  return agents
    .map((a) => {
      const icon =
        a.status === 'completed'
          ? '✓'
          : a.status === 'working' || a.status === 'verifying'
            ? '●'
            : a.status === 'blocked'
              ? '⚠'
              : a.status === 'failed'
                ? '✗'
                : '◌';
      const progress = a.progressLabel ? ` · ${a.progressLabel}` : '';
      const blocked = a.blockedBy ? `\n  _Blocked: ${a.blockedBy}_` : '';
      return `${icon} **${a.agentId}** — ${a.role}\n  ${a.activity ?? a.title}${progress}\n  _Delivering: ${a.deliverable}_${blocked}`;
    })
    .join('\n\n');
}
