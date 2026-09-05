/**
 * Level 1 — Canonical Context Object
 * Single source of truth for everything that may enter a prompt.
 */

import { estimateTokens, hashContent } from './hash.js';

/** Prompt routing intents that shape which context packs are included (L9). */
export type PromptIntent =
	| 'RENAME'
	| 'EDIT'
	| 'DEBUG'
	| 'EXPLAIN'
	| 'ARCHITECTURE'
	| 'SEARCH'
	| 'TEST'
	| 'REVIEW'
	| 'DOCUMENTATION'
	| 'AGENT'
	| 'PLAN'
	| 'GENERAL';

export type ConversationRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ConversationTurn {
	id: string;
	role: ConversationRole;
	content: string;
	createdAt: number;
	/** Optional tool call / result metadata. */
	name?: string;
	toolCallId?: string;
	tokenCount?: number;
}

export interface FileContextSlice {
	uri: string;
	languageId?: string;
	/** Full or truncated file text. */
	content: string;
	version?: number;
	/** Byte/char range when only a slice is attached. */
	range?: { startLine: number; endLine: number };
	tokenCount?: number;
}

export interface SelectionContext {
	uri: string;
	text: string;
	startLine: number;
	endLine: number;
	languageId?: string;
}

export interface RepositoryContext {
	workspaceId: string;
	rootPath?: string;
	branch?: string;
	/** Short overview / README digest. */
	summary?: string;
	/** Open / active files. */
	files: FileContextSlice[];
	/** Dependency graph edges as "from -> to" lines or JSON. */
	dependencyGraph?: string;
	/** Package / lockfile version fingerprint. */
	depsVersion?: string;
}

export interface RetrievalHit {
	uri: string;
	snippet: string;
	score?: number;
	source?: 'search' | 'embed' | 'symbol' | 'manual';
}

export interface DiagnosticItem {
	uri: string;
	severity: 'error' | 'warning' | 'info' | 'hint';
	message: string;
	line?: number;
	source?: string;
}

export interface TerminalSnippet {
	cwd?: string;
	command?: string;
	output: string;
	exitCode?: number;
	capturedAt?: number;
}

export interface MemoryItem {
	id: string;
	kind: 'user' | 'project' | 'agent' | 'long_term';
	text: string;
	updatedAt: number;
}

export interface AgentState {
	mode?: string;
	goals?: string[];
	plan?: string;
	todos?: Array<{ id: string; content: string; status: string }>;
	toolPermissions?: string[];
}

export interface UserPreferences {
	tone?: string;
	language?: string;
	verbosity?: 'low' | 'medium' | 'high';
	customInstructions?: string;
}

/**
 * Canonical Context — optimize once, render many times.
 */
export interface CanonicalContext {
	/** Stable id for the conversation / session. */
	sessionId: string;
	updatedAt: number;
	intent: PromptIntent;
	/** Free-form system instructions (mode / product). */
	systemPrompt: string;
	/** Latest user utterance (highest budget priority). */
	userPrompt: string;
	selection?: SelectionContext;
	currentFile?: FileContextSlice;
	conversation: ConversationTurn[];
	/** Optional rolling summary of older turns (L8). */
	conversationSummary?: string;
	repository: RepositoryContext;
	retrieval: RetrievalHit[];
	diagnostics: DiagnosticItem[];
	terminal: TerminalSnippet[];
	memories: MemoryItem[];
	agent: AgentState;
	preferences: UserPreferences;
}

export type SegmentId =
	| 'system'
	| 'repository'
	| 'conversation'
	| 'retrieval'
	| 'terminal'
	| 'diagnostics'
	| 'memory'
	| 'agent'
	| 'selection'
	| 'currentFile'
	| 'userPrompt';

export const ALL_SEGMENT_IDS: readonly SegmentId[] = [
	'system',
	'repository',
	'conversation',
	'retrieval',
	'terminal',
	'diagnostics',
	'memory',
	'agent',
	'selection',
	'currentFile',
	'userPrompt',
] as const;

export function createEmptyCanonicalContext(
	sessionId: string,
	partial?: Partial<CanonicalContext>,
): CanonicalContext {
	return {
		updatedAt: Date.now(),
		intent: 'GENERAL',
		systemPrompt: '',
		userPrompt: '',
		conversation: [],
		repository: {
			workspaceId: partial?.repository?.workspaceId ?? 'default',
			files: [],
		},
		retrieval: [],
		diagnostics: [],
		terminal: [],
		memories: [],
		agent: {},
		preferences: {},
		...partial,
		sessionId,
	};
}

/** Serialize a segment's textual payload for hashing / IR. */
export function materializeSegmentText(ctx: CanonicalContext, id: SegmentId): string {
	switch (id) {
		case 'system': {
			const parts = [ctx.systemPrompt, ctx.preferences.customInstructions ?? ''];
			if (ctx.preferences.tone) {
				parts.push(`Tone: ${ctx.preferences.tone}`);
			}
			if (ctx.preferences.verbosity) {
				parts.push(`Verbosity: ${ctx.preferences.verbosity}`);
			}
			return parts.filter(Boolean).join('\n\n');
		}
		case 'repository': {
			const repo = ctx.repository;
			const lines = [
				repo.summary ? `Summary:\n${repo.summary}` : '',
				repo.branch ? `Branch: ${repo.branch}` : '',
				repo.dependencyGraph ? `Dependencies:\n${repo.dependencyGraph}` : '',
				...repo.files.map(
					(f) =>
						`File ${f.uri}${f.range ? `:${f.range.startLine}-${f.range.endLine}` : ''}\n\`\`\`\n${f.content}\n\`\`\``,
				),
			];
			return lines.filter(Boolean).join('\n\n');
		}
		case 'conversation': {
			const summary = ctx.conversationSummary
				? `Earlier conversation summary:\n${ctx.conversationSummary}\n\n`
				: '';
			const turns = ctx.conversation
				.map((t) => `${t.role.toUpperCase()}: ${t.content}`)
				.join('\n\n');
			return summary + turns;
		}
		case 'retrieval':
			return ctx.retrieval
				.map((h) => `[${h.source ?? 'search'} ${h.score ?? ''}] ${h.uri}\n${h.snippet}`)
				.join('\n\n');
		case 'terminal':
			return ctx.terminal
				.map((t) => {
					const head = [t.cwd, t.command, t.exitCode !== undefined ? `exit ${t.exitCode}` : '']
						.filter(Boolean)
						.join(' | ');
					return `${head}\n${t.output}`;
				})
				.join('\n\n');
		case 'diagnostics':
			return ctx.diagnostics
				.map((d) => `${d.severity.toUpperCase()} ${d.uri}${d.line != null ? `:${d.line}` : ''} — ${d.message}`)
				.join('\n');
		case 'memory':
			return ctx.memories.map((m) => `[${m.kind}] ${m.text}`).join('\n\n');
		case 'agent': {
			const a = ctx.agent;
			const parts = [
				a.mode ? `Mode: ${a.mode}` : '',
				a.goals?.length ? `Goals:\n- ${a.goals.join('\n- ')}` : '',
				a.plan ? `Plan:\n${a.plan}` : '',
				a.todos?.length
					? `Todos:\n${a.todos.map((t) => `- [${t.status}] ${t.content}`).join('\n')}`
					: '',
			];
			return parts.filter(Boolean).join('\n\n');
		}
		case 'selection':
			if (!ctx.selection) {
				return '';
			}
			return `Selection ${ctx.selection.uri}:${ctx.selection.startLine}-${ctx.selection.endLine}\n\`\`\`\n${ctx.selection.text}\n\`\`\``;
		case 'currentFile':
			if (!ctx.currentFile) {
				return '';
			}
			return `Current file ${ctx.currentFile.uri}\n\`\`\`\n${ctx.currentFile.content}\n\`\`\``;
		case 'userPrompt':
			return ctx.userPrompt;
		default: {
			const _exhaustive: never = id;
			return _exhaustive;
		}
	}
}

export function segmentTokenCount(ctx: CanonicalContext, id: SegmentId): number {
	return estimateTokens(materializeSegmentText(ctx, id));
}

export function contextContentHash(ctx: CanonicalContext): string {
	const parts = ALL_SEGMENT_IDS.map((id) => `${id}:${hashContent(materializeSegmentText(ctx, id))}`);
	return hashContent(parts.join('|'));
}
