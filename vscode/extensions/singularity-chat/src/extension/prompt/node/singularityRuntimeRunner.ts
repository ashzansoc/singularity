/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type { ChatResponseStream } from 'vscode';
import {
	reportChatTurnStatus,
	startChatTurnStatusHeartbeat,
} from '../../../platform/endpoint/node/chatTurnStatus';
import { isDesignIntelligenceFrontendGoal } from '../../../platform/endpoint/node/frontendBuildPrompt';

export interface SingularityRuntimeEvent {
	kind: string;
	message: string;
	taskId?: string;
	data?: Record<string, unknown>;
}

export interface AgentTeamPayload {
	id: string;
	workflowId: string;
	mission: string;
	expanded?: boolean;
	summary: {
		total: number;
		completed: number;
		working: number;
		queued: number;
		blocked: number;
		failed: number;
		percent?: number;
		phaseLabel: string;
	};
	agents: Array<{
		agentId: string;
		taskId: string;
		role: string;
		title: string;
		deliverable: string;
		status: string;
		progressLabel?: string;
		progressPercent?: number;
		model?: string;
		activity?: string;
		blockedBy?: string;
	}>;
	verificationPhase?: boolean;
}

export interface SingularityRuntimeResult {
	ok: boolean;
	summary: string;
	synthesis?: string;
	error?: string;
	appliedPaths: string[];
	events: SingularityRuntimeEvent[];
	workflowId?: string;
	missionId?: string;
	executionMode?: string;
	agentTeam?: AgentTeamPayload;
	plan?: {
		id: string;
		taskCount: number;
		tasks: Array<{
			id: string;
			title: string;
			ownedPaths: string[];
			role?: string;
			deps?: string[];
			status?: string;
			deliverable?: string;
			assignedAgentId?: string;
		}>;
	};
}

export interface SingularityAiExports {
	runRuntime?: (
		req: {
			goal: string;
			projectSummary?: string;
			concurrency?: number;
			missionId?: string;
			cancelSignal?: AbortSignal;
		},
		onEvent?: (ev: SingularityRuntimeEvent) => void,
		onWorkflowSnapshot?: (payload: AgentTeamPayload) => void,
	) => Promise<SingularityRuntimeResult>;
}

/**
 * Multi-agent Runtime is disabled — all chat turns use the sequential agent
 * (Design Spec + skill + single implementer for UI; one agent otherwise).
 */
export function isSingularityRuntimeMode(
	_request: vscode.ChatRequest,
	_agentHint?: { agentName?: string; intentId?: string },
): boolean {
	return false;
}

/**
 * Only multi-file / multi-surface engineering goals enter the multi-agent path.
 * Trivial local edits and Q&A stay sequential (fast path) to protect TPS.
 */
export function shouldUseRuntimeForAgentGoal(goal: string): boolean {
	const g = goal.trim();
	if (g.length < 12) {
		return false;
	}
	if (/\b(no[- ]?runtime|no[- ]?dag|sequential only|just explain|single agent)\b/i.test(g)) {
		return false;
	}
	if (/\b(use (dag|runtime|subagents?|multi[- ]?agent)|parallel (workers|subagents?))\b/i.test(g)) {
		return true;
	}
	if (isTrivialLocalEdit(g)) {
		return false;
	}
	// Hello-world pages, landing screens, HTML games, etc. → Design Spec + skill, not 12 agents.
	if (isDesignIntelligenceFrontendGoal(g)) {
		return false;
	}
	if (
		/^(what|why|how|when|where|who|is|are|can|does|do|should|explain|describe|summarize|define)\b/i.test(
			g,
		) &&
		!/\b(implement|build|create|refactor|migrate|scaffold)\b/i.test(g)
	) {
		return false;
	}
	return /\b(implement|build|create|refactor|migrate|scaffold|wire(?:\s+up)?|integrate|auth(?:entication)?|oauth|dashboard|full[- ]?stack|frontend\b.*\bbackend|backend\b.*\bfrontend|multi[- ]?file|across (the )?(repo|codebase|app|modules?)|end[- ]to[- ]end|add (a |the )?(feature|api|auth)|new (feature|service|module))\b/i.test(
		g,
	);
}

/** Cheap gate: keep one-liner / single-file nits off the multi-agent path. */
function isTrivialLocalEdit(goal: string): boolean {
	if (goal.length > 200) {
		return false;
	}
	const fileMentions =
		goal.match(
			/[\w./@-]+\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|css|scss|json|md|vue|svelte)\b/gi,
		)?.length ?? 0;
	if (
		/\b(rename|typo|whitespace|indent|format|lint|this (line|variable|function|method)|one[- ]line|add (a )?comment)\b/i.test(
			goal,
		)
	) {
		return true;
	}
	if (
		fileMentions <= 1 &&
		goal.length < 90 &&
		/^(please\s+)?(add|fix|update|change|tweak|adjust)\b/i.test(goal) &&
		!/\b(feature|auth(?:entication)?|oauth|api|frontend|backend|migrate|refactor|across|dashboard|tests?|module|service|billing|payment)\b/i.test(
			goal,
		)
	) {
		return true;
	}
	return false;
}

export async function getSingularityAiApi(): Promise<SingularityAiExports | undefined> {
	const ext =
		vscode.extensions.getExtension<SingularityAiExports>('singularity.singularity-ai') ??
		vscode.extensions.getExtension<SingularityAiExports>('singularity-ai.singularity-ai');
	if (!ext) {
		return undefined;
	}
	try {
		const api = (await ext.activate()) as SingularityAiExports | undefined;
		return api ?? (ext.exports as SingularityAiExports | undefined);
	} catch {
		return ext.exports as SingularityAiExports | undefined;
	}
}

type AgentTeamStream = ChatResponseStream & {
	agentTeam?: (payload: AgentTeamPayload) => void;
};

function pushAgentTeam(stream: ChatResponseStream, payload: AgentTeamPayload): void {
	const s = stream as AgentTeamStream;
	if (typeof s.agentTeam === 'function') {
		s.agentTeam(payload);
		return;
	}
	stream.markdown(formatAgentTeamMarkdown(payload));
}

function formatAgentTeamMarkdown(payload: AgentTeamPayload): string {
	const s = payload.summary;
	const pct = s.percent !== undefined ? ` · ${s.percent}%` : '';
	const lines = [
		`✦ **Singularity Mission**`,
		`"${payload.mission.slice(0, 120)}${payload.mission.length > 120 ? '…' : ''}"`,
		'',
		`**${s.total} agents**${pct}`,
		`✓ ${s.completed} completed · ● ${s.working} working · ◌ ${s.queued} queued` +
			(s.blocked ? ` · ⚠ ${s.blocked} blocked` : '') +
			(s.failed ? ` · ✗ ${s.failed} failed` : ''),
		'',
		`_${s.phaseLabel}_`,
	];
	if (payload.expanded) {
		for (const a of payload.agents) {
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
			lines.push('', `${icon} **${a.agentId}** — ${a.role}`, `  ${a.activity ?? a.title}`, `  _Delivering: ${a.deliverable}_`);
		}
	}
	return lines.join('\n');
}

function reportRuntimeStatus(title: string, detail: string): void {
	reportChatTurnStatus(title, detail);
}

function statusFromRuntimeEvent(ev: SingularityRuntimeEvent): { title: string; detail: string } | undefined {
	const msg = (ev.message || '').trim();
	switch (ev.kind) {
		case 'plan_created':
			return { title: 'Runtime Engine', detail: msg || 'Plan ready' };
		case 'workflow_started':
			return { title: 'Assembling team', detail: msg || 'Creating specialist agents…' };
		case 'agent_created':
			return { title: 'Assembling team', detail: msg || 'Assigning agents…' };
		case 'agent_started':
		case 'subagent_started':
		case 'task_started':
			return { title: 'Agents working', detail: msg || 'Running specialist tasks…' };
		case 'agent_progress':
		case 'subagent_progress':
		case 'workflow_progress':
			return { title: 'Agents working', detail: msg || 'Making progress…' };
		case 'agent_completed':
		case 'subagent_completed':
		case 'task_done':
			return { title: 'Agents working', detail: msg || 'Task finished' };
		case 'workflow_verifying':
		case 'verify_started':
			return { title: 'Verifying', detail: msg || 'Checking results…' };
		case 'workflow_completed':
		case 'verify_done':
			return { title: 'Complete', detail: msg || 'Mission finished' };
		case 'workflow_failed':
		case 'run_failed':
		case 'verify_failed':
			return { title: 'Runtime Engine', detail: msg || 'Mission failed' };
		default:
			if (msg) {
				return { title: 'Runtime Engine', detail: msg };
			}
			return undefined;
	}
}

export async function runSingularityRuntimeInChat(
	goal: string,
	stream: ChatResponseStream,
	token: vscode.CancellationToken,
): Promise<{ ok: boolean; summary: string }> {
	reportRuntimeStatus('Runtime Engine', 'Planning mission…');

	try {
		void vscode.commands.executeCommand('singularity.ai.context.ingest', {
			text: goal,
			messageId: `runtime-${Date.now()}`,
		});
	} catch {
		/* continue */
	}

	const api = await getSingularityAiApi();
	if (!api?.runRuntime) {
		reportRuntimeStatus('Runtime Engine', 'Starting via command…');
		const result = (await vscode.commands.executeCommand('singularity.ai.runRuntime', {
			goal,
		})) as SingularityRuntimeResult | undefined;
		if (!result) {
			stream.markdown(
				'Runtime engine unavailable. Ensure the **Singularity AI** extension is enabled and reloaded.',
			);
			return { ok: false, summary: 'Runtime unavailable' };
		}
		if (result.agentTeam) {
			pushAgentTeam(stream, result.agentTeam);
		}
		stream.markdown(formatResultMarkdown(result));
		return { ok: result.ok, summary: truncateMsg(result.synthesis ?? result.summary, 400) };
	}

	const controller = new AbortController();
	const listener = token.onCancellationRequested(() => controller.abort());
	let result: SingularityRuntimeResult;
	let teamPanelId: string | undefined;
	let stopHeartbeat = startChatTurnStatusHeartbeat('Runtime Engine', 'Decomposing goal into agents…', 4_000);
	try {
		result = await api.runRuntime(
			{ goal, cancelSignal: controller.signal },
			(ev) => {
				if (token.isCancellationRequested) {
					return;
				}
				const status = statusFromRuntimeEvent(ev);
				if (status) {
					stopHeartbeat();
					stopHeartbeat = startChatTurnStatusHeartbeat(status.title, status.detail, 5_000);
					reportRuntimeStatus(status.title, status.detail);
				}
				if (ev.kind === 'workflow_started') {
					stream.progress('✦ Assembling agent team…');
					return;
				}
				if (ev.kind === 'workflow_verifying') {
					stream.progress('Running verification…');
					return;
				}
				if (ev.kind === 'workflow_completed' || ev.kind === 'workflow_failed') {
					stream.progress(ev.message);
				}
			},
			(payload) => {
				teamPanelId = payload.id;
				const s = payload.summary;
				const detail =
					s.working > 0
						? `${s.working} working · ${s.queued} queued · ${s.completed}/${s.total} done`
						: s.phaseLabel || `${s.completed}/${s.total} agents complete`;
				stopHeartbeat();
				stopHeartbeat = startChatTurnStatusHeartbeat('Agent team', detail, 5_000);
				reportRuntimeStatus('Agent team', detail);
				pushAgentTeam(stream, { ...payload, id: teamPanelId, expanded: payload.expanded ?? false });
			},
		);
	} finally {
		stopHeartbeat();
		listener.dispose();
	}

	if (result.synthesis) {
		stream.markdown(`\n\n${result.synthesis}`);
	} else {
		stream.markdown(formatResultMarkdown(result));
	}
	return { ok: result.ok, summary: truncateMsg(result.synthesis ?? result.summary, 400) };
}

function truncateMsg(s: string, n: number): string {
	const t = s.replace(/\s+/g, ' ').trim();
	return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

function formatResultMarkdown(result: SingularityRuntimeResult): string {
	const lines: string[] = [];
	lines.push(`\n\n# Mission ${result.ok ? 'complete' : 'failed'}`);
	if (result.plan) {
		lines.push(`\n## Team (${result.plan.taskCount} agents)`);
		for (const t of result.plan.tasks) {
			const role = t.role ? ` \`(${t.role})\`` : '';
			lines.push(`- **${t.assignedAgentId ?? t.id}**${role}: ${t.title}`);
		}
	}
	lines.push('\n## Summary');
	lines.push(truncateMsg(result.summary || '(empty)', 500));
	if (result.appliedPaths?.length) {
		lines.push('\n## Files changed');
		for (const p of result.appliedPaths.slice(0, 40)) {
			lines.push(`- ${p}`);
		}
	}
	if (result.error) {
		lines.push(`\n## Error\n${truncateMsg(result.error, 300)}`);
	}
	return lines.join('\n');
}
