/**
 * Memory Graph — unit tests (no LLM)
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryMemoryManager } from '../src/memory/memoryManager.js';
import { DefaultHashEmbedder } from '../src/embed/hashEmbedder.js';
import type { MemoryScope } from '../src/graph/types.js';

describe('InMemoryMemoryManager', () => {
	let mem: InMemoryMemoryManager;
	const emb = new DefaultHashEmbedder();

	beforeEach(() => {
		mem = new InMemoryMemoryManager();
	});

	it('upsert creates memory node', () => {
		const n = mem.upsert({
			id: 'm1',
			label: 'pref',
			scope: 'preference',
			content: 'use strict TypeScript',
			priority: 1,
			importance: 0.9,
			tags: ['ts'],
		});
		expect(n.kind).toBe('memory');
		expect(mem.get('m1')?.id).toBe('m1');
	});

	it('upsert increments version', () => {
		mem.upsert({
			id: 'm1',
			label: 'a',
			scope: 'session',
			content: 'v1',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		const n = mem.upsert({
			id: 'm1',
			label: 'a',
			scope: 'session',
			content: 'v2',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		expect(n.version).toBe(2);
	});

	it('remove deletes', () => {
		mem.upsert({
			id: 'm1',
			label: 'a',
			scope: 'user',
			content: 'x',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		mem.remove('m1');
		expect(mem.get('m1')).toBeUndefined();
	});

	it('list all scopes', () => {
		mem.upsert({
			id: 'a',
			label: 'a',
			scope: 'user',
			content: 'u',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		mem.upsert({
			id: 'b',
			label: 'b',
			scope: 'project',
			content: 'p',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		expect(mem.list()).toHaveLength(2);
	});

	const scopes: MemoryScope[] = [
		'session',
		'project',
		'repository',
		'user',
		'agent',
		'failure',
		'benchmark',
		'preference',
	];

	for (const scope of scopes) {
		it(`supports scope=${scope}`, () => {
			mem.upsert({
				id: scope,
				label: scope,
				scope,
				content: scope,
				priority: 1,
				importance: 0.5,
				tags: [scope],
			});
			expect(mem.list(scope)).toHaveLength(1);
		});
	}

	it('list filters by scope', () => {
		mem.upsert({
			id: 'a',
			label: 'a',
			scope: 'user',
			content: 'u',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		mem.upsert({
			id: 'b',
			label: 'b',
			scope: 'agent',
			content: 'a',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		expect(mem.list('user')).toHaveLength(1);
	});

	it('touch updates lastUsed', () => {
		mem.upsert({
			id: 'a',
			label: 'a',
			scope: 'session',
			content: 'x',
			priority: 1,
			importance: 0.5,
			tags: [],
			lastUsed: 1,
		});
		mem.touch('a');
		expect(mem.get('a')!.lastUsed).toBeGreaterThan(1);
	});

	it('touch missing is no-op', () => {
		expect(() => mem.touch('missing')).not.toThrow();
	});

	it('semanticSearch returns topK', () => {
		mem.upsert({
			id: 'a',
			label: 'ts',
			scope: 'preference',
			content: 'TypeScript strict mode',
			priority: 1,
			importance: 0.9,
			tags: [],
			embedding: emb.embed('TypeScript strict mode'),
		});
		mem.upsert({
			id: 'b',
			label: 'food',
			scope: 'session',
			content: 'pizza recipes',
			priority: 9,
			importance: 0.1,
			tags: [],
			embedding: emb.embed('pizza recipes'),
		});
		const hits = mem.semanticSearch(emb.embed('typescript coding'), 1);
		expect(hits).toHaveLength(1);
		expect(hits[0]!.id).toBe('a');
	});

	it('semanticSearch respects scope filter', () => {
		mem.upsert({
			id: 'a',
			label: 'a',
			scope: 'user',
			content: 'auth',
			priority: 1,
			importance: 0.9,
			tags: [],
			embedding: emb.embed('auth'),
		});
		mem.upsert({
			id: 'b',
			label: 'b',
			scope: 'session',
			content: 'auth session',
			priority: 1,
			importance: 0.9,
			tags: [],
			embedding: emb.embed('auth'),
		});
		expect(mem.semanticSearch(emb.embed('auth'), 5, 'user')).toHaveLength(1);
	});

	it('memoryHash stable', () => {
		mem.upsert({
			id: 'a',
			label: 'a',
			scope: 'user',
			content: 'x',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		expect(mem.memoryHash()).toBe(mem.memoryHash());
	});

	it('memoryHash changes on upsert', () => {
		mem.upsert({
			id: 'a',
			label: 'a',
			scope: 'user',
			content: 'x',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		const h = mem.memoryHash();
		mem.upsert({
			id: 'b',
			label: 'b',
			scope: 'user',
			content: 'y',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		expect(mem.memoryHash()).not.toBe(h);
	});

	it('ttl expires entries on list', () => {
		mem.upsert({
			id: 'old',
			label: 'old',
			scope: 'session',
			content: 'gone',
			priority: 1,
			importance: 0.5,
			tags: [],
			ttl: 1,
		});
		const n = mem.get('old')!;
		n.lastModified = Date.now() - 10_000;
		mem['memories'].set('old', n);
		expect(mem.list()).toHaveLength(0);
	});

	it('assigns hash from content', () => {
		const n = mem.upsert({
			id: 'a',
			label: 'a',
			scope: 'user',
			content: 'unique-content',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		expect(n.hash.length).toBeGreaterThan(8);
	});

	it('tokenCount positive', () => {
		const n = mem.upsert({
			id: 'a',
			label: 'a',
			scope: 'user',
			content: 'hello world memory',
			priority: 1,
			importance: 0.5,
			tags: [],
		});
		expect(n.tokenCount).toBeGreaterThan(0);
	});

	it('never injects all — semanticSearch limits', () => {
		for (let i = 0; i < 20; i++) {
			mem.upsert({
				id: `m${i}`,
				label: `m${i}`,
				scope: 'session',
				content: `item ${i}`,
				priority: i,
				importance: 0.5,
				tags: [],
				embedding: emb.embed(`item ${i}`),
			});
		}
		expect(mem.semanticSearch(emb.embed('item 3'), 3)).toHaveLength(3);
	});
});
