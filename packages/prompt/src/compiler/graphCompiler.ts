/**
 * Level 5 — Prompt Compiler v2 (graph working set → Prompt IR)
 */

import { BUDGET_PRIORITY_V2, DefaultBudgetOptimizer } from '../budget/optimizer.js';
import { IR_VERSION } from '../graph/types.js';
import { estimateTokens, sha256, sha256Object } from '../hash.js';
import type { CompileInput, PromptCompiler } from '../interfaces/index.js';
import type { PromptBlock, PromptBlockRole, PromptIR } from '../ir/types.js';

const TRUNCATABLE = new Set([
	'repository',
	'retrieval',
	'conversation',
	'memory',
	'git',
	'diagnostics',
	'file',
	'function',
]);

function roleForNodeKind(kind: string): PromptBlockRole {
	switch (kind) {
		case 'system':
			return 'system';
		case 'repository':
		case 'folder':
			return 'repository';
		case 'file':
		case 'function':
		case 'class':
		case 'interface':
		case 'symbol':
		case 'import':
		case 'export':
		case 'reference':
			return 'retrieval';
		case 'conversation':
		case 'summary':
			return 'conversation';
		case 'memory':
			return 'memory';
		case 'diagnostic':
			return 'diagnostics';
		case 'git':
			return 'git';
		case 'selection':
			return 'selection';
		case 'userPrompt':
			return 'user';
		case 'agent':
		case 'terminal':
			return 'retrieval';
		default:
			return 'retrieval';
	}
}

export class GraphPromptCompiler implements PromptCompiler {
	private readonly budget = new DefaultBudgetOptimizer();

	compile(input: CompileInput): PromptIR {
		const { graph, workingSet, systemPrompt, userPrompt, budgetTokens, sessionId, intent } =
			input;

		const items: Array<{
			id: string;
			role: PromptBlockRole;
			nodeIds: string[];
			text: string;
			priority: number;
			truncatable: boolean;
		}> = [];

		if (systemPrompt) {
			items.push({
				id: 'system',
				role: 'system',
				nodeIds: [],
				text: systemPrompt,
				priority: BUDGET_PRIORITY_V2.system ?? 0,
				truncatable: false,
			});
		}

		const byRole = new Map<string, string[]>();
		for (const block of workingSet.emittedBlocks) {
			const list = byRole.get(block.role) ?? [];
			list.push(...block.nodeIds);
			byRole.set(block.role, list);
		}
		for (const nodeId of workingSet.nodeIds) {
			const node = graph.getNode(nodeId);
			if (!node) {
				continue;
			}
			const role = roleForNodeKind(node.kind);
			const list = byRole.get(role) ?? [];
			if (!list.includes(nodeId)) {
				list.push(nodeId);
			}
			byRole.set(role, list);
		}

		for (const [role, nodeIds] of byRole) {
			const unique = [...new Set(nodeIds)];
			const texts = unique
				.map((id) => graph.materialize(id))
				.filter(Boolean);
			if (!texts.length) {
				continue;
			}
			const text = texts.join('\n\n');
			const priority =
				BUDGET_PRIORITY_V2[role] ??
				BUDGET_PRIORITY_V2[graph.getNode(unique[0]!)?.kind ?? ''] ??
				50;
			items.push({
				id: role,
				role: role as PromptBlockRole,
				nodeIds: unique,
				text,
				priority,
				truncatable: TRUNCATABLE.has(role) || TRUNCATABLE.has(graph.getNode(unique[0]!)?.kind ?? ''),
			});
		}

		if (userPrompt) {
			items.push({
				id: 'user',
				role: 'user',
				nodeIds: [],
				text: userPrompt,
				priority: BUDGET_PRIORITY_V2.user ?? 1,
				truncatable: false,
			});
		}

		// Deduplicate by content hash
		const seen = new Set<string>();
		const deduped = items.filter((it) => {
			const h = sha256(it.text);
			if (seen.has(h)) {
				return false;
			}
			seen.add(h);
			return true;
		});

		const budgeted = this.budget.optimize(
			deduped.map((it) => ({
				id: it.id,
				priority: it.priority,
				tokenCount: estimateTokens(it.text),
				text: it.text,
				truncatable: it.truncatable,
			})),
			budgetTokens,
		);

		const orderRank = (role: string): number => {
			if (role === 'system') {
				return 0;
			}
			if (role === 'conversation') {
				return 80;
			}
			if (role === 'user') {
				return 90;
			}
			return BUDGET_PRIORITY_V2[role] ?? 50;
		};

		const keptMeta = new Map(deduped.map((d) => [d.id, d]));
		const ordered = [...budgeted.kept].sort(
			(a, b) => orderRank(a.id) - orderRank(b.id),
		);

		const blocks: PromptBlock[] = ordered.map((item, index) => {
			const meta = keptMeta.get(item.id);
			const role = (meta?.role ?? item.id) as PromptBlockRole;
			const hash = sha256(item.text);
			return {
				id: `${role}:${index}`,
				role,
				nodeIds: meta?.nodeIds ?? [],
				text: item.text,
				estimatedTokens: item.tokenCount,
				tokenCount: item.tokenCount,
				priority: item.priority,
				hash,
				dependencies: meta?.nodeIds ?? [],
				compressionLevel: workingSet.compressedIds.length ? 1 : 0,
				cacheBreakpoint: role === 'system' || role === 'repository',
			};
		});

		const irHash = sha256Object({
			sessionId,
			intent,
			blocks: blocks.map((b) => b.hash),
			budget: budgetTokens,
			v: IR_VERSION,
		});

		return {
			sessionId,
			intent,
			blocks,
			totalTokens: budgeted.totalTokens,
			budgetTokens,
			droppedSegmentIds: budgeted.dropped,
			droppedNodeIds: budgeted.dropped,
			irHash,
			compiledAt: Date.now(),
			compilerVersion: IR_VERSION,
			metadata: {
				retrievedCount: workingSet.nodeIds.length,
			},
		};
	}
}
