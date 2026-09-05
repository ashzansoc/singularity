/**
 * Level 8 — Context Budget Optimizer (v2 priority list + Context Economy bands)
 */

import type { BudgetItem as V2BudgetItem, BudgetOptimizer, BudgetResult as V2BudgetResult } from '../interfaces/index.js';
import type { BudgetAllocationReport } from '../ir/types.js';
import type { SegmentId } from '../types.js';

/**
 * P0: system, user, selection, edited symbols, diagnostics, git
 * P1: callers/deps/tests/interfaces/current file
 * P2: repo map, project memory, recent conversation
 * P3: overview / old conversation / docs (drop first)
 */
export const BUDGET_PRIORITY_V2: Record<string, number> = {
	system: 0,
	user: 1,
	userPrompt: 1,
	selection: 2,
	currentFile: 3,
	function: 3,
	class: 3,
	interface: 3,
	symbol: 3,
	diagnostics: 4,
	diagnostic: 4,
	git: 4,
	retrieval: 5,
	tool: 5,
	file: 6,
	terminal: 6,
	repository: 7,
	memory: 7,
	conversation: 8,
	history: 8,
	summary: 9,
	agent: 10,
	metadata: 11,
	overview: 12,
	context: 8,
};

/** v1 segment priorities */
export const BUDGET_PRIORITY: Record<SegmentId, number> = {
	system: 0,
	userPrompt: 1,
	selection: 2,
	currentFile: 3,
	retrieval: 4,
	diagnostics: 5,
	terminal: 5,
	conversation: 6,
	agent: 7,
	repository: 8,
	memory: 9,
};

export function priorityBand(priority: number): 'p0' | 'p1' | 'p2' | 'p3' {
	if (priority <= 4) {
		return 'p0';
	}
	if (priority <= 6) {
		return 'p1';
	}
	if (priority <= 8) {
		return 'p2';
	}
	return 'p3';
}

export interface BudgetItem {
	id: SegmentId | string;
	tokenCount: number;
	text: string;
	truncatable?: boolean;
	priority?: number;
	role?: string;
}

export interface BudgetResult {
	kept: BudgetItem[];
	dropped: Array<SegmentId | string>;
	truncated: Array<SegmentId | string>;
	totalTokens: number;
	budgetTokens: number;
	allocation?: BudgetAllocationReport;
}

export interface BudgetOptions {
	budgetTokens: number;
	minTruncatedTokens?: number;
}

export function optimizeBudget(items: BudgetItem[], options: BudgetOptions): BudgetResult {
	const optimizer = new DefaultBudgetOptimizer();
	const mapped: V2BudgetItem[] = items.map((i) => ({
		id: String(i.id),
		priority:
			i.priority ??
			BUDGET_PRIORITY[i.id as SegmentId] ??
			BUDGET_PRIORITY_V2[String(i.id)] ??
			99,
		tokenCount: i.tokenCount,
		text: i.text,
		truncatable: i.truncatable,
	}));
	const result = optimizer.optimize(mapped, options.budgetTokens);
	const allocation = buildAllocationReport(
		items,
		result,
		mapped.map((m) => ({ id: m.id, priority: m.priority })),
	);
	return {
		kept: result.kept.map((k) => ({
			id: k.id,
			tokenCount: k.tokenCount,
			text: k.text,
			truncatable: k.truncatable,
			priority: k.priority,
		})),
		dropped: result.dropped,
		truncated: result.truncated,
		totalTokens: result.totalTokens,
		budgetTokens: result.budgetTokens,
		allocation,
	};
}

export function buildAllocationReport(
	original: BudgetItem[],
	result: V2BudgetResult,
	priorities: Array<{ id: string; priority: number }>,
): BudgetAllocationReport {
	const prio = new Map(priorities.map((p) => [p.id, p.priority]));
	const byRole: BudgetAllocationReport['byRole'] = {};
	const bands = { p0: 0, p1: 0, p2: 0, p3: 0 };
	const droppedSet = new Set(result.dropped);
	const truncSet = new Set(result.truncated);

	for (const item of original) {
		const id = String(item.id);
		const role = item.role ?? id;
		if (!byRole[role]) {
			byRole[role] = { kept: 0, dropped: 0, truncated: 0 };
		}
		const pr = prio.get(id) ?? item.priority ?? 99;
		const band = priorityBand(pr);
		if (droppedSet.has(id)) {
			byRole[role].dropped += item.tokenCount;
		} else if (truncSet.has(id)) {
			const kept = result.kept.find((k) => k.id === id);
			byRole[role].truncated += item.tokenCount;
			byRole[role].kept += kept?.tokenCount ?? 0;
			bands[band] += kept?.tokenCount ?? 0;
		} else {
			byRole[role].kept += item.tokenCount;
			bands[band] += item.tokenCount;
		}
	}

	return {
		budgetTokens: result.budgetTokens,
		totalTokens: result.totalTokens,
		byRole,
		droppedIds: result.dropped,
		truncatedIds: result.truncated,
		priorityBands: bands,
	};
}

export class DefaultBudgetOptimizer implements BudgetOptimizer {
	optimize(items: V2BudgetItem[], budgetTokens: number): V2BudgetResult {
		const budget = Math.max(16, budgetTokens);
		const minTrunc = 64;
		const sorted = [...items]
			.filter((i) => i.tokenCount > 0 && i.text.length > 0)
			.sort((a, b) => a.priority - b.priority);

		const kept: V2BudgetItem[] = [];
		const dropped: string[] = [];
		const truncated: string[] = [];
		let total = 0;

		for (const item of sorted) {
			if (total + item.tokenCount <= budget) {
				kept.push(item);
				total += item.tokenCount;
				continue;
			}
			const remaining = budget - total;
			if (item.truncatable && remaining >= minTrunc) {
				const ratio = remaining / item.tokenCount;
				const cutChars = Math.max(1, Math.floor(item.text.length * ratio));
				kept.push({
					...item,
					text: item.text.slice(0, cutChars) + '\n…[truncated]',
					tokenCount: remaining,
				});
				truncated.push(item.id);
				total = budget;
				continue;
			}
			dropped.push(item.id);
		}

		return { kept, dropped, truncated, totalTokens: total, budgetTokens: budget };
	}
}
