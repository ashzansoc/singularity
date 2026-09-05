/**
 * Level 9 — Provider Adapters
 * Prompt IR → provider-shaped chat messages.
 */

import type { PromptBlock, PromptIR, RenderedMessage, RenderedPrompt } from '../ir/types.js';
import type { ProviderAdapter } from '../interfaces/index.js';
import { buildProviderCacheHints } from '../providerCache/hints.js';
import { normalizeProviderKind, type ProviderKind } from './types.js';

function joinBlocks(blocks: PromptBlock[], sep = '\n\n'): string {
	return blocks.map((b) => b.text).filter(Boolean).join(sep);
}

const SYSTEMISH = new Set(['system', 'repository', 'metadata']);
/** Stable project context — kept in system prefix for provider cache. */
const STABLE_CONTEXT = new Set(['memory', 'tool']);
const VOLATILE_CONTEXT = new Set([
	'retrieval',
	'diagnostics',
	'git',
	'selection',
	'context',
	'agent',
]);
const HISTORYISH = new Set(['conversation', 'history']);

function partition(ir: PromptIR): {
	system: PromptBlock[];
	stableContext: PromptBlock[];
	volatileContext: PromptBlock[];
	history: PromptBlock[];
	user: PromptBlock[];
} {
	return {
		system: ir.blocks.filter((b) => SYSTEMISH.has(b.role)),
		stableContext: ir.blocks.filter((b) => STABLE_CONTEXT.has(b.role)),
		volatileContext: ir.blocks.filter((b) => VOLATILE_CONTEXT.has(b.role)),
		history: ir.blocks.filter((b) => HISTORYISH.has(b.role)),
		user: ir.blocks.filter((b) => b.role === 'user'),
	};
}

/**
 * Stable prefix first: system → tools/rules/repo → project memory →
 * then volatile retrieval/task → conversation package → user.
 */
function baseMessages(ir: PromptIR): RenderedMessage[] {
	const { system, stableContext, volatileContext, history, user } = partition(ir);
	const messages: RenderedMessage[] = [];

	// Stable prefix (cache breakpoint friendly)
	const stableText = joinBlocks([...system, ...stableContext]);
	if (stableText) {
		messages.push({ role: 'system', content: stableText });
	}

	const volatileText = joinBlocks(volatileContext);
	if (volatileText) {
		messages.push({
			role: 'user',
			content: `[Current task context]\n${volatileText}`,
		});
		messages.push({
			role: 'assistant',
			content: 'Understood. I will use the task context above.',
		});
	}

	if (history.length) {
		messages.push({
			role: 'user',
			content: joinBlocks(history).includes('TASK')
				? joinBlocks(history)
				: `[Conversation package]\n${joinBlocks(history)}`,
		});
		messages.push({
			role: 'assistant',
			content: 'Understood. I will use the conversation package above.',
		});
	}

	const userText = joinBlocks(user) || ir.blocks.find((b) => b.role === 'user')?.text || '';
	messages.push({ role: 'user', content: userText || '(empty)' });

	return messages;
}

function withCacheExtras(
	messages: RenderedMessage[],
	provider: ProviderKind,
	ir: PromptIR,
): RenderedPrompt {
	const hints = buildProviderCacheHints(ir, provider);
	const out = messages.map((m, i) => {
		if (i === 0 && m.role === 'system' && hints.cacheControl) {
			return {
				...m,
				providerExtras: {
					cache_control: hints.cacheControl,
				},
			};
		}
		return m;
	});
	return {
		provider,
		messages: out,
		cacheHints: {
			...(hints.cacheControl ? { cacheControl: hints.cacheControl } : {}),
			...(hints.promptCacheKey ? { promptCacheKey: hints.promptCacheKey } : {}),
			...(hints.prefixHash ? { prefixHash: hints.prefixHash } : {}),
		},
		tokenEstimate: ir.totalTokens,
	};
}

export function renderClaude(ir: PromptIR): RenderedPrompt {
	return withCacheExtras(baseMessages(ir), 'claude', ir);
}

export function renderGpt(ir: PromptIR): RenderedPrompt {
	return withCacheExtras(baseMessages(ir), 'gpt', ir);
}

export function renderGemini(ir: PromptIR): RenderedPrompt {
	const messages = baseMessages(ir);
	if (messages[0]?.role === 'system') {
		messages[0] = {
			...messages[0],
			providerExtras: {
				...(messages[0].providerExtras ?? {}),
				systemInstruction: messages[0].content,
			},
		};
	}
	return withCacheExtras(messages, 'gemini', ir);
}

export function renderQwen(ir: PromptIR): RenderedPrompt {
	return withCacheExtras(baseMessages(ir), 'qwen', ir);
}

export function renderLocal(ir: PromptIR): RenderedPrompt {
	return withCacheExtras(baseMessages(ir), 'local', ir);
}

export function renderOpenRouter(ir: PromptIR): RenderedPrompt {
	return withCacheExtras(baseMessages(ir), 'openrouter', ir);
}

export function renderOllama(ir: PromptIR): RenderedPrompt {
	return withCacheExtras(baseMessages(ir), 'ollama', ir);
}

export function renderVllm(ir: PromptIR): RenderedPrompt {
	return withCacheExtras(baseMessages(ir), 'vllm', ir);
}

export function renderLmStudio(ir: PromptIR): RenderedPrompt {
	return withCacheExtras(baseMessages(ir), 'lmstudio', ir);
}

export function renderForProvider(ir: PromptIR, providerRaw: string | ProviderKind): RenderedPrompt {
	const provider = normalizeProviderKind(String(providerRaw));
	switch (provider) {
		case 'claude':
		case 'anthropic':
			return renderClaude(ir);
		case 'gpt':
		case 'openai':
		case 'azure':
		case 'generic':
			return renderGpt(ir);
		case 'gemini':
		case 'google':
			return renderGemini(ir);
		case 'qwen':
		case 'alibaba':
			return renderQwen(ir);
		case 'openrouter':
			return renderOpenRouter(ir);
		case 'ollama':
			return renderOllama(ir);
		case 'vllm':
			return renderVllm(ir);
		case 'lmstudio':
			return renderLmStudio(ir);
		case 'local':
			return renderLocal(ir);
		default:
			return renderGpt(ir);
	}
}

export class RegistryProviderAdapter implements ProviderAdapter {
	constructor(readonly kind: string) {}
	render(ir: PromptIR): RenderedPrompt {
		return renderForProvider(ir, this.kind);
	}
}
