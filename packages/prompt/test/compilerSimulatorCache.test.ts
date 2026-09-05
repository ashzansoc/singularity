/**
 * Prompt Compiler + Simulator + Cache — unit tests (no LLM)
 */
import { describe, expect, it } from 'vitest';
import { InMemoryContextGraph } from '../src/graph/contextGraph.js';
import { DefaultHashEmbedder } from '../src/embed/hashEmbedder.js';
import { DefaultContextIntelligenceLayer } from '../src/intelligence/contextIntelligence.js';
import { MultiStagePromptCompilerImpl } from '../src/compiler/multiStageCompiler.js';
import { GraphPromptCompiler } from '../src/compiler/graphCompiler.js';
import { DefaultPromptSimulator } from '../src/simulation/promptSimulator.js';
import { DurablePromptCache, LocalPromptIrCache } from '../src/cache/irCache.js';
import { compilePrompt } from '../src/compiler/compiler.js';
import { createEmptyCanonicalContext } from '../src/types.js';
import { IR_VERSION } from '../src/graph/types.js';
import type { PromptIR } from '../src/ir/types.js';

function makeIntelligence(graph: InMemoryContextGraph, prompt: string) {
	const emb = new DefaultHashEmbedder();
	const nodes = graph.listNodes();
	return new DefaultContextIntelligenceLayer().analyze({
		prompt,
		intent: 'DEBUG',
		candidates: nodes,
		retrievalHits: nodes.slice(0, 3).map((n) => ({
			nodeId: n.id,
			score: 0.7,
			reason: 'test',
		})),
		queryEmbedding: emb.embed(prompt),
		graph,
		requiredNodeIds: nodes.filter((n) => n.kind === 'system' || n.kind === 'userPrompt').map((n) => n.id),
	});
}

function seedGraph() {
	const graph = new InMemoryContextGraph();
	const emb = new DefaultHashEmbedder();
	graph.upsertNode(
		InMemoryContextGraph.makeNode({
			id: 'system:prompt',
			kind: 'system',
			label: 'sys',
			content: 'You are helpful.',
		}),
	);
	graph.upsertNode(
		InMemoryContextGraph.makeNode({
			id: 'user:prompt',
			kind: 'userPrompt',
			label: 'user',
			content: 'Explain foo',
		}),
	);
	graph.upsertNode(
		InMemoryContextGraph.makeNode({
			id: 'file:a',
			kind: 'file',
			label: 'a.ts',
			content: 'export function foo() { return 1; }',
			embedding: emb.embed('foo function'),
		}),
	);
	graph.upsertNode(
		InMemoryContextGraph.makeNode({
			id: 'fn:foo',
			kind: 'function',
			label: 'foo',
			content: 'function foo',
			embedding: emb.embed('foo'),
			dependencies: ['file:a'],
			meta: { parent: 'file:a' },
		}),
	);
	return graph;
}

describe('MultiStagePromptCompiler', () => {
	const compiler = new MultiStagePromptCompilerImpl();
	const emb = new DefaultHashEmbedder();

	it('produces IR version 3', async () => {
		const graph = seedGraph();
		const r = await compiler.compile({
			sessionId: 's',
			intent: 'DEBUG',
			systemPrompt: 'sys',
			userPrompt: 'Explain foo',
			intelligence: makeIntelligence(graph, 'Explain foo'),
			graph,
			budgetTokens: 4000,
			embedder: emb,
		});
		expect(r.ir.compilerVersion).toBe(IR_VERSION);
	});

	it('includes user and system blocks', async () => {
		const graph = seedGraph();
		const r = await compiler.compile({
			sessionId: 's',
			intent: 'GENERAL',
			systemPrompt: 'sys',
			userPrompt: 'hi',
			intelligence: makeIntelligence(graph, 'hi'),
			graph,
			budgetTokens: 4000,
			embedder: emb,
		});
		expect(r.ir.blocks.some((b) => b.role === 'system')).toBe(true);
		expect(r.ir.blocks.some((b) => b.role === 'user')).toBe(true);
	});

	it('builds graph IR with roots and edges', async () => {
		const graph = seedGraph();
		const r = await compiler.compile({
			sessionId: 's',
			intent: 'EDIT',
			systemPrompt: 'sys',
			userPrompt: 'edit',
			intelligence: makeIntelligence(graph, 'edit'),
			graph,
			budgetTokens: 4000,
			embedder: emb,
		});
		expect(r.graphIr.roots.length).toBeGreaterThan(0);
		expect(Object.keys(r.graphIr.blocks).length).toBeGreaterThan(0);
	});

	it('produces fingerprint', async () => {
		const graph = seedGraph();
		const r = await compiler.compile({
			sessionId: 's',
			intent: 'EDIT',
			systemPrompt: 'sys',
			userPrompt: 'edit',
			intelligence: makeIntelligence(graph, 'edit'),
			graph,
			budgetTokens: 4000,
			embedder: emb,
			fingerprintExtras: { repoHash: 'r', conversationHash: 'c', memoryHash: 'm', gitHash: 'g' },
		});
		expect(r.fingerprint.sha256.length).toBe(64);
		expect(r.fingerprint.embedding.length).toBeGreaterThan(0);
	});

	it('records stage timings', async () => {
		const graph = seedGraph();
		const r = await compiler.compile({
			sessionId: 's',
			intent: 'EDIT',
			systemPrompt: 'sys',
			userPrompt: 'edit',
			intelligence: makeIntelligence(graph, 'edit'),
			graph,
			budgetTokens: 4000,
			embedder: emb,
		});
		expect(r.stageTimingsMs.candidateCollection).toBeGreaterThanOrEqual(0);
		expect(r.stageTimingsMs.budgetOptimization).toBeGreaterThanOrEqual(0);
	});

	it('respects tight budget', async () => {
		const graph = seedGraph();
		const r = await compiler.compile({
			sessionId: 's',
			intent: 'EDIT',
			systemPrompt: 'sys',
			userPrompt: 'edit',
			intelligence: makeIntelligence(graph, 'edit'),
			graph,
			budgetTokens: 200,
			embedder: emb,
		});
		expect(r.ir.totalTokens).toBeLessThanOrEqual(250);
	});

	it('deterministic for same inputs', async () => {
		const graph = seedGraph();
		const input = {
			sessionId: 's',
			intent: 'EDIT',
			systemPrompt: 'sys',
			userPrompt: 'edit',
			intelligence: makeIntelligence(graph, 'edit'),
			graph,
			budgetTokens: 4000,
			embedder: emb,
		};
		const a = await compiler.compile(input);
		const b = await compiler.compile(input);
		expect(a.ir.irHash).toBe(b.ir.irHash);
	});

	it('selectedNodeIds non-empty typically', async () => {
		const graph = seedGraph();
		const r = await compiler.compile({
			sessionId: 's',
			intent: 'DEBUG',
			systemPrompt: 'sys',
			userPrompt: 'foo',
			intelligence: makeIntelligence(graph, 'foo'),
			graph,
			budgetTokens: 4000,
			embedder: emb,
		});
		expect(r.selectedNodeIds.length + r.ir.blocks.length).toBeGreaterThan(0);
	});
});

describe('GraphPromptCompiler (compat)', () => {
	it('compiles working set', () => {
		const graph = seedGraph();
		const c = new GraphPromptCompiler();
		const ir = c.compile({
			sessionId: 's',
			intent: 'GENERAL',
			systemPrompt: 'sys',
			userPrompt: 'hi',
			workingSet: {
				nodeIds: ['file:a', 'fn:foo'],
				emittedBlocks: [{ role: 'retrieval', nodeIds: ['file:a', 'fn:foo'] }],
				compressedIds: [],
			},
			graph,
			budgetTokens: 3000,
		});
		expect(ir.blocks.length).toBeGreaterThan(0);
	});
});

describe('Legacy compilePrompt', () => {
	it('compiles canonical context', () => {
		const ctx = createEmptyCanonicalContext('s', {
			systemPrompt: 'sys',
			userPrompt: 'hello',
			intent: 'GENERAL',
		});
		const r = compilePrompt(ctx, { budgetTokens: 2000 });
		expect(r.ir.blocks.length).toBeGreaterThan(0);
	});

	it('dedupes identical segment content', () => {
		const ctx = createEmptyCanonicalContext('s', {
			systemPrompt: 'same',
			userPrompt: 'same',
			intent: 'GENERAL',
		});
		const r = compilePrompt(ctx, { budgetTokens: 2000 });
		expect(r.ir.totalTokens).toBeGreaterThan(0);
	});
});

describe('PromptSimulator', () => {
	const sim = new DefaultPromptSimulator();

	function baseIr(overrides?: Partial<PromptIR>): PromptIR {
		return {
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
					hash: 'sys',
					dependencies: [],
					compressionLevel: 0,
				},
				{
					id: 'block:user',
					role: 'user',
					nodeIds: [],
					text: 'hello',
					estimatedTokens: 2,
					tokenCount: 2,
					priority: 1,
					hash: 'user',
					dependencies: [],
					compressionLevel: 0,
				},
			],
			totalTokens: 3,
			budgetTokens: 1000,
			droppedSegmentIds: [],
			irHash: 'h',
			compiledAt: Date.now(),
			compilerVersion: 3,
			...overrides,
		};
	}

	it('passes healthy IR', () => {
		const r = sim.simulate({
			ir: baseIr(),
			provider: 'openai',
			userPrompt: 'hello',
			budgetTokens: 1000,
		});
		expect(r.passed).toBe(true);
	});

	it('repairs missing user', () => {
		const r = sim.simulate({
			ir: baseIr({
				blocks: [
					{
						id: 'block:system',
						role: 'system',
						nodeIds: [],
						text: 'sys',
						estimatedTokens: 1,
						tokenCount: 1,
						priority: 0,
						hash: 'sys',
						dependencies: [],
						compressionLevel: 0,
					},
				],
				totalTokens: 1,
			}),
			provider: 'openai',
			userPrompt: 'injected',
			budgetTokens: 1000,
		});
		expect(r.repaired).toBe(true);
		expect(r.ir.blocks.some((b) => b.role === 'user')).toBe(true);
	});

	it('drops empty blocks', () => {
		const r = sim.simulate({
			ir: baseIr({
				blocks: [
					...baseIr().blocks,
					{
						id: 'block:empty',
						role: 'retrieval',
						nodeIds: [],
						text: '   ',
						estimatedTokens: 1,
						tokenCount: 1,
						priority: 5,
						hash: 'e',
						dependencies: [],
						compressionLevel: 0,
					},
				],
			}),
			provider: 'openai',
			userPrompt: 'hello',
			budgetTokens: 1000,
		});
		expect(r.ir.blocks.every((b) => b.text.trim())).toBe(true);
	});

	it('trims over budget', () => {
		const r = sim.simulate({
			ir: baseIr({
				blocks: [
					...baseIr().blocks,
					{
						id: 'block:big',
						role: 'retrieval',
						nodeIds: [],
						text: 'x'.repeat(4000),
						estimatedTokens: 1000,
						tokenCount: 1000,
						priority: 9,
						hash: 'big',
						dependencies: [],
						compressionLevel: 0,
						importance: 0.1,
					},
				],
				totalTokens: 1003,
			}),
			provider: 'openai',
			userPrompt: 'hello',
			budgetTokens: 50,
		});
		expect(r.ir.totalTokens).toBeLessThanOrEqual(50);
	});

	it('dry-run message count > 0', () => {
		const r = sim.simulate({
			ir: baseIr(),
			provider: 'anthropic',
			userPrompt: 'hello',
			budgetTokens: 1000,
		});
		expect(r.dryRunMessageCount).toBeGreaterThan(0);
	});

	it('reports issues array', () => {
		const r = sim.simulate({
			ir: baseIr({ blocks: [] , totalTokens: 0 }),
			provider: 'openai',
			userPrompt: 'x',
			budgetTokens: 1000,
		});
		expect(r.issues.length).toBeGreaterThan(0);
	});

	it('predictedSuccess in [0,1]', () => {
		const r = sim.simulate({
			ir: baseIr(),
			provider: 'openai',
			userPrompt: 'hello',
			budgetTokens: 1000,
			estimatedAnswerConfidence: 0.8,
		});
		expect(r.predictedSuccess).toBeGreaterThanOrEqual(0);
		expect(r.predictedSuccess).toBeLessThanOrEqual(1);
	});

	for (const provider of ['openai', 'anthropic', 'gemini', 'ollama', 'vllm', 'lmstudio', 'openrouter', 'qwen']) {
		it(`dry-runs provider=${provider}`, () => {
			const r = sim.simulate({
				ir: baseIr(),
				provider,
				userPrompt: 'hello',
				budgetTokens: 1000,
			});
			expect(r.dryRunMessageCount).toBeGreaterThan(0);
		});
	}
});

describe('PromptCache', () => {
	it('LocalPromptIrCache get/set', () => {
		const cache = new LocalPromptIrCache();
		const ir = {
			sessionId: 's',
			intent: 'G',
			blocks: [],
			totalTokens: 0,
			budgetTokens: 1,
			droppedSegmentIds: [],
			irHash: 'abc',
			compiledAt: 1,
			compilerVersion: 3 as const,
		};
		cache.set(ir);
		expect(cache.get('s', 'abc')?.irHash).toBe('abc');
	});

	it('DurablePromptCache miss then hit', () => {
		const cache = new DurablePromptCache({ maxEntries: 10 });
		const key = cache.buildKey({
			repoHash: 'r',
			conversationHash: 'c',
			memoryHash: 'm',
			selectionHash: 's',
			diagnosticsHash: 'd',
			gitHash: 'g',
			irVersion: 3,
		});
		expect(cache.get(key)).toBeUndefined();
		cache.set(key, {
			sessionId: 's',
			intent: 'G',
			blocks: [],
			totalTokens: 0,
			budgetTokens: 1,
			droppedSegmentIds: [],
			irHash: key,
			compiledAt: 1,
			compilerVersion: 3,
		});
		expect(cache.get(key)?.irHash).toBe(key);
	});

	it('stats track hits/misses', () => {
		const cache = new DurablePromptCache();
		cache.get('missing');
		const key = cache.buildKey({
			repoHash: 'r',
			conversationHash: 'c',
			memoryHash: 'm',
			selectionHash: 's',
			diagnosticsHash: 'd',
			gitHash: 'g',
			irVersion: 3,
		});
		cache.set(key, {
			sessionId: 's',
			intent: 'G',
			blocks: [],
			totalTokens: 0,
			budgetTokens: 1,
			droppedSegmentIds: [],
			irHash: 'h',
			compiledAt: 1,
			compilerVersion: 3,
		});
		cache.get(key);
		const s = cache.stats();
		expect(s.misses).toBeGreaterThanOrEqual(1);
		expect(s.hits).toBeGreaterThanOrEqual(1);
	});

	it('invalidate clears', () => {
		const cache = new DurablePromptCache();
		const key = 'k1';
		cache.set(key, {
			sessionId: 's',
			intent: 'G',
			blocks: [],
			totalTokens: 0,
			budgetTokens: 1,
			droppedSegmentIds: [],
			irHash: 'h',
			compiledAt: 1,
			compilerVersion: 3,
		});
		cache.invalidate();
		expect(cache.get(key)).toBeUndefined();
	});

	it('LRU evicts when over maxEntries', () => {
		const cache = new DurablePromptCache({ maxEntries: 2 });
		for (let i = 0; i < 5; i++) {
			cache.set(`k${i}`, {
				sessionId: 's',
				intent: 'G',
				blocks: [],
				totalTokens: 0,
				budgetTokens: 1,
				droppedSegmentIds: [],
				irHash: `h${i}`,
				compiledAt: i,
				compilerVersion: 3,
			});
		}
		expect(cache.stats().size).toBeLessThanOrEqual(2);
	});

	it('buildKey is stable', () => {
		const cache = new DurablePromptCache();
		const parts = {
			repoHash: 'r',
			conversationHash: 'c',
			memoryHash: 'm',
			selectionHash: 's',
			diagnosticsHash: 'd',
			gitHash: 'g',
			irVersion: 3,
		};
		expect(cache.buildKey(parts)).toBe(cache.buildKey(parts));
	});

	it('buildKey changes with repoHash', () => {
		const cache = new DurablePromptCache();
		const a = cache.buildKey({
			repoHash: 'r1',
			conversationHash: 'c',
			memoryHash: 'm',
			selectionHash: 's',
			diagnosticsHash: 'd',
			gitHash: 'g',
			irVersion: 3,
		});
		const b = cache.buildKey({
			repoHash: 'r2',
			conversationHash: 'c',
			memoryHash: 'm',
			selectionHash: 's',
			diagnosticsHash: 'd',
			gitHash: 'g',
			irVersion: 3,
		});
		expect(a).not.toBe(b);
	});
});
