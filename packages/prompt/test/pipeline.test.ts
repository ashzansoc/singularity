/**
 * Prompt Engine v3 tests — intelligence, knapsack, learning, multi-stage.
 */
import { describe, expect, it } from 'vitest';
import {
	createEmptyCanonicalContext,
	createPromptEngine,
	createPromptPipeline,
	compressConversation,
	DefaultLearningEngine,
	WeightedKnapsackBudgetOptimizer,
	scoreContextNode,
	InMemoryContextGraph,
	DefaultHashEmbedder,
	DefaultGraphDiffEngine,
	DefaultAdaptiveBudgetLearner,
	DefaultPromptSimulator,
	runPromptPipeline,
	compilePrompt,
	LocalPromptIrCache,
	normalizePromptIntent,
	segmentsForIntent,
	optimizeBudget,
	updateSegmentsFromContext,
	createSegmentedContext,
} from '../src/index.js';

describe('v3 Context Quality Scorer', () => {
	it('scores quality/token and prefers relevant nodes', () => {
		const embedder = new DefaultHashEmbedder();
		const q = embedder.embed('createUser authentication');
		const good = InMemoryContextGraph.makeNode({
			id: 'file:///a.ts:function:createUser:1',
			kind: 'function',
			label: 'createUser',
			content: 'function createUser() { return auth(); }',
			embedding: embedder.embed('createUser authentication auth'),
			tokenCount: 40,
		});
		const noisy = InMemoryContextGraph.makeNode({
			id: 'file:///b.ts:function:formatDate:1',
			kind: 'function',
			label: 'formatDate',
			content: 'function formatDate() {}',
			embedding: embedder.embed('calendar date formatting'),
			tokenCount: 4000,
		});
		const sGood = scoreContextNode({ node: good, queryEmbedding: q });
		const sNoisy = scoreContextNode({ node: noisy, queryEmbedding: q });
		expect(sGood.finalScore).toBeGreaterThan(sNoisy.finalScore);
	});
});

describe('v3 Knapsack budget', () => {
	it('keeps required deps and prefers density', () => {
		const opt = new WeightedKnapsackBudgetOptimizer();
		const result = opt.optimize(
			[
				{ id: 'req', value: 10, weight: 100, required: true, text: 'req', dependencies: ['dep'] },
				{ id: 'dep', value: 5, weight: 50, text: 'dep' },
				{ id: 'big', value: 20, weight: 900, text: 'big' },
				{ id: 'small1', value: 30, weight: 40, text: 's1' },
				{ id: 'small2', value: 28, weight: 40, text: 's2' },
			],
			200,
		);
		expect(result.selected.some((s) => s.id === 'req')).toBe(true);
		expect(result.selected.some((s) => s.id === 'dep')).toBe(true);
		expect(result.totalWeight).toBeLessThanOrEqual(200);
		expect(result.selected.some((s) => s.id === 'small1')).toBe(true);
	});
});

describe('v3 Learning Engine', () => {
	it('increases usefulness on accept and missing signals', () => {
		const learning = new DefaultLearningEngine();
		learning.record({
			requestId: 'r1',
			promptFingerprint: 'p',
			irHash: 'h',
			retrievedNodeIds: ['n1'],
			memoryNodeIds: [],
			intent: 'DEBUG',
			inputTokens: 1000,
			outcome: 'accepted',
			timestamp: Date.now(),
		});
		expect(learning.nodeUsefulness('n1')).toBeGreaterThan(0.5);
		learning.observeMissingNodes(['n2']);
		expect(learning.nodeUsefulness('n2')).toBeGreaterThan(0.5);
	});
});

describe('v3 Adaptive budgets', () => {
	it('learns toward used token sizes', () => {
		const budgets = new DefaultAdaptiveBudgetLearner();
		const key = { task: 'edit' as const, language: 'typescript' };
		const before = budgets.recommend(key);
		for (let i = 0; i < 8; i++) {
			budgets.observe(key, 4500, 'accepted');
		}
		const after = budgets.recommend(key);
		expect(after).not.toBe(before);
		expect(after).toBeLessThan(before);
	});
});

describe('v3 Graph Diff', () => {
	it('detects changed hashes', () => {
		const diff = new DefaultGraphDiffEngine();
		const a = [
			InMemoryContextGraph.makeNode({ id: 'f1', kind: 'file', label: 'a', content: 'v1' }),
		];
		const b = [
			InMemoryContextGraph.makeNode({ id: 'f1', kind: 'file', label: 'a', content: 'v2' }),
			InMemoryContextGraph.makeNode({ id: 'f2', kind: 'file', label: 'b', content: 'x' }),
		];
		const d = diff.diff({ nodes: a }, { nodes: b });
		expect(d.changed).toContain('f1');
		expect(d.added).toContain('f2');
	});
});

describe('Prompt Engine v3 end-to-end', () => {
	it('runs intelligence → multi-stage → IR graph + fingerprint', async () => {
		const engine = createPromptEngine({ workspaceId: 'ws-v3', budgetTokens: 4000 });
		const result = await engine.run({
			sessionId: 'sess-1',
			prompt: 'Explain createUser',
			systemPrompt: 'You are a coding assistant.',
			intent: 'DEBUG',
			provider: 'openai',
			languageId: 'typescript',
			files: [
				{
					uri: 'file:///src/user.ts',
					content: `
export function createUser(name: string) {
  return db.insert(name);
}
export class UserService {
  createUser(name: string) { return createUser(name); }
}
`,
					version: 1,
					languageId: 'typescript',
				},
			],
			retrieval: {
				cursorUri: 'file:///src/user.ts',
				selectionText: 'createUser',
				diagnostics: [{ uri: 'file:///src/user.ts', message: 'unused', severity: 'warning' }],
			},
		});

		expect(result.ir.compilerVersion).toBe(3);
		expect(result.ir.graph).toBeDefined();
		expect(result.fingerprint?.sha256.length).toBeGreaterThan(16);
		expect(result.averageQuality).toBeGreaterThan(0);
		expect(result.recommendedBudget).toBeGreaterThan(0);
		expect(result.debug.scoredCandidates).toBeGreaterThan(0);
		expect(result.simulation?.passed).toBe(true);
		expect(result.simulation!.dryRunMessageCount).toBeGreaterThan(0);

		const second = await engine.run({
			sessionId: 'sess-1',
			prompt: 'Explain createUser',
			systemPrompt: 'You are a coding assistant.',
			intent: 'DEBUG',
			provider: 'openai',
			retrieval: {
				cursorUri: 'file:///src/user.ts',
				selectionText: 'createUser',
				diagnostics: [{ uri: 'file:///src/user.ts', message: 'unused', severity: 'warning' }],
			},
		});
		expect(second.fromCache || second.fromSnapshot).toBe(true);

		engine.recordOutcome(result.telemetry.requestId, 'accepted');
		expect(engine.learning.stats().events).toBeGreaterThan(0);
	});
});

describe('v3 Prompt Simulator', () => {
	it('repairs missing user block and dry-runs render', () => {
		const sim = new DefaultPromptSimulator();
		const report = sim.simulate({
			ir: {
				sessionId: 's',
				intent: 'GENERAL',
				blocks: [
					{
						id: 'block:system',
						role: 'system',
						nodeIds: [],
						text: 'sys',
						estimatedTokens: 1,
						tokenCount: 1,
						priority: 0,
						hash: 'a',
						dependencies: [],
						compressionLevel: 0,
					},
				],
				totalTokens: 1,
				budgetTokens: 1000,
				droppedSegmentIds: [],
				irHash: 'x',
				compiledAt: Date.now(),
				compilerVersion: 3,
			},
			provider: 'openai',
			userPrompt: 'hello world',
			budgetTokens: 1000,
		});
		expect(report.repaired).toBe(true);
		expect(report.ir.blocks.some((b) => b.role === 'user')).toBe(true);
		expect(report.passed).toBe(true);
	});
});

describe('L1 Canonical Context (compat)', () => {
	it('creates a full empty context shell', () => {
		const ctx = createEmptyCanonicalContext('s1');
		expect(ctx.sessionId).toBe('s1');
	});
});

describe('L8 Semantic Compression', () => {
	it('summarizes older turns and keeps recent', () => {
		const turns = Array.from({ length: 12 }, (_, i) => ({
			id: `t${i}`,
			role: (i % 2 === 0 ? 'user' : 'assistant') as const,
			content: `message number ${i} with some padding text`,
			createdAt: i,
		}));
		const result = compressConversation(turns, { keepRecentTurns: 4 });
		expect(result.droppedTurnIds.length).toBeGreaterThan(0);
	});
});

describe('L9 Routing packs', () => {
	it('debug includes diagnostics', () => {
		expect(segmentsForIntent(normalizePromptIntent('debug'))).toContain('diagnostics');
	});
});

describe('L10 Budget optimizer compat', () => {
	it('drops lower priority under budget', () => {
		const result = optimizeBudget(
			[
				{ id: 'userPrompt', text: 'hi', tokenCount: 10 },
				{ id: 'memory', text: 'long memory '.repeat(200), tokenCount: 500 },
			],
			{ budgetTokens: 100 },
		);
		expect(result.kept.some((k) => k.id === 'userPrompt')).toBe(true);
	});
});

describe('L3 Segmentation compat', () => {
	it('marks unchanged clean', () => {
		const ctx = createEmptyCanonicalContext('s1', { systemPrompt: 'sys' });
		const first = updateSegmentsFromContext(undefined, ctx, { retainContent: true });
		const second = updateSegmentsFromContext(first, ctx, { retainContent: true });
		expect(second.segments.system.dirty).toBe(false);
		expect(createSegmentedContext('s').segments.memory).toBeDefined();
	});
});

describe('Legacy pipeline compat', () => {
	it('compiles and caches', () => {
		const ctx = createEmptyCanonicalContext('s1', {
			systemPrompt: 'sys',
			userPrompt: 'hello',
			intent: 'GENERAL',
		});
		const cache = new LocalPromptIrCache();
		const compiled = compilePrompt(ctx, { budgetTokens: 2000 });
		cache.set(compiled.ir);
		expect(cache.get('s1', compiled.ir.irHash)?.irHash).toBe(compiled.ir.irHash);

		let state = createPromptPipeline('pipe-1');
		const first = runPromptPipeline(
			state,
			{ userPrompt: 'explain foo', systemPrompt: 'sys', intent: 'EXPLAIN' },
			'claude',
			{ budgetTokens: 3000 },
		);
		expect(first.result.rendered.messages.length).toBeGreaterThan(0);
	});
});
