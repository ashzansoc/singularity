/**
 * Feature 1 — Context Quality Scorer
 * Maximizes Context Quality / Token.
 */

import { cosineSimilarity } from '../embed/hashEmbedder.js';
import type { GraphNode } from '../graph/types.js';
import type {
	ContextQualityScore,
	IntelligenceRetrievalHit,
	LearningEngine,
} from '../interfaces/v3.js';

const W = {
	relevance: 0.35,
	confidence: 0.2,
	freshness: 0.15,
	recency: 0.1,
	importance: 0.1,
	retrieval: 0.1,
} as const;

export function scoreContextNode(input: {
	node: GraphNode;
	queryEmbedding: number[];
	retrievalHit?: IntelligenceRetrievalHit;
	learning?: LearningEngine;
	now?: number;
}): ContextQualityScore {
	const now = input.now ?? Date.now();
	const node = input.node;
	const tokenCost = Math.max(1, node.tokenCount);

	const relevance = node.embedding
		? clamp01(cosineSimilarity(input.queryEmbedding, node.embedding))
		: clamp01((input.retrievalHit?.score ?? 0) / 1.2);

	const retrievalScore = clamp01(input.retrievalHit?.score ?? relevance);
	const confidence = clamp01(0.4 + retrievalScore * 0.4 + (node.embedding ? 0.2 : 0));

	const ageMs = Math.max(0, now - node.lastModified);
	const freshness = clamp01(Math.exp(-ageMs / (7 * 86_400_000)));
	const recency = clamp01(Math.exp(-ageMs / 86_400_000));

	const kindImportance =
		node.kind === 'function' || node.kind === 'class'
			? 0.85
			: node.kind === 'file'
				? 0.7
				: node.kind === 'diagnostic'
					? 0.75
					: node.kind === 'selection'
						? 0.95
						: node.kind === 'memory'
							? 0.55
							: 0.45;
	const importance = clamp01(kindImportance);

	const historicalUsefulness = input.learning
		? clamp01(input.learning.nodeUsefulness(node.id))
		: 0.5;

	const weighted =
		W.relevance * relevance +
		W.confidence * confidence +
		W.freshness * freshness +
		W.recency * recency +
		W.importance * importance +
		W.retrieval * retrievalScore;

	const quality = weighted * 0.85 + historicalUsefulness * 0.15;
	const efficiencyBoost = 1 / Math.log2(8 + tokenCost);
	const finalScore = quality * (0.65 + 0.35 * efficiencyBoost) * 100;

	return {
		relevance,
		confidence,
		freshness,
		recency,
		importance,
		retrievalScore,
		historicalUsefulness,
		estimatedTokenCost: tokenCost,
		finalScore,
	};
}

function clamp01(n: number): number {
	if (Number.isNaN(n)) {
		return 0;
	}
	return Math.max(0, Math.min(1, n));
}
