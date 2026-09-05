/**
 * Feature 6 — Multi-Stage Prompt Compiler
 * Collect → Rank → Resolve deps → Budget → IR graph → (render external)
 */

import { WeightedKnapsackBudgetOptimizer } from '../budget/knapsack.js';
import { IR_VERSION } from '../graph/types.js';
import { estimateTokens, sha256, sha256Object } from '../hash.js';
import type {
	MultiStageCompileInput,
	MultiStageCompileResult,
	MultiStagePromptCompiler,
	ScoredContextCandidate,
} from '../interfaces/v3.js';
import type { PromptBlock, PromptBlockRole, PromptIR, PromptIRGraph } from '../ir/types.js';
import { buildPromptFingerprint } from '../learning/snapshots.js';
import { mergePredictedCandidates } from '../intelligence/contextIntelligence.js';

function roleForKind(kind: string): PromptBlockRole {
	switch (kind) {
		case 'system':
			return 'system';
		case 'repository':
		case 'folder':
			return 'repository';
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
		case 'tool':
			return kind === 'tool' ? 'tool' : 'retrieval';
		default:
			return 'retrieval';
	}
}

export class MultiStagePromptCompilerImpl implements MultiStagePromptCompiler {
	private readonly knapsack = new WeightedKnapsackBudgetOptimizer();

	async compile(input: MultiStageCompileInput): Promise<MultiStageCompileResult> {
		const timings: Record<string, number> = {};

		// Stage 1 — Candidate Collection (+ predicted missing)
		let t = Date.now();
		let intelligence = mergePredictedCandidates(
			input.intelligence,
			input.graph,
			await Promise.resolve(
				input.embedder.embed(input.userPrompt + '\n' + input.systemPrompt),
			),
		);
		timings.candidateCollection = Date.now() - t;

		// Stage 2 — Candidate Ranking (already sorted by intelligence; re-assert)
		t = Date.now();
		const ranked = [...intelligence.scored].sort(
			(a, b) => b.score.finalScore - a.score.finalScore,
		);
		timings.candidateRanking = Date.now() - t;

		// Stage 3 — Dependency Resolution (expand required deps into candidate set)
		t = Date.now();
		const resolved = resolveDependencies(ranked, input.graph);
		timings.dependencyResolution = Date.now() - t;

		// Stage 4 — Budget Optimization (knapsack)
		t = Date.now();
		const knapsack = this.knapsack.optimize(
			resolved.map((c) => ({
				id: c.nodeId,
				value: c.score.finalScore,
				weight: c.tokenCount,
				required: c.required,
				dependencies: c.dependencies,
				text: c.text,
				meta: { role: roleForKind(c.node.kind), quality: c.score.finalScore },
			})),
			input.budgetTokens,
		);
		timings.budgetOptimization = Date.now() - t;

		// Stage 5 — Prompt IR Construction (graph)
		t = Date.now();
		const selected = knapsack.selected;
		const byId = new Map(resolved.map((c) => [c.nodeId, c]));

		const systemBlock = makeBlock({
			id: 'block:system',
			role: 'system',
			text: input.systemPrompt || 'You are a helpful coding assistant.',
			nodeIds: [],
			priority: 0,
			importance: 1,
			dependencies: [],
		});

		const grouped = new Map<PromptBlockRole, ScoredContextCandidate[]>();
		for (const item of selected) {
			const c = byId.get(item.id);
			if (!c) {
				continue;
			}
			const role = roleForKind(c.node.kind);
			if (role === 'system' || role === 'user') {
				continue;
			}
			const list = grouped.get(role) ?? [];
			list.push(c);
			grouped.set(role, list);
		}

		const blocks: PromptBlock[] = [systemBlock];
		const graphBlocks: Record<string, PromptBlock> = {
			[systemBlock.id]: systemBlock,
		};
		const edges: PromptIRGraph['edges'] = [];

		for (const [role, nodes] of grouped) {
			const text = nodes.map((n) => n.text).filter(Boolean).join('\n\n');
			if (!text) {
				continue;
			}
			const id = `block:${role}`;
			const avgImp =
				nodes.reduce((s, n) => s + n.score.importance, 0) / Math.max(1, nodes.length);
			const avgRet =
				nodes.reduce((s, n) => s + n.score.retrievalScore, 0) / Math.max(1, nodes.length);
			const block = makeBlock({
				id,
				role,
				text,
				nodeIds: nodes.map((n) => n.nodeId),
				priority: Math.round(100 - (nodes[0]?.score.finalScore ?? 0)),
				importance: avgImp,
				retrievalConfidence: avgRet,
				dependencies: role === 'retrieval' ? ['block:system'] : ['block:system'],
			});
			blocks.push(block);
			graphBlocks[id] = block;
			edges.push({ from: 'block:system', to: id, kind: 'contains' });
		}

		const userBlock = makeBlock({
			id: 'block:user',
			role: 'user',
			text: input.userPrompt,
			nodeIds: [],
			priority: 1,
			importance: 1,
			dependencies: blocks.filter((b) => b.role !== 'user').map((b) => b.id),
		});
		blocks.push(userBlock);
		graphBlocks[userBlock.id] = userBlock;
		for (const b of blocks) {
			if (b.id !== userBlock.id) {
				edges.push({ from: b.id, to: userBlock.id, kind: 'follows' });
			}
		}

		const order = ['system', 'repository', 'retrieval', 'memory', 'diagnostics', 'git', 'selection', 'conversation', 'tool', 'metadata', 'user'];
		blocks.sort(
			(a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.priority - b.priority,
		);

		const totalTokens = blocks.reduce((s, b) => s + b.estimatedTokens, 0);
		const averageQuality =
			selected.reduce((s, x) => s + x.value, 0) / Math.max(1, selected.length);

		const irHash = sha256Object({
			sessionId: input.sessionId,
			intent: input.intent,
			blocks: blocks.map((b) => b.hash),
			budget: input.budgetTokens,
			v: IR_VERSION,
		});

		const graphIr: PromptIRGraph = {
			roots: ['block:system'],
			blocks: graphBlocks,
			edges,
		};

		const ir: PromptIR = {
			sessionId: input.sessionId,
			intent: input.intent,
			blocks,
			graph: graphIr,
			totalTokens,
			budgetTokens: input.budgetTokens,
			droppedSegmentIds: knapsack.dropped,
			droppedNodeIds: knapsack.dropped,
			averageQuality,
			irHash,
			compiledAt: Date.now(),
			compilerVersion: IR_VERSION,
			metadata: {
				retrievedCount: selected.length,
				stageTimingsMs: timings,
				...input.fingerprintExtras,
			},
		};

		const fingerprint = await buildPromptFingerprint({
			ir,
			embedder: input.embedder,
			repositoryVersion: input.fingerprintExtras?.repoHash ?? 'unknown',
			conversationVersion: input.fingerprintExtras?.conversationHash ?? 'unknown',
			memoryVersion: input.fingerprintExtras?.memoryHash ?? 'unknown',
			dependencyVersion: input.fingerprintExtras?.gitHash ?? 'unknown',
		});
		ir.fingerprint = fingerprint;
		ir.metadata = {
			...ir.metadata,
			repoHash: input.fingerprintExtras?.repoHash,
			conversationHash: input.fingerprintExtras?.conversationHash,
			memoryHash: input.fingerprintExtras?.memoryHash,
			gitHash: input.fingerprintExtras?.gitHash,
			stageTimingsMs: timings,
		};
		timings.irConstruction = Date.now() - t;

		// Stage 6 is provider rendering — done by caller
		timings.providerRendering = 0;

		return {
			ir,
			graphIr,
			fingerprint,
			stageTimingsMs: timings,
			selectedNodeIds: selected.map((s) => s.id),
			droppedNodeIds: knapsack.dropped,
			averageQuality,
		};
	}
}

function makeBlock(partial: {
	id: string;
	role: PromptBlockRole;
	text: string;
	nodeIds: string[];
	priority: number;
	importance: number;
	dependencies: string[];
	retrievalConfidence?: number;
}): PromptBlock {
	const tokens = estimateTokens(partial.text);
	return {
		id: partial.id,
		role: partial.role,
		nodeIds: partial.nodeIds,
		text: partial.text,
		estimatedTokens: tokens,
		tokenCount: tokens,
		priority: partial.priority,
		hash: sha256(partial.text),
		version: 1,
		dependencies: partial.dependencies,
		compressionLevel: 0,
		importance: partial.importance,
		retrievalConfidence: partial.retrievalConfidence ?? 0,
		cacheBreakpoint: partial.role === 'system' || partial.role === 'repository',
	};
}

function resolveDependencies(
	ranked: ScoredContextCandidate[],
	graph: MultiStageCompileInput['graph'],
): ScoredContextCandidate[] {
	const byId = new Map(ranked.map((c) => [c.nodeId, c]));
	const out: ScoredContextCandidate[] = [...ranked];
	for (const c of ranked) {
		for (const dep of c.dependencies) {
			if (byId.has(dep)) {
				continue;
			}
			const node = graph.getNode(dep);
			if (!node) {
				continue;
			}
			const text = graph.materialize(dep) || node.content || node.label;
			const cand: ScoredContextCandidate = {
				nodeId: dep,
				node,
				text,
				tokenCount: node.tokenCount || estimateTokens(text),
				score: {
					relevance: 0.4,
					confidence: 0.5,
					freshness: 0.5,
					recency: 0.5,
					importance: 0.6,
					retrievalScore: 0.3,
					historicalUsefulness: 0.5,
					estimatedTokenCost: node.tokenCount || estimateTokens(text),
					finalScore: 35,
				},
				required: c.required,
				dependencies: node.dependencies ?? [],
			};
			byId.set(dep, cand);
			out.push(cand);
		}
	}
	return out;
}
