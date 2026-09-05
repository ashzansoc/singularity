/**
 * Context Economy report — measurable intelligence-per-token telemetry.
 */

import type { BudgetAllocationReport, PromptBlock, PromptFingerprint, PromptIR } from '../ir/types.js';

export interface ContextEconomyReport {
	task: string;
	intent: string;
	inputTokens: {
		byRole: Record<string, number>;
		total: number;
	};
	cachedTokensEstimate: number;
	freshTokensEstimate: number;
	modelId?: string;
	tier?: string;
	outputTokens?: number;
	estimatedCostUsd?: number;
	contextEfficiency: number;
	filesRetrieved: number;
	symbolsRetrieved: number;
	filesIndexed?: number;
	budget?: BudgetAllocationReport;
	fingerprintSha256?: string;
	blockFingerprints?: PromptFingerprint['blockFingerprints'];
	cacheLayer?: string;
	fromCache: boolean;
}

export function buildEconomyReport(input: {
	ir: PromptIR;
	prompt?: string;
	modelId?: string;
	tier?: string;
	outputTokens?: number;
	estimatedCostUsd?: number;
	filesIndexed?: number;
	cacheLayer?: string;
	fromCache?: boolean;
	cachedPrefixTokens?: number;
}): ContextEconomyReport {
	const byRole: Record<string, number> = {};
	for (const b of input.ir.blocks) {
		byRole[b.role] = (byRole[b.role] ?? 0) + (b.tokenCount || b.estimatedTokens);
	}
	const total = input.ir.totalTokens || Object.values(byRole).reduce((a, n) => a + n, 0);
	const cached = input.cachedPrefixTokens ?? estimateCachedPrefix(input.ir.blocks);
	const fresh = Math.max(0, total - cached);
	const symbolsRetrieved = input.ir.blocks
		.filter((b) => b.role === 'retrieval')
		.reduce((n, b) => n + (b.nodeIds?.length ?? 0), 0);
	const filesRetrieved = new Set(
		input.ir.blocks
			.filter((b) => b.role === 'retrieval' || b.role === 'repository')
			.flatMap((b) => b.nodeIds ?? []),
	).size;

	return {
		task: (input.prompt ?? '').slice(0, 200),
		intent: input.ir.intent,
		inputTokens: { byRole, total },
		cachedTokensEstimate: cached,
		freshTokensEstimate: fresh,
		modelId: input.modelId,
		tier: input.tier,
		outputTokens: input.outputTokens,
		estimatedCostUsd: input.estimatedCostUsd,
		contextEfficiency: total > 0 ? Math.min(1, cached / total + (1 - fresh / Math.max(total, 1)) * 0.5) : 1,
		filesRetrieved,
		symbolsRetrieved,
		filesIndexed: input.filesIndexed,
		budget: input.ir.metadata?.budgetAllocation,
		fingerprintSha256: input.ir.fingerprint?.sha256,
		blockFingerprints: input.ir.fingerprint?.blockFingerprints,
		cacheLayer: input.cacheLayer,
		fromCache: input.fromCache ?? false,
	};
}

function estimateCachedPrefix(blocks: PromptBlock[]): number {
	return blocks
		.filter((b) => b.cacheBreakpoint)
		.reduce((n, b) => n + (b.tokenCount || b.estimatedTokens), 0);
}

/** Format a compact markdown footer for chat UI. */
export function formatEconomyMarkdown(report: ContextEconomyReport): string {
	const roles = Object.entries(report.inputTokens.byRole)
		.map(([role, tokens]) => `  ${role.padEnd(16)} ${tokens}`)
		.join('\n');
	return [
		'```',
		`Task: ${report.task || '(none)'}`,
		`Intent: ${report.intent}`,
		'Input tokens:',
		roles,
		`  ${'total'.padEnd(16)} ${report.inputTokens.total}`,
		`Cached (est.): ${report.cachedTokensEstimate}`,
		`Fresh (est.):  ${report.freshTokensEstimate}`,
		`Model: ${report.modelId ?? 'n/a'} (${report.tier ?? '?'})`,
		`Output: ${report.outputTokens ?? 'n/a'}`,
		`Cost est.: $${(report.estimatedCostUsd ?? 0).toFixed(4)}`,
		`Efficiency: ${Math.round(report.contextEfficiency * 100)}%`,
		`Retrieved: ${report.symbolsRetrieved} symbols / ${report.filesRetrieved} files`,
		'```',
	].join('\n');
}
