/**
 * Context Intelligence Layer — brain of Prompt Engine v3.
 * Ranks context, predicts missing nodes, removes redundancy, recommends budgets.
 */

import { estimateTokens } from '../hash.js';
import type {
	ContextIntelligenceInput,
	ContextIntelligenceLayer,
	ContextIntelligenceResult,
	LearningEngine,
	ScoredContextCandidate,
	AdaptiveBudgetLearner,
	TaskBudgetKind,
} from '../interfaces/v3.js';
import { scoreContextNode } from './qualityScorer.js';
import { cosineSimilarity } from '../embed/hashEmbedder.js';

export class DefaultContextIntelligenceLayer implements ContextIntelligenceLayer {
	constructor(
		private readonly learning?: LearningEngine,
		private readonly budgets?: AdaptiveBudgetLearner,
	) {}

	analyze(input: ContextIntelligenceInput): ContextIntelligenceResult {
		const hitMap = new Map(input.retrievalHits.map((h) => [h.nodeId, h]));
		const required = new Set(input.requiredNodeIds ?? []);

		const scored: ScoredContextCandidate[] = [];
		for (const node of input.candidates) {
			const text = input.graph.materialize(node.id) || node.content || node.label;
			const score = scoreContextNode({
				node,
				queryEmbedding: input.queryEmbedding,
				retrievalHit: hitMap.get(node.id),
				learning: this.learning,
			});
			scored.push({
				nodeId: node.id,
				node,
				text,
				tokenCount: node.tokenCount || estimateTokens(text),
				score,
				required:
					required.has(node.id) ||
					node.kind === 'userPrompt' ||
					node.kind === 'system' ||
					node.kind === 'selection',
				dependencies: [...node.dependencies, ...(node.meta?.parent ? [String(node.meta.parent)] : [])],
				retrievalHit: hitMap.get(node.id),
			});
		}

		scored.sort((a, b) => b.score.finalScore - a.score.finalScore);

		// Remove redundant near-duplicates (high text/embed similarity, keep higher score)
		const redundantIds: string[] = [];
		const kept: ScoredContextCandidate[] = [];
		for (const c of scored) {
			let dup = false;
			for (const k of kept) {
				if (
					c.node.embedding &&
					k.node.embedding &&
					cosineSimilarity(c.node.embedding, k.node.embedding) > 0.97 &&
					c.node.kind === k.node.kind
				) {
					dup = true;
					break;
				}
				if (
					c.text.length > 40 &&
					k.text.length > 40 &&
					c.text.slice(0, 120) === k.text.slice(0, 120)
				) {
					dup = true;
					break;
				}
			}
			if (dup && !c.required) {
				redundantIds.push(c.nodeId);
			} else {
				kept.push(c);
			}
		}

		const predictedMissing = this.predictMissing(input, kept);
		const avgQuality =
			kept.reduce((s, c) => s + c.score.finalScore, 0) / Math.max(1, kept.length);
		const coverage = Math.min(1, kept.filter((c) => c.retrievalHit).length / 8);
		const estimatedAnswerConfidence = clamp01(avgQuality / 100 * 0.6 + coverage * 0.4);
		const estimatedRegenerationProbability = clamp01(
			1 - estimatedAnswerConfidence + redundantIds.length * 0.02,
		);

		const task = intentToTask(input.intent);
		const recommendedBudget =
			this.budgets?.recommend({
				task,
				language: input.languageId,
				repoSize: input.repoSize,
			}) ?? defaultBudget(task);

		return {
			scored: kept,
			predictedMissing,
			redundantIds,
			estimatedRegenerationProbability,
			estimatedAnswerConfidence,
			recommendedBudget,
		};
	}

	private predictMissing(
		input: ContextIntelligenceInput,
		kept: ScoredContextCandidate[],
	): string[] {
		const missing: string[] = [];
		const keptIds = new Set(kept.map((k) => k.nodeId));
		// If diagnostics intent / debug — ensure diagnostic nodes present
		if (/DEBUG|TEST|EDIT/i.test(input.intent)) {
			for (const n of input.graph.listNodes('diagnostic')) {
				if (!keptIds.has(n.id) && missing.length < 4) {
					missing.push(n.id);
				}
			}
		}
		// Pull parent files for selected functions
		for (const c of kept.slice(0, 12)) {
			if (c.node.kind === 'function' || c.node.kind === 'class') {
				const parent = c.node.meta?.parent ? String(c.node.meta.parent) : undefined;
				if (parent && !keptIds.has(parent)) {
					missing.push(parent);
				}
				for (const dep of c.dependencies) {
					if (!keptIds.has(dep) && input.graph.getNode(dep)) {
						missing.push(dep);
					}
				}
			}
		}
		return [...new Set(missing)].slice(0, 8);
	}
}

export function intentToTask(intent: string): TaskBudgetKind {
	const v = intent.toUpperCase();
	if (v.includes('AUTO') || v === 'UNKNOWN') {
		return 'autocomplete';
	}
	if (v === 'EDIT' || v === 'RENAME') {
		return 'edit';
	}
	if (v === 'ARCHITECTURE' || v === 'REVIEW') {
		return 'architecture';
	}
	if (v === 'DEBUG' || v === 'TEST') {
		return 'debug';
	}
	if (v === 'PLAN' || v === 'AGENT') {
		return 'plan';
	}
	if (v.includes('REFACTOR')) {
		return 'refactor';
	}
	return 'general';
}

export function defaultBudget(task: TaskBudgetKind): number {
	switch (task) {
		case 'autocomplete':
			return 1_500;
		case 'edit':
			return 6_000;
		case 'refactor':
			return 12_000;
		case 'architecture':
			return 30_000;
		case 'debug':
			return 10_000;
		case 'plan':
			return 14_000;
		default:
			return 8_000;
	}
}

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}

/** Ensure predicted missing nodes are materialized as candidates. */
export function mergePredictedCandidates(
	result: ContextIntelligenceResult,
	graph: ContextIntelligenceInput['graph'],
	queryEmbedding: number[],
	learning?: LearningEngine,
): ContextIntelligenceResult {
	const have = new Set(result.scored.map((s) => s.nodeId));
	const extra: ScoredContextCandidate[] = [];
	for (const id of result.predictedMissing) {
		if (have.has(id)) {
			continue;
		}
		const node = graph.getNode(id);
		if (!node) {
			continue;
		}
		const text = graph.materialize(id) || node.content || node.label;
		extra.push({
			nodeId: id,
			node,
			text,
			tokenCount: node.tokenCount || estimateTokens(text),
			score: scoreContextNode({ node, queryEmbedding, learning }),
			required: false,
			dependencies: node.dependencies ?? [],
		});
	}
	return {
		...result,
		scored: [...result.scored, ...extra].sort(
			(a, b) => b.score.finalScore - a.score.finalScore,
		),
	};
}
