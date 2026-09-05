/**
 * Context Graph — unit tests (no LLM)
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryContextGraph } from '../src/graph/contextGraph.js';
import { DefaultGraphDiffEngine } from '../src/graph/graphDiff.js';

describe('InMemoryContextGraph', () => {
	let g: InMemoryContextGraph;

	beforeEach(() => {
		g = new InMemoryContextGraph();
	});

	it('upsert and get node', () => {
		const n = InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a' });
		g.upsertNode(n);
		expect(g.getNode('a')?.label).toBe('a');
	});

	it('remove node', () => {
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a' }));
		g.removeNode('a');
		expect(g.getNode('a')).toBeUndefined();
	});

	it('listNodes filters by kind', () => {
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'f', kind: 'file', label: 'f' }));
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'fn', kind: 'function', label: 'fn' }));
		expect(g.listNodes('file')).toHaveLength(1);
		expect(g.listNodes('function')).toHaveLength(1);
	});

	it('listNodes without kind returns all', () => {
		g.upsertNode(InMemoryContextGraph.makeNode({ id: '1', kind: 'file', label: '1' }));
		g.upsertNode(InMemoryContextGraph.makeNode({ id: '2', kind: 'memory', label: '2' }));
		expect(g.listNodes().length).toBe(2);
	});

	it('addEdge and neighbors', () => {
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'p', kind: 'file', label: 'p' }));
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'c', kind: 'function', label: 'c' }));
		g.addEdge({ id: 'e1', from: 'p', to: 'c', kind: 'contains' });
		expect(g.neighbors('p').map((n) => n.id)).toContain('c');
	});

	it('neighbors filter by edge kind', () => {
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a' }));
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'b', kind: 'file', label: 'b' }));
		g.addEdge({ id: 'e1', from: 'a', to: 'b', kind: 'imports' });
		expect(g.neighbors('a', 'contains')).toHaveLength(0);
		expect(g.neighbors('a', 'imports')).toHaveLength(1);
	});

	it('removeEdges clears adjacency', () => {
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a' }));
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'b', kind: 'file', label: 'b' }));
		g.addEdge({ id: 'e1', from: 'a', to: 'b', kind: 'contains' });
		g.removeEdges('a');
		expect(g.neighbors('a')).toHaveLength(0);
	});

	it('repoHash stable for same files', () => {
		g.upsertNode(
			InMemoryContextGraph.makeNode({ id: 'file:a', kind: 'file', label: 'a', content: 'x' }),
		);
		const h1 = g.repoHash();
		const h2 = g.repoHash();
		expect(h1).toBe(h2);
	});

	it('repoHash changes when file hash changes', () => {
		g.upsertNode(
			InMemoryContextGraph.makeNode({ id: 'file:a', kind: 'file', label: 'a', content: 'x' }),
		);
		const h1 = g.repoHash();
		g.upsertNode(
			InMemoryContextGraph.makeNode({ id: 'file:a', kind: 'file', label: 'a', content: 'y' }),
		);
		expect(g.repoHash()).not.toBe(h1);
	});

	it('snapshot returns nodes and edges', () => {
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a' }));
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'b', kind: 'file', label: 'b' }));
		g.addEdge({ id: 'e', from: 'a', to: 'b', kind: 'related_to' });
		const s = g.snapshot();
		expect(s.nodes).toHaveLength(2);
		expect(s.edges).toHaveLength(1);
	});

	it('materialize uses content when present', () => {
		g.upsertNode(
			InMemoryContextGraph.makeNode({
				id: 'a',
				kind: 'file',
				label: 'a',
				content: 'hello body',
			}),
		);
		expect(g.materialize('a')).toContain('hello body');
	});

	it('materialize falls back to label', () => {
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'OnlyLabel' }));
		expect(g.materialize('a')).toContain('OnlyLabel');
	});

	it('materialize missing node returns empty', () => {
		expect(g.materialize('missing')).toBe('');
	});

	it('fileId helper', () => {
		expect(InMemoryContextGraph.fileId('file:///x')).toBe('file:file:///x');
	});

	it('makeNode assigns hash', () => {
		const n = InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a', content: 'z' });
		expect(n.hash.length).toBeGreaterThan(8);
	});

	it('makeNode estimates tokens', () => {
		const n = InMemoryContextGraph.makeNode({
			id: 'a',
			kind: 'file',
			label: 'a',
			content: 'abcd'.repeat(10),
		});
		expect(n.tokenCount).toBeGreaterThan(0);
	});

	it('makeNode preserves version', () => {
		const n = InMemoryContextGraph.makeNode({
			id: 'a',
			kind: 'file',
			label: 'a',
			version: 9,
		});
		expect(n.version).toBe(9);
	});

	it('upsert overwrites', () => {
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'old' }));
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'new' }));
		expect(g.getNode('a')?.label).toBe('new');
	});

	const kinds = [
		'repository',
		'folder',
		'file',
		'class',
		'function',
		'interface',
		'import',
		'export',
		'reference',
		'symbol',
		'diagnostic',
		'terminal',
		'conversation',
		'memory',
		'agent',
		'git',
		'selection',
		'userPrompt',
		'system',
		'summary',
	] as const;

	for (const kind of kinds) {
		it(`accepts kind=${kind}`, () => {
			g.upsertNode(InMemoryContextGraph.makeNode({ id: kind, kind, label: kind }));
			expect(g.getNode(kind)?.kind).toBe(kind);
		});
	}

	it('removeNode also removes edges', () => {
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a' }));
		g.upsertNode(InMemoryContextGraph.makeNode({ id: 'b', kind: 'file', label: 'b' }));
		g.addEdge({ id: 'e', from: 'a', to: 'b', kind: 'contains' });
		g.removeNode('a');
		expect(g.neighbors('a')).toHaveLength(0);
	});
});

describe('GraphDiffEngine', () => {
	const diff = new DefaultGraphDiffEngine();

	it('detects added', () => {
		const d = diff.diff(
			{ nodes: [] },
			{ nodes: [InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a' })] },
		);
		expect(d.added).toContain('a');
	});

	it('detects removed', () => {
		const d = diff.diff(
			{ nodes: [InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a' })] },
			{ nodes: [] },
		);
		expect(d.removed).toContain('a');
	});

	it('detects changed by hash', () => {
		const a = InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a', content: '1' });
		const b = InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a', content: '2' });
		expect(diff.diff({ nodes: [a] }, { nodes: [b] }).changed).toContain('a');
	});

	it('unchanged when hash same', () => {
		const a = InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a', content: '1' });
		const b = InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a', content: '1' });
		expect(diff.diff({ nodes: [a] }, { nodes: [b] }).unchanged).toContain('a');
	});

	it('affectedSubtree includes changed', () => {
		const a = InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a', content: '1' });
		const b = InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a', content: '2' });
		expect(diff.diff({ nodes: [a] }, { nodes: [b] }).affectedSubtree).toContain('a');
	});

	it('expands dependents via dependencies', () => {
		const parent = InMemoryContextGraph.makeNode({
			id: 'p',
			kind: 'file',
			label: 'p',
			content: '1',
		});
		const child = InMemoryContextGraph.makeNode({
			id: 'c',
			kind: 'function',
			label: 'c',
			content: 'x',
			dependencies: ['p'],
		});
		const parent2 = InMemoryContextGraph.makeNode({
			id: 'p',
			kind: 'file',
			label: 'p',
			content: '2',
		});
		const d = diff.diff({ nodes: [parent, child] }, { nodes: [parent2, child] });
		expect(d.affectedSubtree).toContain('c');
	});

	it('empty to empty', () => {
		const d = diff.diff({ nodes: [] }, { nodes: [] });
		expect(d.added).toEqual([]);
		expect(d.removed).toEqual([]);
	});

	it('multiple adds', () => {
		const d = diff.diff(
			{ nodes: [] },
			{
				nodes: [
					InMemoryContextGraph.makeNode({ id: 'a', kind: 'file', label: 'a' }),
					InMemoryContextGraph.makeNode({ id: 'b', kind: 'file', label: 'b' }),
				],
			},
		);
		expect(d.added.sort()).toEqual(['a', 'b']);
	});
});
