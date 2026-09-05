/**
 * Chat agent ↔ Context / Prompt Engine bridge.
 *
 * Chat agent responsibilities (critical path):
 *   understand prompt → route → (optional Design Spec) → deliver output
 *
 * LangExtract is a separate background agent. Chat only schedules it and may
 * inject already-written context JSON. Never await the sidecar here.
 */
import { Raw } from '@vscode/prompt-tsx';
import { commands, type Progress } from 'vscode';
import { toTextParts } from '../../chat/common/globalStringUtils';
import type { ChatResponseProgressPart, ChatResponseReferencePart } from 'vscode';
import { promptLooksLikeFrontendBuild } from './frontendBuildPrompt';
import { reportSingularityRequestPhase } from '../../chat/node/singularityTokenUsage';

export interface SingularityPromptCompileRequest {
	prompt: string;
	intent?: string;
	/** Skip Neural Relay / context inject (already done on the first tool round). */
	skipContextInject?: boolean;
	systemPrompt?: string;
	selectionText?: string;
	activeUri?: string;
	openFiles?: string[];
	fileContent?: string;
	languageId?: string;
}

export interface SingularityPromptCompileResult {
	ok: true;
	messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
	irHash: string;
	totalTokens: number;
	fromCache: boolean;
	contextEngine?: boolean;
}

interface ContextRelevantResult {
	ok?: boolean;
	structuredContext?: string;
	systemBlock?: string;
	prompt_block?: string;
	engines?: string[];
	neuralRelay?: { enabled?: boolean; usedRelay?: boolean };
}

interface WikiRunResult {
	ok?: boolean;
	status?: { initialized?: boolean; pageCount?: number; sourceCount?: number; wikiRoot?: string };
	systemBlock?: string;
	draft?: string;
	hits?: unknown[];
}

/**
 * Greetings, acknowledgements, and assistant-identity questions.
 * Skip Context / Architecture / Memory / Outcome / Intelligence / Wiki / Prompt Engine.
 * Keep in sync with isLangExtractSkipPrompt in singularity-ai.
 */
export function isTrivialChatPrompt(prompt: string): boolean {
	const raw = prompt.trim();
	if (!raw || raw.length > 120) {
		return false;
	}
	const p = raw.toLowerCase().replace(/\s+/g, ' ');
	if (/\b(code|file|bug|error|fix|implement|build|create|refactor|function|component|page|api|design|landing)\b/.test(p)) {
		return false;
	}
	if (/^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|bye|goodbye)[ !.]*$/i.test(p)) {
		return true;
	}
	if (/^what is singularity\b/.test(p) || /^(what|who) (is|are) (this )?(ide|assistant|product|app)\b/.test(p)) {
		return true;
	}
	if (/\b(how (are|have|is) (you|things)|how('s|s) it going|what'?s up|who are you|what can you (do|tell|start)|good (morning|afternoon|evening))\b/.test(p)) {
		return true;
	}
	if (/\b(you tell me|tell me what (to|you can|we (can|should))|what should (we|i) (start|do|work)|where (do|should) (we|i) start|suggest (a |something )?(to )?(start|do))\b/.test(p)) {
		return true;
	}
	if (!/\b(you|your|yourself)\b/.test(p)) {
		return false;
	}
	return (
		(/\b(who|what|which)\b/.test(p) && /\b(model|llm|name|ai|assistant)\b/.test(p))
		|| (/\bare you\b/.test(p) && /\b(powered|using|based|running|built|chatgpt|claude|gpt|deepseek|gemini|singularity|openai|anthropic)\b/.test(p))
		|| /\b(what are you|what'?s your name)\b/.test(p)
		|| (/\bdo you use\b/.test(p) && /\b(gpt|claude|deepseek|gemini|openai|anthropic|singularity)\b/.test(p))
	);
}

/**
 * Instant reply for greetings / identity — no network. DeepSeek Flash was taking
 * 5–8s for "hello", which feels like the agent is stuck.
 */
/**
 * True when the main agent cannot answer until a workspace tool or engine
 * result is in. Everything else answers immediately; engines run in the
 * background agent and must not appear in the chat thinking UI.
 */
export function promptNeedsBlockingToolOrEngine(
	prompt: string,
	extras?: { hasAttachments?: boolean },
): boolean {
	if (extras?.hasAttachments) {
		return true;
	}
	const raw = prompt.trim();
	if (!raw) {
		return false;
	}
	if (isTrivialChatPrompt(raw)) {
		return false;
	}
	const p = raw.toLowerCase();
	if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|css|scss|json|md|vue|svelte)\b/.test(p)) {
		return true;
	}
	if (/\b(in this (file|project|repo|codebase|workspace)|the (code|file|function|component|error|bug)|my (code|app|project|repo))\b/.test(p)) {
		return true;
	}
	if (/\b(run (the )?tests?|git (status|diff|log|commit)|search the (repo|codebase)|read (the )?file|open (the )?file)\b/.test(p)) {
		return true;
	}
	// Connected tools / connectors — never answer these with a plan-only turn.
	if (/\b(notion|slack|linear|jira|figma|canva|github|gitlab|sentry|mcp|connectors?)\b/.test(p)) {
		return true;
	}
	if (/\b(can you access|do you have access|are you connected|is .+ connected)\b/.test(p)) {
		return true;
	}
	if (/\b(ppt|pptx|powerpoint|presentation|spreadsheet|xlsx|docx)\b/.test(p)) {
		return true;
	}
	if (/\b(move|import|export|upload|convert|sync|publish)\b/.test(p) && /\b(to|into|from|as)\b/.test(p)) {
		return true;
	}
	if (/\b(give me (the |a )?link|share (the |a )?link|editable (design|link|copy))\b/.test(p)) {
		return true;
	}
	if (/\b(bug|error|exception|stack trace|failing test|doesn't compile|does not compile|type error)\b/.test(p)) {
		return true;
	}
	if (
		/\b(fix|debug|refactor|implement|edit|patch|migrate|rename|delete|scaffold|create)\b/.test(p)
		&& /\b(file|code|function|class|component|page|here|this|repo|project|workspace|codebase)\b/.test(p)
	) {
		return true;
	}
	// Greenfield UI / game / app builds need file tools — not chat-only code dumps.
	if (promptLooksLikeFrontendBuild(raw)) {
		return true;
	}
	// Project seed / demo / env credentials — answer requires searching the repo.
	if (/\b(what|where) (is|are) (the )?(demo|test|default|seed|sample|staging|dev)\b/.test(p)
		&& /\b(id|password|passcode|credentials|login|username|api.?key|secret|token)\b/.test(p)) {
		return true;
	}
	if (/\b(demo|test|default|seed|sample)\s+(id|user(?:name)?|login|password|credentials|account)\b/.test(p)) {
		return true;
	}
	return false;
}

/**
 * Project lookup questions need repo context but should not block the UI for the
 * full Neural Relay budget (30s). Cap context wait at 5s for these prompts.
 */
export function promptPrefersShortContextWait(prompt: string): boolean {
	const p = prompt.trim().toLowerCase();
	if (!p) {
		return false;
	}
	if (/\b(what|where) (is|are) (the )?(demo|test|default|seed|sample|staging|dev)\b/.test(p)
		&& /\b(id|password|passcode|credentials|login|username|api.?key|secret|token)\b/.test(p)) {
		return true;
	}
	return /\b(demo|test|default|seed|sample)\s+(id|user(?:name)?|login|password|credentials|account)\b/.test(p);
}

export function chatRequestNeedsBlockingTools(request: { prompt?: string; references?: readonly unknown[]; toolReferences?: readonly unknown[] }): boolean {
	const hasAttachments = (request.toolReferences?.length ?? 0) > 0
		|| (request.references ?? []).some(isExplicitChatAttachment);
	return promptNeedsBlockingToolOrEngine(request.prompt ?? '', { hasAttachments });
}

function isExplicitChatAttachment(ref: unknown): boolean {
	if (!ref || typeof ref !== 'object') {
		return false;
	}
	const r = ref as { id?: string; kind?: string; range?: unknown };
	if (r.kind === 'implicit') {
		return false;
	}
	if (typeof r.id === 'string' && /implicit/i.test(r.id)) {
		return false;
	}
	if (r.range) {
		return true;
	}
	if (typeof r.id === 'string' && /^(vscode\.)?(file|folder|directory|codebase|selection)\b/i.test(r.id)) {
		return true;
	}
	return false;
}

export function localTrivialChatReply(prompt: string): string {
	const p = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
	if (/^(thanks|thank you)[ !.]*$/i.test(p)) {
		return "You're welcome. What should we look at next?";
	}
	if (/^(ok|okay|cool|nice|great)[ !.]*$/i.test(p)) {
		return 'Sounds good. Send the next task whenever you are ready.';
	}
	if (/^(bye|goodbye)[ !.]*$/i.test(p)) {
		return 'Bye — I will be here when you come back.';
	}
	if (/\bhow (are|have|is) (you|things)\b/.test(p) || /how('s|s) it going/.test(p) || /what'?s up/.test(p)) {
		return "Doing well. What do you want to work on?";
	}
	if (/^what is singularity\b/.test(p) || /^(what|who) (is|are) (this )?(ide|assistant|product|app)\b/.test(p) || /\bwho are you\b/.test(p) || /\bwhat are you\b/.test(p) || /what'?s your name/.test(p)) {
		return "I'm Singularity, the AI coding assistant in this IDE. Ask me to explain, edit, or build something in your workspace.";
	}
	if (/\b(model|llm)\b/.test(p) || (/\bare you\b/.test(p) && /\b(powered|using|based|running|built|chatgpt|claude|gpt|deepseek|gemini|singularity)\b/.test(p))) {
		return "I am Singularity Auto. I pick a model per request — greetings stay local so they are instant; coding work is routed to Flash or Pro.";
	}
	if (/\bwhat can you (do|tell|start)\b/.test(p) || /\b(you tell me|what should (we|i) (start|do|work)|where (do|should) (we|i) start)\b/.test(p)) {
		return "I can start with the file you have open, a bug you want fixed, or a feature to build. I already keep project context in the background — I do not need to scan the repo for a question like this. What should we do first?";
	}
	return "Hello — I'm Singularity. What would you like to work on?";
}

/**
 * Schedule LangExtract / Context Engine on the background agent.
 * Never touches the chat thinking stream.
 */
function scheduleLangExtractBackground(prompt: string, intent?: string): void {
	const messageId = `singularity-${intent ?? 'chat'}-${Date.now()}`;
	void commands.executeCommand('singularity.ai.context.ingest', {
		text: prompt,
		messageId,
	}).then(undefined, () => { /* never block chat */ });
}

/**
 * Singularity Brain: continuous conversation memory + "sync everything" triggers.
 * Fire-and-forget; the Brain never blocks or fails the chat turn.
 */
async function observeBrainActivity(
	messages: Raw.ChatMessage[],
	req: SingularityPromptCompileRequest,
): Promise<void> {
	try {
		const textOf = (m: Raw.ChatMessage): string =>
			typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((p) => (p as { text?: string })?.text ?? '').join('') : '';
		// The previous assistant reply rides along in the message history —
		// observing prompt + last reply gives the Brain the full exchange.
		const lastAssistant = [...messages].reverse().find((m) => m.role === Raw.ChatRole.Assistant);
		const combined = [req.prompt, lastAssistant ? textOf(lastAssistant) : '']
			.filter(Boolean)
			.join('\n\n')
			.slice(0, 16_000);
		if (combined) {
			void commands
				.executeCommand('singularity.ai.brain.observeChat', { text: combined, sourceRef: `chat:${Date.now()}` })
				.then(undefined, () => undefined);
		}
		if (brainSyncPhraseRequested(req.prompt)) {
			void commands.executeCommand('singularity.brain.syncEverything', { source: 'chat-phrase' }).then(undefined, () => undefined);
		}
		void commands
			.executeCommand('singularity.ai.globalMemory.extractFromChat', { text: combined })
			.then(undefined, () => undefined);
	} catch {
		/* brain is optional */
	}
}

/** True when the user asks for a deep repo sync in natural language. */
function brainSyncPhraseRequested(prompt: string): boolean {
	const p = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
	return (
		/\b(sync|ingest|index)\b.{0,24}\b(everything|entire repo|whole repo|all of it|full repo)\b/.test(p) ||
		/\bgo through (the )?(entire|whole) repo\b/.test(p)
	);
}

/** User identity / profile questions — answer from global memory, never external MCP. */
export function promptNeedsGlobalMemory(prompt: string): boolean {
	const p = prompt.trim().toLowerCase().replace(/\s+/g, ' ');
	if (!p) {
		return false;
	}
	if (/\b(who am i|who i am|do you know (who )?i am|do you know me|remember me|tell me about me|about myself)\b/.test(p)) {
		return true;
	}
	if (/\b(what('s| is) my name|what is my name|who is my|what do you know about me)\b/.test(p)) {
		return true;
	}
	if (/\b(am i your creator|who created you|who made singularity|who made you)\b/.test(p)) {
		return true;
	}
	if (/\b(check|read|look at|use|open) (your )?(memory|memories|user-?profile)\b/.test(p)) {
		return true;
	}
	return false;
}

/** Fetch global user memory (Brain + profile files) for identity questions. */
async function loadGlobalMemorySystemBlock(prompt: string): Promise<string> {
	try {
		const result = (await Promise.race([
			commands.executeCommand('singularity.ai.globalMemory.block', { task: prompt, scope: 'identity' }),
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 900)),
		])) as { ok?: boolean; block?: string } | undefined;
		return result?.ok ? (result.block ?? '') : '';
	} catch {
		return '';
	}
}

async function injectGlobalMemorySystem(
	messages: Raw.ChatMessage[],
	prompt: string,
): Promise<Raw.ChatMessage[]> {
	const profileBlock = await loadGlobalMemorySystemBlock(prompt);
	const chunks = [
		'SINGULARITY IDENTITY — answer immediately from profile below or `<userIdentity>` at conversation start.',
		'Rules: do NOT call the memory tool; do NOT mention topic notes (canva-imports.md, etc.); do NOT use Notion or other MCP.',
	];
	if (profileBlock.trim()) {
		chunks.push(profileBlock);
	} else {
		chunks.push('No profile snapshot in this turn — check `<userIdentity>` in the first message. If empty, say you do not know yet.');
	}
	const system: Raw.ChatMessage = {
		role: Raw.ChatRole.System,
		content: toTextParts(chunks.join('\n\n')),
	};
	const systems = messages.filter((m) => m.role === Raw.ChatRole.System);
	const rest = messages.filter((m) => m.role !== Raw.ChatRole.System);
	return [system, ...systems, ...rest];
}

/** Fetch a compact Brain knowledge block for the current prompt (≤900ms budget). */
async function loadBrainSystemBlock(prompt: string): Promise<string | undefined> {
	try {
		const result = (await Promise.race([
			commands.executeCommand('singularity.ai.brain.relevant', { task: prompt }),
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 900)),
		])) as { ok?: boolean; block?: string } | undefined;
		return result?.ok && result.block ? result.block : undefined;
	} catch {
		return undefined;
	}
}

/**
 * How long Singularity should wait for Neural Relay + project context.
 *
 * Cache-first policy: when relay is enabled, wait for the full relay budget
 * (timeoutMs + 1s, capped at 30s) so Nemotron-selected files land on turn 1.
 * - Relay off → 400ms cached-context peek.
 * - NEURAL_RELAY_SHORT_WAIT=1 → legacy 1.5s fire-and-forget (relay may finish later).
 * - SINGULARITY_CONTEXT_WAIT_MS env override wins when valid (>0).
 */
export function neuralRelayContextWaitMs(status?: { enabled?: boolean; timeoutMs?: number }): number {
	if (status?.enabled === false) {
		return 400;
	}
	const timeout = Number(status?.timeoutMs);
	const cap = Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout + 1_000, 30_000) : 30_000;
	const envOverride = Number(process.env.SINGULARITY_CONTEXT_WAIT_MS);
	const requested =
		Number.isFinite(envOverride) && envOverride > 0
			? envOverride
			: process.env.NEURAL_RELAY_SHORT_WAIT === '1'
				? 1_500
				: cap;
	return Math.max(400, Math.min(requested, cap));
}

/**
 * True when a context race fired before the relay finished — used to report the
 * late-persist path in telemetry without changing behavior.
 */
export function contextWaitExpired(result: unknown): boolean {
	return result === undefined;
}

/**
 * Inject already-written Project Context (+ optional wiki + cached architecture).
 * Waits for Neural Relay when enabled so Nemotron-selected files reach DeepSeek.
 * Architecture workers / SQLite / embeddings are never awaited here.
 */
async function injectProjectContextSystem(
	messages: Raw.ChatMessage[],
	prompt: string,
	_progress?: Progress<ChatResponseReferencePart | ChatResponseProgressPart>,
): Promise<Raw.ChatMessage[]> {
	try {
		const status = (await Promise.race([
			commands.executeCommand('singularity.ai.neuralRelay.status'),
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 250)),
		])) as { enabled?: boolean; timeoutMs?: number } | undefined;
		const waitMs = promptPrefersShortContextWait(prompt)
			? Math.min(5_000, neuralRelayContextWaitMs(status))
			: neuralRelayContextWaitMs(status);
		if (status?.enabled !== false) {
			reportSingularityRequestPhase('Resolving Context', 'Neural Relay → Finding context…');
		}
		const result = (await Promise.race([
			commands.executeCommand('singularity.ai.context.relevant', {
				task: prompt,
				includeIntelligence: true,
			}),
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), waitMs)),
		])) as ContextRelevantResult | undefined;
		if (result === undefined && status?.enabled !== false) {
			// Relay still running — its result persists for later turns (never lost).
			reportSingularityRequestPhase(
				'DeepSeek',
				'DeepSeek → Coding… (context resolving in background)',
			);
		}
		const block =
			result?.structuredContext ||
			result?.prompt_block ||
			result?.systemBlock;
		const wikiBlock = await loadWikiSystemBlock(prompt);
		const brainBlock = await loadBrainSystemBlock(prompt);
		const chunks: string[] = [];
		if (block) {
			chunks.push(
				[
					'Singularity Project Context Engine — authoritative structured project state.',
					'Prefer explicit requirements, hard constraints, and prohibitions over speculation.',
					'Never violate active prohibitions or hard constraints.',
					block,
				].join('\n'),
			);
		}
		if (brainBlock) {
			chunks.push(brainBlock);
		}
		if (wikiBlock) {
			chunks.push(wikiBlock);
		}
		if (!chunks.length) {
			reportSingularityRequestPhase('DeepSeek', 'DeepSeek → Coding…');
			return messages;
		}
		const system: Raw.ChatMessage = {
			role: Raw.ChatRole.System,
			content: toTextParts(chunks.join('\n\n')),
		};
		const systems = messages.filter((m) => m.role === Raw.ChatRole.System);
		const rest = messages.filter((m) => m.role !== Raw.ChatRole.System);
		if (result?.neuralRelay?.usedRelay) {
			reportSingularityRequestPhase('Building Context', 'Neural Relay → Context found');
		}
		reportSingularityRequestPhase('DeepSeek', 'DeepSeek → Coding…');
		return [system, ...systems, ...rest];
	} catch {
		return messages;
	}
}

async function loadWikiSystemBlock(prompt: string): Promise<string | undefined> {
	try {
		const result = (await Promise.race([
			commands.executeCommand('singularity.ai.wiki.run', { operation: 'status' }),
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 300)),
		])) as WikiRunResult | undefined;
		if (!result?.status?.initialized) {
			return undefined;
		}
		const queried = (await Promise.race([
			commands.executeCommand('singularity.ai.wiki.run', {
				operation: 'search',
				text: prompt,
				limit: 6,
			}),
			new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 400)),
		])) as { ok?: boolean; hits?: Array<{ title?: string; relPath?: string; score?: number; excerpt?: string }> } | undefined;
		const hits = queried?.hits ?? [];
		const lines = [
			'SINGULARITY LLM WIKI — persistent compounding knowledge base.',
			'Read wiki/index.md first. Never modify raw/. File good grounded answers back.',
			`pages ${result.status.pageCount ?? 0} · sources ${result.status.sourceCount ?? 0} · ${result.status.wikiRoot ?? ''}`,
		];
		if (hits.length) {
			lines.push('RELEVANT PAGES:');
			for (const h of hits.slice(0, 6)) {
				lines.push(`- [[${h.title ?? ''}]] (${h.relPath ?? ''}) ${h.excerpt ?? ''}`);
			}
		}
		return lines.join('\n');
	} catch {
		return undefined;
	}
}

/**
 * Main agent stays detached from engines:
 * - Always kick LangExtract / wiki ingest on the background agent
 * - Only wait to inject cached context when the question cannot be answered without it
 */
export async function maybeEnrichMessagesWithPromptEngine(
	messages: Raw.ChatMessage[],
	req: SingularityPromptCompileRequest,
	_enabled: boolean,
	progress?: Progress<ChatResponseReferencePart | ChatResponseProgressPart>,
): Promise<Raw.ChatMessage[]> {
	if (!req.prompt) {
		return messages;
	}

	if (req.skipContextInject) {
		return messages;
	}

	if (isTrivialChatPrompt(req.prompt)) {
		return messages;
	}

	scheduleLangExtractBackground(req.prompt, req.intent);

	// Singularity Brain — fire-and-forget conversation memory + sync triggers.
	void observeBrainActivity(messages, req);

	if (promptNeedsGlobalMemory(req.prompt)) {
		return injectGlobalMemorySystem(messages, req.prompt);
	}

	if (messagesAlreadyHaveProjectContext(messages)) {
		return messages;
	}

	const agentTurn = /agent|edit/i.test(req.intent ?? '');
	if (!promptNeedsBlockingToolOrEngine(req.prompt) && !agentTurn) {
		return messages;
	}

	return injectProjectContextSystem(messages, req.prompt, progress);
}

function messagesAlreadyHaveProjectContext(messages: Raw.ChatMessage[]): boolean {
	return messages.some((m) => {
		const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
		return text.includes('Project Context Engine') || text.includes('Project Intelligence');
	});
}
