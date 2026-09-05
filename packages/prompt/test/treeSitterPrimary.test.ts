import { describe, expect, it, beforeAll } from 'vitest';
import {
	ensureTreeSitterReady,
	isTreeSitterReady,
	setAllowFallback,
	TreeSitterTypeScriptExtractor,
	TreeSitterPythonExtractor,
	structuralExtractTypeScript,
	createPromptEngine,
} from '../src/index.js';

describe('Tree-sitter PRIMARY symbol extraction', () => {
	beforeAll(async () => {
		setAllowFallback(true);
		const ok = await ensureTreeSitterReady({ allowFallback: true });
		expect(ok).toBe(true);
		expect(isTreeSitterReady()).toBe(true);
	}, 30_000);

	it('parses TypeScript via Tree-sitter (not fallback)', () => {
		const ext = new TreeSitterTypeScriptExtractor();
		const src = `
export function complete(req: string) {
  const x = 1;
  return x + req.length;
}

export class Foo {
  bar() { return 1; }
}

export interface Opts {
  a: number;
}
`;
		const r = ext.extract({
			uri: 'file:///a.ts',
			content: src,
			languageId: 'typescript',
		});
		expect(ext.lastBackend).toBe('tree-sitter');
		expect(r.symbols.some((s) => s.name === 'complete' && (s.content?.length ?? 0) > 40)).toBe(
			true,
		);
		expect(r.symbols.some((s) => s.kind === 'class' && s.name === 'Foo')).toBe(true);
		expect(r.symbols.some((s) => s.kind === 'interface' && s.name === 'Opts')).toBe(true);
		expect(r.exports.some((e) => e.name === 'Foo' || e.name === 'complete')).toBe(true);
	});

	it('parses Python via Tree-sitter', () => {
		const ext = new TreeSitterPythonExtractor();
		const src = `
def hello(name):
    x = 1
    return name

class A:
    def m(self):
        return 1
`;
		const r = ext.extract({
			uri: 'file:///a.py',
			content: src,
			languageId: 'python',
		});
		expect(ext.lastBackend).toBe('tree-sitter');
		expect(r.symbols.some((s) => s.name === 'hello' && s.content?.includes('return'))).toBe(
			true,
		);
		expect(r.symbols.some((s) => s.name === 'A' && s.kind === 'class')).toBe(true);
	});

	it('indexes repo map through Tree-sitter-backed engine', async () => {
		const eng = createPromptEngine({ workspaceId: 'ts-primary' });
		await eng.indexFiles([
			{
				uri: 'file:///pkg/runtime.ts',
				content: `
export function complete(req: string) {
  return req;
}
export function buildRequest() {
  return {};
}
`,
				version: 1,
				languageId: 'typescript',
			},
		]);
		expect(isTreeSitterReady()).toBe(true);
		const stats = eng.repoMap.stats();
		expect(stats.symbols).toBeGreaterThanOrEqual(2);
	});

	it('optional fallback remains available as secondary path', () => {
		const structural = structuralExtractTypeScript('export function z() { return 1; }');
		expect(structural.symbols.some((s) => s.name === 'z')).toBe(true);
	});

	it('can disable fallback (Tree-sitter only)', async () => {
		setAllowFallback(false);
		const ext = new TreeSitterTypeScriptExtractor();
		const r = ext.extract({
			uri: 'file:///b.ts',
			content: 'export function onlyTs() { return 2; }',
			languageId: 'typescript',
		});
		// With Tree-sitter ready, still primary
		expect(ext.lastBackend).toBe('tree-sitter');
		expect(r.symbols.some((s) => s.name === 'onlyTs')).toBe(true);
		setAllowFallback(true);
	});
});
