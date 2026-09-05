/**
 * Level 9 — Routing-Aware Context
 * Different intents include different segment packs.
 */

import type { PromptIntent, SegmentId } from '../types.js';

/** Always-included high-priority segments. */
const ALWAYS: SegmentId[] = ['system', 'userPrompt'];

const PACKS: Record<PromptIntent, SegmentId[]> = {
	RENAME: [...ALWAYS, 'selection', 'currentFile'],
	EDIT: [...ALWAYS, 'selection', 'currentFile', 'diagnostics', 'conversation'],
	DEBUG: [...ALWAYS, 'diagnostics', 'terminal', 'currentFile', 'conversation', 'selection'],
	EXPLAIN: [...ALWAYS, 'selection', 'currentFile', 'conversation', 'retrieval'],
	ARCHITECTURE: [
		...ALWAYS,
		'repository',
		'retrieval',
		'memory',
		'conversation',
		'agent',
	],
	SEARCH: [...ALWAYS, 'retrieval', 'repository', 'conversation'],
	TEST: [...ALWAYS, 'currentFile', 'selection', 'diagnostics', 'conversation'],
	REVIEW: [...ALWAYS, 'selection', 'currentFile', 'repository', 'conversation', 'diagnostics'],
	DOCUMENTATION: [...ALWAYS, 'currentFile', 'repository', 'conversation', 'memory'],
	AGENT: [
		...ALWAYS,
		'agent',
		'currentFile',
		'selection',
		'diagnostics',
		'terminal',
		'conversation',
		'retrieval',
		'memory',
		'repository',
	],
	PLAN: [...ALWAYS, 'agent', 'repository', 'retrieval', 'memory', 'conversation'],
	GENERAL: [
		...ALWAYS,
		'conversation',
		'currentFile',
		'selection',
		'retrieval',
		'diagnostics',
	],
};

export function segmentsForIntent(intent: PromptIntent): SegmentId[] {
	return [...(PACKS[intent] ?? PACKS.GENERAL)];
}

export function isSegmentAllowed(intent: PromptIntent, id: SegmentId): boolean {
	return segmentsForIntent(intent).includes(id);
}

/** Map common router / mode labels onto PromptIntent. */
export function normalizePromptIntent(raw: string | undefined): PromptIntent {
	const v = (raw ?? 'GENERAL').toUpperCase().replace(/[\s-]+/g, '_');
	const aliases: Record<string, PromptIntent> = {
		RENAME: 'RENAME',
		EDIT: 'EDIT',
		DEBUG: 'DEBUG',
		EXPLAIN: 'EXPLAIN',
		ARCHITECTURE: 'ARCHITECTURE',
		ARCHITECT: 'ARCHITECTURE',
		SEARCH: 'SEARCH',
		TEST: 'TEST',
		REVIEW: 'REVIEW',
		DOCUMENTATION: 'DOCUMENTATION',
		DOCS: 'DOCUMENTATION',
		AGENT: 'AGENT',
		PLAN: 'PLAN',
		GENERAL: 'GENERAL',
		CHAT: 'GENERAL',
		ASK: 'EXPLAIN',
	};
	return aliases[v] ?? 'GENERAL';
}
