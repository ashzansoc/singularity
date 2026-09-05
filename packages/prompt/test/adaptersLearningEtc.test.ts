/**
 * Provider Adapters + Learning + Conversation + Retrieval + VM + Hash — unit tests
 */
import { describe, expect, it } from 'vitest';
import {
	renderForProvider,
	renderClaude,
	renderGpt,
	renderGemini,
	renderQwen,
	renderLocal,
	renderOpenRouter,
	renderOllama,
	renderVllm,
	renderLmStudio,
	normalizeProviderKind,
} from '../src/index.js';
import type { PromptIR } from '../src/ir/types.js';
import { DefaultLearningEngine } from '../src/learning/learningEngine.js';
import { DefaultConversationEngine } from '../src/conversation/conversationEngine.js';
import { SemanticRetrievalEngine } from '../src/retrieval/semanticRetrieval.js';
import { InMemoryContextGraph } from '../src/graph/contextGraph.js';
import { InMemoryMemoryManager } from '../src/memory/memoryManager.js';
import { DefaultHashEmbedder, cosineSimilarity } from '../src/embed/hashEmbedder.js';
import { DefaultContextVM } from '../src/vm/contextVm.js';
import {
	InMemorySnapshotStore,
	buildPromptFingerprint,
	snapshotIdFromFingerprint,
} from '../src/learning/snapshots.js';
import { hashContent, sha256, sha256Object, estimateTokens, hashObject } from '../src/hash.js';
import { DefaultDeltaEngine } from '../src/delta/deltaEngine.js';
import { segmentsForIntent, normalizePromptIntent, isSegmentAllowed } from '../src/routing/packs.js';
import { DefaultRouterIntegration } from '../src/routing/routerIntegration.js';
import { buildProviderCacheHints } from '../src/providerCache/hints.js';

function sampleIr(): PromptIR {
	return {
		sessionId: 's',
		intent: 'GENERAL',
		blocks: [
			{
				id: 'block:system',
				role: 'system',
				nodeIds: [],
				text: 'You are helpful.',
				estimatedTokens: 4,
				tokenCount: 4,
				priority: 0,
				hash: 'sys',
				dependencies: [],
				compressionLevel: 0,
				cacheBreakpoint: true,
			},
			{
				id: 'block:retrieval',
				role: 'retrieval',
				nodeIds: ['file:a'],
				text: 'file a contents',
				estimatedTokens: 4,
				tokenCount: 4,
				priority: 4,
				hash: 'ret',
				dependencies: ['block:system'],
				compressionLevel: 0,
			},
			{
				id: 'block:user',
				role: 'user',
				nodeIds: [],
				text: 'Explain this',
				estimatedTokens: 3,
				tokenCount: 3,
				priority: 1,
				hash: 'usr',
				dependencies: [],
				compressionLevel: 0,
			},
		],
		totalTokens: 11,
		budgetTokens: 1000,
		droppedSegmentIds: [],
		irHash: 'hash',
		compiledAt: Date.now(),
		compilerVersion: 3,
	};
}

describe('ProviderAdapters', () => {
	const ir = sampleIr();

	for (const [name, fn] of [
		['claude', renderClaude],
		['gpt', renderGpt],
		['gemini', renderGemini],
		['qwen', renderQwen],
		['local', renderLocal],
		['openrouter', renderOpenRouter],
		['ollama', renderOllama],
		['vllm', renderVllm],
		['lmstudio', renderLmStudio],
	] as const) {
		it(`${name} renders user message`, () => {
			const r = fn(ir);
			expect(r.messages.some((m) => m.role === 'user')).toBe(true);
			expect(r.tokenEstimate).toBeGreaterThan(0);
		});
	}

	const providers = [
		'openai',
		'anthropic',
		'claude',
		'gemini',
		'google',
		'qwen',
		'alibaba',
		'ollama',
		'vllm',
		'lmstudio',
		'lm-studio',
		'openrouter',
		'local',
		'azure',
		'unknown-vendor',
	];
	for (const p of providers) {
		it(`normalizeProviderKind(${p})`, () => {
			expect(normalizeProviderKind(p)).toBeTruthy();
		});
		it(`renderForProvider(${p})`, () => {
			expect(renderForProvider(ir, p).messages.length).toBeGreaterThan(0);
		});
	}

	it('gemini attaches systemInstruction extras', () => {
		const r = renderGemini(ir);
		expect(r.messages[0]?.providerExtras?.systemInstruction).toBeTruthy();
	});

	it('claude may attach cache_control on system', () => {
		const r = renderClaude(ir);
		expect(r.provider).toBe('claude');
	});
});

describe('ProviderCacheHints', () => {
	it('builds hints for claude', () => {
		const h = buildProviderCacheHints(sampleIr(), 'claude');
		expect(h.breakpointBlockIds.length).toBeGreaterThan(0);
	});

	it('builds hints for gpt', () => {
		expect(buildProviderCacheHints(sampleIr(), 'gpt').promptCacheKey).toBeTruthy();
	});

	it('safe when no breakpoints', () => {
		const ir = sampleIr();
		ir.blocks = ir.blocks.map((b) => ({ ...b, cacheBreakpoint: false }));
		expect(buildProviderCacheHints(ir, 'claude').cacheControl).toBeUndefined();
	});
});

describe('LearningEngine', () => {
	it('records events', () => {
		const l = new DefaultLearningEngine();
		l.record({
			requestId: 'r1',
			promptFingerprint: 'p',
			irHash: 'h',
			retrievedNodeIds: ['n1'],
			memoryNodeIds: [],
			intent: 'EDIT',
			inputTokens: 100,
			outcome: 'accepted',
			timestamp: Date.now(),
		});
		expect(l.stats().events).toBe(1);
		expect(l.stats().nodesTracked).toBe(1);
	});

	it('increases usefulness on accept', () => {
		const l = new DefaultLearningEngine();
		l.record({
			requestId: 'r',
			promptFingerprint: 'p',
			irHash: 'h',
			retrievedNodeIds: ['n'],
			memoryNodeIds: [],
			intent: 'EDIT',
			inputTokens: 1,
			outcome: 'accepted',
			timestamp: 1,
		});
		expect(l.nodeUsefulness('n')).toBeGreaterThan(0.5);
	});

	it('decreases on ignore path', () => {
		const l = new DefaultLearningEngine();
		l.record({
			requestId: 'r',
			promptFingerprint: 'p',
			irHash: 'h',
			retrievedNodeIds: ['n'],
			memoryNodeIds: [],
			intent: 'EDIT',
			inputTokens: 1,
			outcome: 'failed',
			timestamp: 1,
		});
		expect(l.nodeUsefulness('n')).toBeLessThan(0.7);
	});

	it('observeMissingNodes boosts', () => {
		const l = new DefaultLearningEngine();
		l.observeMissingNodes(['miss']);
		expect(l.nodeUsefulness('miss')).toBeGreaterThan(0.5);
	});

	it('observeIgnoredNodes reduces', () => {
		const l = new DefaultLearningEngine();
		l.observeIgnoredNodes(['ign']);
		expect(l.nodeUsefulness('ign')).toBeLessThan(0.5);
	});

	it('layoutPreference updates', () => {
		const l = new DefaultLearningEngine();
		l.record({
			requestId: 'r',
			promptFingerprint: 'p',
			irHash: 'h',
			retrievedNodeIds: [],
			memoryNodeIds: [],
			intent: 'DEBUG',
			inputTokens: 1,
			outcome: 'accepted',
			timestamp: 1,
		});
		expect(l.layoutPreference('DEBUG')).toBeGreaterThan(0.5);
	});

	it('preferredModel after wins', () => {
		const l = new DefaultLearningEngine();
		l.record({
			requestId: 'r',
			promptFingerprint: 'p',
			irHash: 'h',
			retrievedNodeIds: [],
			memoryNodeIds: [],
			intent: 'EDIT',
			inputTokens: 1,
			model: 'gpt-4.1',
			outcome: 'accepted',
			timestamp: 1,
		});
		expect(l.preferredModel('EDIT')).toBe('gpt-4.1');
	});

	it('unknown node usefulness defaults ~0.5', () => {
		expect(new DefaultLearningEngine().nodeUsefulness('x')).toBe(0.5);
	});

	it('caps event buffer', () => {
		const l = new DefaultLearningEngine({ maxEvents: 5 });
		for (let i = 0; i < 20; i++) {
			l.record({
				requestId: `r${i}`,
				promptFingerprint: 'p',
				irHash: 'h',
				retrievedNodeIds: [],
				memoryNodeIds: [],
				intent: 'G',
				inputTokens: 1,
				outcome: 'success',
				timestamp: i,
			});
		}
		expect(l.stats().events).toBeLessThanOrEqual(5);
	});

	for (const outcome of [
		'accepted',
		'regenerated',
		'edited',
		'cancelled',
		'failed',
		'tool_retry',
		'tool_failure',
		'success',
	] as const) {
		it(`handles outcome=${outcome}`, () => {
			const l = new DefaultLearningEngine();
			expect(() =>
				l.record({
					requestId: 'r',
					promptFingerprint: 'p',
					irHash: 'h',
					retrievedNodeIds: ['n'],
					memoryNodeIds: [],
					intent: 'G',
					inputTokens: 1,
					outcome,
					timestamp: 1,
				}),
			).not.toThrow();
		});
	}
});

describe('ConversationEngine', () => {
	const eng = new DefaultConversationEngine();

	it('keeps recent turns', () => {
		const turns = Array.from({ length: 12 }, (_, i) => ({
			id: `t${i}`,
			role: (i % 2 === 0 ? 'user' : 'assistant') as const,
			content: `msg ${i}`,
			createdAt: i,
		}));
		const s = eng.ingest(turns);
		expect(s.recentTurns.length).toBeLessThanOrEqual(12);
		expect(s.conversationHash).toBeTruthy();
	});

	it('extracts pending tasks', () => {
		const s = eng.ingest([
			{ id: '1', role: 'user', content: 'TODO fix auth', createdAt: 1 },
		]);
		expect(s.pendingTasks.length).toBeGreaterThan(0);
	});

	it('extracts resolved tasks', () => {
		const s = eng.ingest([
			{ id: '1', role: 'assistant', content: 'fixed the bug', createdAt: 1 },
		]);
		expect(s.resolvedTasks.length).toBeGreaterThan(0);
	});

	it('extracts important facts', () => {
		const s = eng.ingest([
			{ id: '1', role: 'user', content: 'always use pnpm', createdAt: 1 },
		]);
		expect(s.importantFacts.length).toBeGreaterThan(0);
	});

	it('toNodes creates graph nodes', () => {
		const s = eng.ingest([
			{ id: '1', role: 'user', content: 'hello', createdAt: 1 },
			{ id: '2', role: 'assistant', content: 'hi', createdAt: 2 },
		]);
		expect(eng.toNodes(s).length).toBeGreaterThan(0);
	});
});

describe('SemanticRetrievalEngine', () => {
	it('returns ranked hits', async () => {
		const graph = new InMemoryContextGraph();
		const memory = new InMemoryMemoryManager();
		const emb = new DefaultHashEmbedder();
		graph.upsertNode(
			InMemoryContextGraph.makeNode({
				id: 'file:a',
				kind: 'file',
				label: 'a',
				content: 'authentication middleware',
				embedding: emb.embed('authentication middleware'),
			}),
		);
		const engine = new SemanticRetrievalEngine({ graph, memory, embedder: emb });
		const hits = await engine.retrieve({ prompt: 'auth middleware', topK: 5 });
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0]!.score).toBeGreaterThan(0);
	});

	it('includes diagnostics as hits', async () => {
		const graph = new InMemoryContextGraph();
		const memory = new InMemoryMemoryManager();
		const engine = new SemanticRetrievalEngine({ graph, memory });
		const hits = await engine.retrieve({
			prompt: 'fix',
			diagnostics: [{ uri: 'file:///a.ts', message: 'unused var', severity: 'error' }],
		});
		expect(hits.some((h) => h.reason === 'diagnostic')).toBe(true);
	});

	it('includes git diff as hit', async () => {
		const graph = new InMemoryContextGraph();
		const memory = new InMemoryMemoryManager();
		const engine = new SemanticRetrievalEngine({ graph, memory });
		const hits = await engine.retrieve({
			prompt: 'review',
			gitDiff: '+ added line\n- removed',
		});
		expect(hits.some((h) => h.reason === 'git-diff')).toBe(true);
	});

	it('boosts current file', async () => {
		const graph = new InMemoryContextGraph();
		const memory = new InMemoryMemoryManager();
		const emb = new DefaultHashEmbedder();
		graph.upsertNode(
			InMemoryContextGraph.makeNode({
				id: 'file:file:///cur.ts',
				kind: 'file',
				label: 'file:///cur.ts',
				content: 'xyz',
				embedding: emb.embed('xyz'),
				meta: { uri: 'file:///cur.ts' },
			}),
		);
		const engine = new SemanticRetrievalEngine({ graph, memory, embedder: emb });
		const hits = await engine.retrieve({
			prompt: 'xyz',
			cursorUri: 'file:///cur.ts',
		});
		expect(hits[0]?.reason).toContain('current-file');
	});
});

describe('ContextVM', () => {
	const vm = new DefaultContextVM();

	it('buildProgram includes instructions', () => {
		const p = vm.buildProgram('DEBUG', [
			{ nodeId: 'file:a', score: 1, reason: 'x' },
		]);
		expect(p.instructions.length).toBeGreaterThan(0);
	});

	it('execute loads nodes', () => {
		const graph = new InMemoryContextGraph();
		graph.upsertNode(
			InMemoryContextGraph.makeNode({ id: 'file:a', kind: 'file', label: 'a', content: 'x' }),
		);
		const prog = vm.buildProgram('GENERAL', [
			{ nodeId: 'file:a', score: 1, reason: 'file' },
		]);
		const ws = vm.execute(prog, graph);
		expect(ws.nodeIds.length + ws.emittedBlocks.length).toBeGreaterThan(0);
	});

	for (const intent of ['RENAME', 'DEBUG', 'ARCHITECTURE', 'EDIT', 'PLAN'] as const) {
		it(`builds program for ${intent}`, () => {
			expect(vm.buildProgram(intent, []).instructions.some((i) => i.op === 'EMIT_BLOCK')).toBe(
				true,
			);
		});
	}
});

describe('Snapshots + Fingerprints', () => {
	it('buildPromptFingerprint', async () => {
		const emb = new DefaultHashEmbedder();
		const fp = await buildPromptFingerprint({
			ir: sampleIr(),
			embedder: emb,
			repositoryVersion: 'r',
			conversationVersion: 'c',
			memoryVersion: 'm',
			dependencyVersion: 'd',
		});
		expect(fp.sha256).toHaveLength(64);
		expect(fp.similarityHash).toBeTruthy();
		expect(fp.irVersion).toBe(3);
	});

	it('snapshot store findSimilar', async () => {
		const store = new InMemorySnapshotStore();
		const emb = new DefaultHashEmbedder();
		const fp = await buildPromptFingerprint({
			ir: sampleIr(),
			embedder: emb,
			repositoryVersion: 'r',
			conversationVersion: 'c',
			memoryVersion: 'm',
			dependencyVersion: 'd',
		});
		store.store({
			id: snapshotIdFromFingerprint(fp),
			fingerprint: fp,
			ir: sampleIr(),
			retrievedNodeIds: [],
			memoryNodeIds: [],
			selectedFiles: [],
			qualityScore: 50,
			embedding: fp.embedding,
			createdAt: Date.now(),
			hits: 0,
		});
		expect(store.findSimilar(fp.embedding, 0.5)).toBeDefined();
		expect(store.size()).toBe(1);
	});

	it('evicts when over max', async () => {
		const store = new InMemorySnapshotStore(2);
		const emb = new DefaultHashEmbedder();
		for (let i = 0; i < 5; i++) {
			const ir = sampleIr();
			ir.irHash = `h${i}`;
			const fp = await buildPromptFingerprint({
				ir,
				embedder: emb,
				repositoryVersion: `r${i}`,
				conversationVersion: 'c',
				memoryVersion: 'm',
				dependencyVersion: 'd',
			});
			store.store({
				id: `snap${i}`,
				fingerprint: fp,
				ir,
				retrievedNodeIds: [],
				memoryNodeIds: [],
				selectedFiles: [],
				qualityScore: 1,
				embedding: fp.embedding,
				createdAt: i,
				hits: 0,
			});
		}
		expect(store.size()).toBeLessThanOrEqual(2);
	});
});

describe('Hash + Embed', () => {
	it('sha256 length 64', () => {
		expect(sha256('abc')).toHaveLength(64);
	});

	it('sha256 deterministic', () => {
		expect(sha256('x')).toBe(sha256('x'));
	});

	it('sha256 differs', () => {
		expect(sha256('a')).not.toBe(sha256('b'));
	});

	it('sha256Object stable key order', () => {
		expect(sha256Object({ a: 1, b: 2 })).toBe(sha256Object({ b: 2, a: 1 }));
	});

	it('hashContent fnv length 8', () => {
		expect(hashContent('abc')).toHaveLength(8);
	});

	it('hashObject works', () => {
		expect(hashObject({ x: 1 })).toBeTruthy();
	});

	it('estimateTokens empty is 0', () => {
		expect(estimateTokens('')).toBe(0);
	});

	it('estimateTokens scales with length', () => {
		expect(estimateTokens('abcd')).toBe(1);
		expect(estimateTokens('a'.repeat(40))).toBe(10);
	});

	it('cosineSimilarity identical ~1', () => {
		const e = new DefaultHashEmbedder().embed('same');
		expect(cosineSimilarity(e, e)).toBeGreaterThan(0.99);
	});

	it('HashEmbedder dimensions', () => {
		expect(new DefaultHashEmbedder().dimensions).toBe(64);
	});
});

describe('DeltaEngine', () => {
	const delta = new DefaultDeltaEngine();

	it('no prior → all rebuilt', () => {
		const ir = sampleIr();
		const r = delta.apply(undefined, ir);
		expect(r.rebuiltBlockIds.length).toBe(ir.blocks.length);
	});

	it('identical blocks reused', () => {
		const ir = sampleIr();
		const r = delta.apply(ir, ir);
		expect(r.reusedBlockIds.length).toBeGreaterThan(0);
	});
});

describe('Routing packs + RouterIntegration', () => {
	it('DEBUG pack includes diagnostics', () => {
		expect(segmentsForIntent('DEBUG')).toContain('diagnostics');
	});

	it('RENAME excludes repository', () => {
		expect(segmentsForIntent('RENAME')).not.toContain('repository');
	});

	it('normalizePromptIntent aliases', () => {
		expect(normalizePromptIntent('ask')).toBe('EXPLAIN');
		expect(normalizePromptIntent('docs')).toBe('DOCUMENTATION');
	});

	it('isSegmentAllowed', () => {
		expect(isSegmentAllowed('DEBUG', 'terminal')).toBe(true);
		expect(isSegmentAllowed('RENAME', 'repository')).toBe(false);
	});

	it('RouterIntegration.prepare', () => {
		const meta = new DefaultRouterIntegration().prepare(sampleIr());
		expect(meta.estimatedTokens).toBe(11);
		expect(meta.irHash).toBe('hash');
		expect(['low', 'medium', 'high']).toContain(meta.complexity);
	});
});
