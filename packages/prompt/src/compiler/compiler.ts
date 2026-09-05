/**
 * Level 4 — Prompt Compiler
 * Canonical Context → Prompt IR (dedupe, order, budget, history compress).
 */

import { BUDGET_PRIORITY, optimizeBudget, type BudgetItem } from '../budget/optimizer.js';
import { applyCompressionToConversation } from '../compression/semantic.js';
import { estimateTokens, hashContent, hashObject } from '../hash.js';
import { segmentsForIntent } from '../routing/packs.js';
import {
	updateSegmentsFromContext,
	type SegmentedContextState,
} from '../segments/segment.js';
import type { CanonicalContext, SegmentId } from '../types.js';
import { materializeSegmentText } from '../types.js';
import type { PromptBlock, PromptIR } from './ir.js';

export interface CompileOptions {
	budgetTokens: number;
	/** Compress long conversation histories (L8). */
	compressConversation?: boolean;
	keepRecentTurns?: number;
	maxConversationTokens?: number;
}

const TRUNCATABLE: ReadonlySet<SegmentId> = new Set([
	'repository',
	'conversation',
	'retrieval',
	'memory',
	'terminal',
	'currentFile',
]);

const ROLE_FOR_SEGMENT: Partial<Record<SegmentId, PromptBlock['role']>> = {
	system: 'system',
	userPrompt: 'user',
	conversation: 'history',
	repository: 'context',
	retrieval: 'context',
	terminal: 'context',
	diagnostics: 'context',
	memory: 'context',
	agent: 'context',
	selection: 'context',
	currentFile: 'context',
};

export interface CompileResult {
	ir: PromptIR;
	segments: SegmentedContextState;
	context: CanonicalContext;
}

export function compilePrompt(
	input: CanonicalContext,
	options: CompileOptions,
	prevSegments?: SegmentedContextState,
): CompileResult {
	let ctx = { ...input, updatedAt: Date.now() };

	if (options.compressConversation !== false && ctx.conversation.length > 0) {
		const compressed = applyCompressionToConversation(
			ctx.conversation,
			ctx.conversationSummary,
			{
				keepRecentTurns: options.keepRecentTurns,
				maxConversationTokens: options.maxConversationTokens,
			},
		);
		ctx = {
			...ctx,
			conversation: compressed.conversation,
			conversationSummary: compressed.conversationSummary,
		};
	}

	const segments = updateSegmentsFromContext(prevSegments, ctx, { retainContent: true });
	const allowed = new Set(segmentsForIntent(ctx.intent));

	// Deduplicate identical non-empty segment bodies.
	const seenHashes = new Set<string>();
	const items: BudgetItem[] = [];
	for (const id of allowed) {
		const seg = segments.segments[id];
		const text = seg.content ?? materializeSegmentText(ctx, id);
		if (!text) {
			continue;
		}
		if (seenHashes.has(seg.hash)) {
			continue;
		}
		seenHashes.add(seg.hash);
		items.push({
			id,
			text,
			tokenCount: seg.tokenCount || estimateTokens(text),
			truncatable: TRUNCATABLE.has(id),
		});
	}

	const budgeted = optimizeBudget(items, { budgetTokens: options.budgetTokens });

	// Stable order for IR: system → context packs by priority → history → user
	const orderRank = (id: SegmentId): number => {
		if (id === 'system') {
			return 0;
		}
		if (id === 'conversation') {
			return 80;
		}
		if (id === 'userPrompt') {
			return 90;
		}
		return BUDGET_PRIORITY[id] ?? 50;
	};

	const ordered = [...budgeted.kept].sort(
		(a, b) => orderRank(a.id as SegmentId) - orderRank(b.id as SegmentId),
	);

	const blocks: PromptBlock[] = ordered.map((item, index) => {
		const segId = item.id as SegmentId;
		return {
			id: `${item.id}:${index}`,
			role: ROLE_FOR_SEGMENT[segId] ?? 'context',
			nodeIds: [],
			segmentIds: [segId],
			text: item.text,
			estimatedTokens: item.tokenCount,
			tokenCount: item.tokenCount,
			priority: BUDGET_PRIORITY[segId] ?? 99,
			hash: hashContent(item.text),
			dependencies: [],
			compressionLevel: 0,
			cacheBreakpoint: segId === 'system' || segId === 'repository',
		};
	});

	const irHash = hashObject({
		sessionId: ctx.sessionId,
		intent: ctx.intent,
		blocks: blocks.map((b) => b.hash),
		budget: options.budgetTokens,
	});

	const ir: PromptIR = {
		sessionId: ctx.sessionId,
		intent: ctx.intent,
		blocks,
		totalTokens: budgeted.totalTokens,
		budgetTokens: options.budgetTokens,
		droppedSegmentIds: budgeted.dropped as string[],
		irHash,
		compiledAt: Date.now(),
		compilerVersion: 1,
	};

	return { ir, segments, context: ctx };
}
