/**
 * Incremental Indexer — unit tests (no LLM)
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryContextGraph } from '../src/graph/contextGraph.js';
import { DefaultIncrementalIndexer } from '../src/indexer/incrementalIndexer.js';
import { TypeScriptExtractor, PythonExtractor, pickExtractor, defaultExtractors } from '../src/indexer/extractors.js';
import { DefaultHashEmbedder } from '../src/embed/hashEmbedder.js';

describe('IncrementalIndexer', () => {
	let graph: InMemoryContextGraph;
	let indexer: DefaultIncrementalIndexer;

	beforeEach(() => {
		graph = new InMemoryContextGraph();
		indexer = new DefaultIncrementalIndexer({
			graph,
			embedder: new DefaultHashEmbedder(),
			repositoryId: 'repo:test',
		});
	});

	it('creates repository node on construct', () => {
		expect(graph.getNode('repo:test')?.kind).toBe('repository');
	});

	it('indexes a typescript file into a file node', async () => {
		await indexer.indexFile({
			uri: 'file:///a.ts',
			content: 'export function foo() { return 1; }',
			version: 1,
			languageId: 'typescript',
		});
		expect(graph.getNode('file:file:///a.ts')?.kind).toBe('file');
	});

	it('extracts function symbols', async () => {
		await indexer.indexFile({
			uri: 'file:///a.ts',
			content: 'export function alpha() {}\nexport function beta() {}',
			version: 1,
			languageId: 'typescript',
		});
		const fns = graph.listNodes('function');
		expect(fns.length).toBeGreaterThanOrEqual(2);
	});

	it('extracts class symbols', async () => {
		await indexer.indexFile({
			uri: 'file:///c.ts',
			content: 'export class UserService {}',
			version: 1,
			languageId: 'typescript',
		});
		expect(graph.listNodes('class').some((n) => n.label === 'UserService')).toBe(true);
	});

	it('extracts interface symbols', async () => {
		await indexer.indexFile({
			uri: 'file:///i.ts',
			content: 'export interface IRepo {}',
			version: 1,
			languageId: 'typescript',
		});
		expect(graph.listNodes('interface').some((n) => n.label === 'IRepo')).toBe(true);
	});

	it('extracts imports', async () => {
		await indexer.indexFile({
			uri: 'file:///imp.ts',
			content: `import { x } from './x';\nimport y from 'y';`,
			version: 1,
			languageId: 'typescript',
		});
		expect(graph.listNodes('import').length).toBeGreaterThan(0);
	});

	it('extracts exports', async () => {
		await indexer.indexFile({
			uri: 'file:///exp.ts',
			content: 'export function z() {}',
			version: 1,
			languageId: 'typescript',
		});
		expect(graph.listNodes('export').length).toBeGreaterThan(0);
	});

	it('is idempotent for unchanged content', async () => {
		const evt = {
			uri: 'file:///same.ts',
			content: 'export const a = 1;',
			version: 1,
			languageId: 'typescript',
		};
		await indexer.indexFile(evt);
		indexer.clearDirty();
		await indexer.indexFile(evt);
		expect(indexer.dirtyUris()).toEqual([]);
	});

	it('marks dirty when content changes', async () => {
		await indexer.indexFile({
			uri: 'file:///d.ts',
			content: 'v1',
			version: 1,
			languageId: 'typescript',
		});
		indexer.clearDirty();
		await indexer.indexFile({
			uri: 'file:///d.ts',
			content: 'v2',
			version: 2,
			languageId: 'typescript',
		});
		expect(indexer.dirtyUris()).toContain('file:///d.ts');
	});

	it('stores content hash via getFileHash', async () => {
		await indexer.indexFile({
			uri: 'file:///h.ts',
			content: 'hello',
			version: 1,
			languageId: 'typescript',
		});
		expect(indexer.getFileHash('file:///h.ts')).toBeTruthy();
	});

	it('removes file and children', async () => {
		await indexer.indexFile({
			uri: 'file:///rm.ts',
			content: 'export function gone() {}',
			version: 1,
			languageId: 'typescript',
		});
		indexer.removeFile('file:///rm.ts');
		expect(graph.getNode('file:file:///rm.ts')).toBeUndefined();
	});

	it('handles removed flag on indexFile', async () => {
		await indexer.indexFile({
			uri: 'file:///x.ts',
			content: 'a',
			version: 1,
			languageId: 'typescript',
		});
		await indexer.indexFile({
			uri: 'file:///x.ts',
			content: '',
			version: 2,
			languageId: 'typescript',
			removed: true,
		});
		expect(graph.getNode('file:file:///x.ts')).toBeUndefined();
	});

	it('indexes python defs', async () => {
		await indexer.indexFile({
			uri: 'file:///a.py',
			content: 'def hello():\n  pass\nclass Foo:\n  pass\n',
			version: 1,
			languageId: 'python',
		});
		expect(graph.listNodes('function').some((n) => n.label === 'hello')).toBe(true);
		expect(graph.listNodes('class').some((n) => n.label === 'Foo')).toBe(true);
	});

	it('attaches embedding to file node', async () => {
		await indexer.indexFile({
			uri: 'file:///e.ts',
			content: 'export const emb = true;',
			version: 1,
			languageId: 'typescript',
		});
		expect(graph.getNode('file:file:///e.ts')?.embedding?.length).toBeGreaterThan(0);
	});

	it('links file to repository via contains edge', async () => {
		await indexer.indexFile({
			uri: 'file:///link.ts',
			content: 'export const x = 1;',
			version: 1,
			languageId: 'typescript',
		});
		const kids = graph.neighbors('repo:test', 'contains');
		expect(kids.some((n) => n.id.includes('link.ts'))).toBe(true);
	});

	it('clearDirty empties dirty set', async () => {
		await indexer.indexFile({
			uri: 'file:///c.ts',
			content: 'a',
			version: 1,
			languageId: 'typescript',
		});
		expect(indexer.dirtyUris().length).toBeGreaterThan(0);
		indexer.clearDirty();
		expect(indexer.dirtyUris()).toEqual([]);
	});

	it('reindex replaces prior symbols', async () => {
		await indexer.indexFile({
			uri: 'file:///r.ts',
			content: 'export function oldFn() {}',
			version: 1,
			languageId: 'typescript',
		});
		await indexer.indexFile({
			uri: 'file:///r.ts',
			content: 'export function newFn() {}',
			version: 2,
			languageId: 'typescript',
		});
		const labels = graph.listNodes('function').map((n) => n.label);
		expect(labels).toContain('newFn');
		expect(labels.filter((l) => l === 'oldFn')).toHaveLength(0);
	});

	for (const lang of ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'] as const) {
		it(`supports languageId=${lang}`, async () => {
			await indexer.indexFile({
				uri: `file:///${lang}.ts`,
				content: 'export function f() {}',
				version: 1,
				languageId: lang,
			});
			expect(graph.getNode(`file:file:///${lang}.ts`)).toBeDefined();
		});
	}

	it('tokenCount is positive for non-empty file', async () => {
		await indexer.indexFile({
			uri: 'file:///t.ts',
			content: 'export const long = "abc".repeat(20);',
			version: 1,
			languageId: 'typescript',
		});
		expect(graph.getNode('file:file:///t.ts')!.tokenCount).toBeGreaterThan(0);
	});

	it('unknown language still creates file node', async () => {
		await indexer.indexFile({
			uri: 'file:///z.rs',
			content: 'fn main() {}',
			version: 1,
			languageId: 'rust',
		});
		expect(graph.getNode('file:file:///z.rs')).toBeDefined();
	});
});

describe('LanguageExtractors', () => {
	it('TypeScriptExtractor lists supported languages', () => {
		expect(new TypeScriptExtractor().languages).toContain('typescript');
	});

	it('PythonExtractor lists python', () => {
		expect(new PythonExtractor().languages).toContain('python');
	});

	it('defaultExtractors returns both', () => {
		expect(defaultExtractors().length).toBeGreaterThanOrEqual(2);
	});

	it('pickExtractor matches language', () => {
		const e = pickExtractor(defaultExtractors(), 'python');
		expect(e?.languages).toContain('python');
	});

	it('pickExtractor falls back', () => {
		expect(pickExtractor(defaultExtractors(), 'unknown')).toBeDefined();
	});

	it('extracts async function', () => {
		const r = new TypeScriptExtractor().extract({
			uri: 'u',
			content: 'export async function run() {}',
		});
		expect(r.symbols.some((s) => s.name === 'run')).toBe(true);
	});

	it('extracts const arrow-ish', () => {
		const r = new TypeScriptExtractor().extract({
			uri: 'u',
			content: 'export const run = () => {}',
		});
		expect(r.symbols.some((s) => s.name === 'run')).toBe(true);
	});

	it('python import from', () => {
		const r = new PythonExtractor().extract({
			uri: 'u',
			content: 'from os import path\nimport sys\n',
		});
		expect(r.imports.length).toBeGreaterThan(0);
	});

	it('handles empty content', () => {
		const r = new TypeScriptExtractor().extract({ uri: 'u', content: '' });
		expect(r.symbols).toEqual([]);
	});

	it('handles only comments', () => {
		const r = new TypeScriptExtractor().extract({
			uri: 'u',
			content: '// no code\n/* block */',
		});
		expect(r.symbols).toEqual([]);
	});
});
