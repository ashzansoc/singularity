/**
 * Prompt Simulation Layer
 * Evaluates Prompt IR before cache write / provider adapter.
 * Provider-independent dry-run: structure checks, budget, render shape, risk scores.
 */

import { renderForProvider } from '../adapters/registry.js';
import { normalizeProviderKind } from '../adapters/types.js';
import type {
	PromptSimulateInput,
	PromptSimulator,
	SimulationIssue,
	SimulationReport,
} from '../interfaces/v3.js';
import type { PromptBlock, PromptIR } from '../ir/types.js';

export class DefaultPromptSimulator implements PromptSimulator {
	simulate(input: PromptSimulateInput): SimulationReport {
		const started = Date.now();
		const issues: SimulationIssue[] = [];
		let ir = cloneIr(input.ir);
		let repaired = false;

		// --- structural checks ---
		if (!ir.blocks.length) {
			issues.push({
				code: 'empty_ir',
				severity: 'error',
				message: 'Prompt IR has no blocks',
			});
		}

		const userBlocks = ir.blocks.filter((b) => b.role === 'user');
		if (!userBlocks.length || !userBlocks.some((b) => b.text.trim())) {
			issues.push({
				code: 'missing_user',
				severity: 'error',
				message: 'Missing non-empty user block; injecting user prompt',
			});
			ir = injectUserBlock(ir, input.userPrompt);
			repaired = true;
		}

		const emptyBlocks = ir.blocks.filter((b) => !b.text.trim());
		if (emptyBlocks.length) {
			issues.push({
				code: 'empty_blocks',
				severity: 'warning',
				message: `Dropping ${emptyBlocks.length} empty block(s)`,
			});
			ir = {
				...ir,
				blocks: ir.blocks.filter((b) => b.text.trim()),
				totalTokens: ir.blocks
					.filter((b) => b.text.trim())
					.reduce((n, b) => n + b.estimatedTokens, 0),
			};
			repaired = true;
		}

		if (ir.totalTokens > input.budgetTokens) {
			issues.push({
				code: 'over_budget',
				severity: 'warning',
				message: `IR tokens ${ir.totalTokens} exceed budget ${input.budgetTokens}`,
			});
			ir = trimToBudget(ir, input.budgetTokens);
			repaired = true;
		}

		// Duplicate role bodies
		const seen = new Set<string>();
		const dupIds: string[] = [];
		for (const b of ir.blocks) {
			const key = `${b.role}:${b.hash}`;
			if (seen.has(key)) {
				dupIds.push(b.id);
			}
			seen.add(key);
		}
		if (dupIds.length) {
			issues.push({
				code: 'duplicate_blocks',
				severity: 'info',
				message: `Removing ${dupIds.length} duplicate block(s)`,
			});
			const drop = new Set(dupIds);
			ir = {
				...ir,
				blocks: ir.blocks.filter((b) => !drop.has(b.id)),
			};
			repaired = true;
		}

		// Broken dependency refs
		const ids = new Set(ir.blocks.map((b) => b.id));
		for (const b of ir.blocks) {
			const bad = b.dependencies.filter((d) => d.startsWith('block:') && !ids.has(d));
			if (bad.length) {
				issues.push({
					code: 'dangling_deps',
					severity: 'info',
					message: `Block ${b.id} has dangling deps`,
					blockId: b.id,
				});
			}
		}

		// --- dry-run provider render ---
		const provider = normalizeProviderKind(input.provider);
		let dryRunMessageCount = 0;
		let estimatedRenderTokens = ir.totalTokens;
		try {
			const rendered = renderForProvider(ir, provider);
			dryRunMessageCount = rendered.messages.length;
			estimatedRenderTokens = rendered.tokenEstimate || ir.totalTokens;
			if (!rendered.messages.some((m) => m.role === 'user')) {
				issues.push({
					code: 'render_no_user',
					severity: 'error',
					message: 'Dry-run render produced no user message',
				});
			}
			if (rendered.messages.some((m) => !m.content?.trim())) {
				issues.push({
					code: 'render_empty_message',
					severity: 'warning',
					message: 'Dry-run render contains empty message content',
				});
			}
		} catch (e) {
			issues.push({
				code: 'render_failed',
				severity: 'error',
				message: e instanceof Error ? e.message : 'Dry-run render failed',
			});
		}

		const errorCount = issues.filter((i) => i.severity === 'error').length;
		const warningCount = issues.filter((i) => i.severity === 'warning').length;

		const baseSuccess =
			input.estimatedAnswerConfidence ??
			Math.min(1, (ir.averageQuality ?? 40) / 100);
		const regenBase =
			input.estimatedRegenerationProbability ?? 1 - baseSuccess;

		const predictedSuccess = clamp01(
			baseSuccess - errorCount * 0.25 - warningCount * 0.05 + (repaired ? 0.05 : 0),
		);
		const predictedRegeneration = clamp01(
			regenBase + errorCount * 0.2 + warningCount * 0.05,
		);

		// After successful repair + dry-run, treat as pass (errors that were fixed don't block).
		const blockingErrors = issues.filter(
			(i) =>
				i.severity === 'error' &&
				!(repaired && (i.code === 'missing_user' || i.code === 'empty_ir')),
		);
		const passed =
			blockingErrors.length === 0 &&
			dryRunMessageCount > 0 &&
			ir.blocks.some((b) => b.role === 'user' && b.text.trim());

		return {
			passed,
			repaired,
			ir,
			issues,
			predictedSuccess,
			predictedRegeneration,
			estimatedRenderTokens,
			dryRunMessageCount,
			simulationMs: Date.now() - started,
		};
	}
}

function cloneIr(ir: PromptIR): PromptIR {
	return {
		...ir,
		blocks: ir.blocks.map((b) => ({ ...b, dependencies: [...b.dependencies], nodeIds: [...b.nodeIds] })),
		droppedSegmentIds: [...ir.droppedSegmentIds],
		droppedNodeIds: ir.droppedNodeIds ? [...ir.droppedNodeIds] : undefined,
		metadata: ir.metadata ? { ...ir.metadata } : undefined,
		fingerprint: ir.fingerprint ? { ...ir.fingerprint, embedding: [...ir.fingerprint.embedding] } : undefined,
		graph: ir.graph
			? {
					roots: [...ir.graph.roots],
					blocks: { ...ir.graph.blocks },
					edges: [...ir.graph.edges],
				}
			: undefined,
	};
}

function injectUserBlock(ir: PromptIR, userPrompt: string): PromptIR {
	const text = userPrompt || '(empty)';
	const block: PromptBlock = {
		id: 'block:user',
		role: 'user',
		nodeIds: [],
		text,
		estimatedTokens: Math.max(1, Math.ceil(text.length / 4)),
		tokenCount: Math.max(1, Math.ceil(text.length / 4)),
		priority: 1,
		hash: `sim-user-${text.length}`,
		dependencies: [],
		compressionLevel: 0,
		importance: 1,
	};
	const blocks = [...ir.blocks.filter((b) => b.role !== 'user'), block];
	return {
		...ir,
		blocks,
		totalTokens: blocks.reduce((n, b) => n + b.estimatedTokens, 0),
	};
}

/** Drop lowest-importance non-user/system blocks until under budget. */
function trimToBudget(ir: PromptIR, budget: number): PromptIR {
	const protectedRoles = new Set(['system', 'user']);
	let blocks = [...ir.blocks];
	let total = blocks.reduce((n, b) => n + b.estimatedTokens, 0);
	const sortable = blocks
		.filter((b) => !protectedRoles.has(b.role))
		.sort((a, b) => (a.importance ?? 0) - (b.importance ?? 0) || a.estimatedTokens - b.estimatedTokens);

	const drop = new Set<string>();
	for (const b of sortable) {
		if (total <= budget) {
			break;
		}
		drop.add(b.id);
		total -= b.estimatedTokens;
	}
	blocks = blocks.filter((b) => !drop.has(b.id));
	return {
		...ir,
		blocks,
		totalTokens: blocks.reduce((n, b) => n + b.estimatedTokens, 0),
		droppedNodeIds: [...(ir.droppedNodeIds ?? []), ...drop],
	};
}

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}
