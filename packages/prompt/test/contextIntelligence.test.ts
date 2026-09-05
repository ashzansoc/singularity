/**
 * Context Intelligence + Quality Scorer — unit tests (no LLM)
 */
import { describe, expect, it } from 'vitest';
import { InMemoryContextGraph } from '../src/graph/contextGraph.js';
import { DefaultHashEmbedder } from '../src/embed/hashEmbedder.js';
import { scoreContextNode } from '../src/intelligence/qualityScorer.js';
import {
	DefaultContextIntelligenceLayer,
	defaultBudget,
	intentToTask,
	mergePredictedCandidates,
} from '../src/intelligence/contextIntelligence.js';
import { DefaultLearningEngine } from '../src/learning/learningEngine.js';

describe('ContextQualityScorer', () => {
	const emb = new DefaultHashEmbedder();
	const q = emb.embed('createUser authentication');

	it('returns all score fields', () => {
		const node = InMemoryContextGraph.makeNode({
			id: 'n',
			kind: 'function',
			label: 'createUser',
			content: 'createUser auth',
			embedding: emb.embed('createUser auth'),
		});
		const s = scoreContextNode({ node, queryEmbedding: q });
		for (const k of [
			'relevance',
			'confidence',
			'freshness',
			'recency',
			'importance',
			'retrievalScore',
			'historicalUsefulness',
			'estimatedTokenCost',
			'finalScore',
		] as const) {
			expect(typeof s[k]).toBe('number');
		}
	});

	it('prefers semantically closer nodes', () => {
		const good = InMemoryContextGraph.makeNode({
			id: 'g',
			kind: 'function',
			label: 'createUser',
			content: 'createUser',
			embedding: emb.embed('createUser authentication'),
			tokenCount: 50,
		});
		const bad = InMemoryContextGraph.makeNode({
			id: 'b',
			kind: 'function',
			label: 'formatDate',
			content: 'dates',
			embedding: emb.embed('calendar date format'),
			tokenCount: 50,
		});
		expect(scoreContextNode({ node: good, queryEmbedding: q }).finalScore).toBeGreaterThan(
			scoreContextNode({ node: bad, queryEmbedding: q }).finalScore,
		);
	});

	it('penalizes huge token cost', () => {
		const small = InMemoryContextGraph.makeNode({
			id: 's',
			kind: 'function',
			label: 'f',
			content: 'f',
			embedding: emb.embed('createUser'),
			tokenCount: 20,
		});
		const huge = InMemoryContextGraph.makeNode({
			id: 'h',
			kind: 'function',
			label: 'f',
			content: 'f',
			embedding: emb.embed('createUser'),
			tokenCount: 50_000,
		});
		expect(scoreContextNode({ node: small, queryEmbedding: q }).finalScore).toBeGreaterThan(
			scoreContextNode({ node: huge, queryEmbedding: q }).finalScore,
		);
	});

	it('uses retrieval hit score when no embedding', () => {
		const node = InMemoryContextGraph.makeNode({
			id: 'n',
			kind: 'file',
			label: 'n',
			content: 'x',
		});
		const s = scoreContextNode({
			node,
			queryEmbedding: q,
			retrievalHit: { nodeId: 'n', score: 0.9, reason: 'test' },
		});
		expect(s.retrievalScore).toBeGreaterThan(0.5);
	});

	it('blends historical usefulness from learning', () => {
		const learning = new DefaultLearningEngine();
		learning.record({
			requestId: 'r',
			promptFingerprint: 'p',
			irHash: 'h',
			retrievedNodeIds: ['n'],
			memoryNodeIds: [],
			intent: 'EDIT',
			inputTokens: 10,
			outcome: 'accepted',
			timestamp: Date.now(),
		});
		const node = InMemoryContextGraph.makeNode({
			id: 'n',
			kind: 'file',
			label: 'n',
			content: 'x',
			embedding: emb.embed('x'),
		});
		expect(
			scoreContextNode({ node, queryEmbedding: q, learning }).historicalUsefulness,
		).toBeGreaterThan(0.5);
	});

	it('selection kind has high importance', () => {
		const node = InMemoryContextGraph.makeNode({
			id: 's',
			kind: 'selection',
			label: 's',
			content: 'sel',
		});
		expect(scoreContextNode({ node, queryEmbedding: q }).importance).toBeGreaterThan(0.8);
	});

	it('fresh nodes score higher freshness', () => {
		const fresh = InMemoryContextGraph.makeNode({
			id: 'f',
			kind: 'file',
			label: 'f',
			content: 'x',
			lastModified: Date.now(),
		});
		const old = InMemoryContextGraph.makeNode({
			id: 'o',
			kind: 'file',
			label: 'o',
			content: 'x',
			lastModified: Date.now() - 30 * 86_400_000,
		});
		expect(scoreContextNode({ node: fresh, queryEmbedding: q }).freshness).toBeGreaterThan(
			scoreContextNode({ node: old, queryEmbedding: q }).freshness,
		);
	});

	for (const kind of ['function', 'class', 'file', 'diagnostic', 'memory', 'git'] as const) {
		it(`scores kind=${kind}`, () => {
			const node = InMemoryContextGraph.makeNode({
				id: kind,
				kind,
				label: kind,
				content: kind,
			});
			expect(scoreContextNode({ node, queryEmbedding: q }).finalScore).toBeGreaterThan(0);
		});
	}
});

describe('ContextIntelligenceLayer', () => {
	const emb = new DefaultHashEmbedder();
	const layer = new DefaultContextIntelligenceLayer();

	function setup() {
		const graph = new InMemoryContextGraph();
		const nodes = [
			InMemoryContextGraph.makeNode({
				id: 'file:a',
				kind: 'file',
				label: 'a',
				content: 'createUser',
				embedding: emb.embed('createUser'),
			}),
			InMemoryContextGraph.makeNode({
				id: 'fn:createUser',
				kind: 'function',
				label: 'createUser',
				content: 'function createUser',
				embedding: emb.embed('createUser'),
				meta: { parent: 'file:a' },
				dependencies: ['file:a'],
			}),
			InMemoryContextGraph.makeNode({
				id: 'diag:1',
				kind: 'diagnostic',
				label: 'err',
				content: 'error unused',
			}),
		];
		for (const n of nodes) {
			graph.upsertNode(n);
		}
		return { graph, nodes };
	}

	it('ranks candidates', () => {
		const { graph, nodes } = setup();
		const r = layer.analyze({
			prompt: 'fix createUser',
			intent: 'DEBUG',
			candidates: nodes,
			retrievalHits: [{ nodeId: 'fn:createUser', score: 0.9, reason: 'embed' }],
			queryEmbedding: emb.embed('fix createUser'),
			graph,
		});
		expect(r.scored[0]!.nodeId).toBeTruthy();
		expect(r.scored[0]!.score.finalScore).toBeGreaterThan(0);
	});

	it('marks system/user/selection required when present', () => {
		const graph = new InMemoryContextGraph();
		const nodes = [
			InMemoryContextGraph.makeNode({
				id: 'system:prompt',
				kind: 'system',
				label: 's',
				content: 'sys',
			}),
			InMemoryContextGraph.makeNode({
				id: 'user:prompt',
				kind: 'userPrompt',
				label: 'u',
				content: 'hi',
			}),
		];
		for (const n of nodes) {
			graph.upsertNode(n);
		}
		const r = layer.analyze({
			prompt: 'hi',
			intent: 'GENERAL',
			candidates: nodes,
			retrievalHits: [],
			queryEmbedding: emb.embed('hi'),
			graph,
			requiredNodeIds: ['system:prompt', 'user:prompt'],
		});
		expect(r.scored.filter((s) => s.required).length).toBeGreaterThanOrEqual(2);
	});

	it('detects redundant near-duplicates', () => {
		const graph = new InMemoryContextGraph();
		const embVec = emb.embed('same text body');
		const a = InMemoryContextGraph.makeNode({
			id: 'a',
			kind: 'file',
			label: 'a',
			content: 'same text body repeated content here',
			embedding: embVec,
		});
		const b = InMemoryContextGraph.makeNode({
			id: 'b',
			kind: 'file',
			label: 'b',
			content: 'same text body repeated content here',
			embedding: embVec,
		});
		graph.upsertNode(a);
		graph.upsertNode(b);
		const r = layer.analyze({
			prompt: 'x',
			intent: 'GENERAL',
			candidates: [a, b],
			retrievalHits: [],
			queryEmbedding: emb.embed('x'),
			graph,
		});
		expect(r.redundantIds.length + r.scored.length).toBeGreaterThanOrEqual(2);
	});

	it('predicts missing parent for functions on DEBUG', () => {
		const { graph, nodes } = setup();
		const r = layer.analyze({
			prompt: 'debug',
			intent: 'DEBUG',
			candidates: nodes.filter((n) => n.kind !== 'file'),
			retrievalHits: [{ nodeId: 'fn:createUser', score: 0.8, reason: 'x' }],
			queryEmbedding: emb.embed('debug'),
			graph,
		});
		expect(r.predictedMissing.length + r.scored.length).toBeGreaterThan(0);
	});

	it('recommends budget', () => {
		const { graph, nodes } = setup();
		const r = layer.analyze({
			prompt: 'x',
			intent: 'ARCHITECTURE',
			candidates: nodes,
			retrievalHits: [],
			queryEmbedding: emb.embed('x'),
			graph,
		});
		expect(r.recommendedBudget).toBe(defaultBudget('architecture'));
	});

	it('estimates confidence and regen probability in range', () => {
		const { graph, nodes } = setup();
		const r = layer.analyze({
			prompt: 'x',
			intent: 'EDIT',
			candidates: nodes,
			retrievalHits: [],
			queryEmbedding: emb.embed('x'),
			graph,
		});
		expect(r.estimatedAnswerConfidence).toBeGreaterThanOrEqual(0);
		expect(r.estimatedAnswerConfidence).toBeLessThanOrEqual(1);
		expect(r.estimatedRegenerationProbability).toBeGreaterThanOrEqual(0);
		expect(r.estimatedRegenerationProbability).toBeLessThanOrEqual(1);
	});

	it('mergePredictedCandidates adds missing nodes', () => {
		const { graph, nodes } = setup();
		const base = layer.analyze({
			prompt: 'x',
			intent: 'DEBUG',
			candidates: [nodes[1]!],
			retrievalHits: [],
			queryEmbedding: emb.embed('x'),
			graph,
		});
		base.predictedMissing.push('file:a');
		const merged = mergePredictedCandidates(base, graph, emb.embed('x'));
		expect(merged.scored.some((s) => s.nodeId === 'file:a')).toBe(true);
	});
});

describe('intentToTask / defaultBudget', () => {
	const cases: Array<[string, ReturnType<typeof intentToTask>]> = [
		['EDIT', 'edit'],
		['RENAME', 'edit'],
		['DEBUG', 'debug'],
		['TEST', 'debug'],
		['ARCHITECTURE', 'architecture'],
		['REVIEW', 'architecture'],
		['PLAN', 'plan'],
		['AGENT', 'plan'],
		['REFACTOR', 'refactor'],
		['GENERAL', 'general'],
		['AUTOCOMPLETE', 'autocomplete'],
	];
	for (const [intent, task] of cases) {
		it(`maps ${intent} → ${task}`, () => {
			expect(intentToTask(intent)).toBe(task);
		});
	}

	for (const task of [
		'autocomplete',
		'edit',
		'refactor',
		'architecture',
		'debug',
		'plan',
		'general',
	] as const) {
		it(`defaultBudget(${task}) > 0`, () => {
			expect(defaultBudget(task)).toBeGreaterThan(0);
		});
	}

	it('architecture budget > autocomplete', () => {
		expect(defaultBudget('architecture')).toBeGreaterThan(defaultBudget('autocomplete'));
	});
});
