/**
 * Level 8 — Semantic Compression
 * Old conversation → Summary + Recent Turns (keeps context size stable).
 */

import { estimateTokens } from '../hash.js';
import type { ConversationTurn } from '../types.js';

export interface CompressionResult {
	summary: string;
	recentTurns: ConversationTurn[];
	droppedTurnIds: string[];
	tokensBefore: number;
	tokensAfter: number;
}

export interface CompressionOptions {
	/** Keep at least this many newest turns verbatim. */
	keepRecentTurns?: number;
	/** Soft token budget for the conversation segment. */
	maxConversationTokens?: number;
}

/**
 * Compress conversation without calling an LLM — extractive summary of older turns.
 * Callers may replace `summary` with an LLM-generated summary later.
 */
export function compressConversation(
	turns: ConversationTurn[],
	options: CompressionOptions = {},
): CompressionResult {
	const keepRecent = options.keepRecentTurns ?? 6;
	const maxTokens = options.maxConversationTokens ?? 4_000;

	const tokensBefore = turns.reduce(
		(n, t) => n + (t.tokenCount ?? estimateTokens(t.content)),
		0,
	);

	if (turns.length <= keepRecent) {
		return {
			summary: '',
			recentTurns: turns,
			droppedTurnIds: [],
			tokensBefore,
			tokensAfter: tokensBefore,
		};
	}

	const recent = turns.slice(-keepRecent);
	const older = turns.slice(0, -keepRecent);
	const summary = summarizeTurnsExtractive(older);
	let recentTokens = recent.reduce((n, t) => n + (t.tokenCount ?? estimateTokens(t.content)), 0);
	const droppedTurnIds = older.map((t) => t.id);

	// If still over budget, trim oldest recent turns (keep at least the latest turn).
	const kept = [...recent];
	while (kept.length > 1) {
		const summaryTokens = estimateTokens(summary);
		if (summaryTokens + recentTokens <= maxTokens) {
			break;
		}
		const removed = kept.shift()!;
		recentTokens -= removed.tokenCount ?? estimateTokens(removed.content);
		droppedTurnIds.push(removed.id);
	}

	return {
		summary,
		recentTurns: kept,
		droppedTurnIds,
		tokensBefore,
		tokensAfter: estimateTokens(summary) + recentTokens,
	};
}

function summarizeTurnsExtractive(turns: ConversationTurn[]): string {
	const lines: string[] = ['[Compressed earlier turns]'];
	for (const t of turns) {
		const preview = t.content.replace(/\s+/g, ' ').trim().slice(0, 160);
		lines.push(`- ${t.role}: ${preview}${t.content.length > 160 ? '…' : ''}`);
	}
	return lines.join('\n');
}

/** Apply compression onto a conversation array + optional existing summary. */
export function applyCompressionToConversation(
	turns: ConversationTurn[],
	existingSummary: string | undefined,
	options?: CompressionOptions,
): { conversation: ConversationTurn[]; conversationSummary: string } {
	const result = compressConversation(turns, options);
	const mergedSummary = [existingSummary, result.summary].filter(Boolean).join('\n\n');
	return {
		conversation: result.recentTurns,
		conversationSummary: mergedSummary,
	};
}
