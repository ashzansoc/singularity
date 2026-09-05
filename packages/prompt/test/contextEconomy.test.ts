import { describe, expect, it } from 'vitest';
import {
	structuralExtractTypeScript,
	structuralExtractPython,
	buildStructuredConversationPackage,
	optimizeBudget,
	priorityBand,
	buildEconomyReport,
	DefaultDeltaEngine,
	createPromptEngine,
	renderForProvider,
} from '../src/index.js';
import type { PromptIR } from '../src/ir/types.js';
import { IR_VERSION } from '../src/graph/types.js';

describe('Context Economy — extractors', () => {
	it('structural fallback still extracts TypeScript bodies (secondary path)', () => {
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
		const r = structuralExtractTypeScript(src);
		expect(r.symbols.some((s) => s.name === 'complete' && (s.content?.length ?? 0) > 40)).toBe(
			true,
		);
		expect(r.symbols.some((s) => s.kind === 'class' && s.name === 'Foo')).toBe(true);
		expect(r.symbols.some((s) => s.kind === 'interface' && s.name === 'Opts')).toBe(true);
	});

	it('structural fallback extracts Python defs (secondary path)', () => {
		const src = `
def hello(name):
    x = 1
    return name

class A:
    def m(self):
        return 1
`;
		const r = structuralExtractPython(src);
		expect(r.symbols.some((s) => s.name === 'hello' && s.content?.includes('return'))).toBe(
			true,
		);
		expect(r.symbols.some((s) => s.name === 'A' && s.kind === 'class')).toBe(true);
	});
});

describe('Context Economy — conversation package', () => {
	it('builds TASK / DECISIONS / RECENT structure', () => {
		const pkg = buildStructuredConversationPackage([
			{ id: '1', role: 'user', content: 'Fix OpenRouter caching', createdAt: 1 },
			{
				id: '2',
				role: 'assistant',
				content: 'Decision: we prefer Anthropic cache semantics. Found that providerExtras are stripped.',
				createdAt: 2,
			},
			{ id: '3', role: 'user', content: 'Wire it through', createdAt: 3 },
		]);
		expect(pkg.text).toContain('TASK');
		expect(pkg.text).toContain('DECISIONS');
		expect(pkg.text).toContain('RECENT CONVERSATION');
		expect(pkg.task).toMatch(/OpenRouter/);
	});
});

describe('Context Economy — budgeter', () => {
	it('drops P3 before P0', () => {
		const result = optimizeBudget(
			[
				{ id: 'system', text: 'sys '.repeat(100), tokenCount: 100, priority: 0 },
				{ id: 'user', text: 'user '.repeat(100), tokenCount: 100, priority: 1 },
				{ id: 'overview', text: 'old '.repeat(500), tokenCount: 500, priority: 12, truncatable: true },
			],
			{ budgetTokens: 250 },
		);
		expect(result.kept.some((k) => k.id === 'system')).toBe(true);
		expect(result.kept.some((k) => k.id === 'user')).toBe(true);
		expect(priorityBand(12)).toBe('p3');
		expect(result.allocation?.priorityBands.p0).toBeGreaterThan(0);
	});
});

describe('Context Economy — delta + fingerprints', () => {
	it('reuses unchanged blocks', () => {
		const block = {
			id: 'b1',
			role: 'system' as const,
			nodeIds: [],
			text: 'hello',
			estimatedTokens: 1,
			tokenCount: 1,
			priority: 0,
			hash: 'abc',
			dependencies: [],
			compressionLevel: 0,
			cacheBreakpoint: true,
		};
		const prior: PromptIR = {
			sessionId: 's',
			intent: 'GENERAL',
			blocks: [block],
			totalTokens: 1,
			budgetTokens: 100,
			droppedSegmentIds: [],
			irHash: 'h1',
			compiledAt: 1,
			compilerVersion: IR_VERSION,
		};
		const next: PromptIR = {
			...prior,
			blocks: [{ ...block, id: 'b1' }, { ...block, id: 'b2', role: 'user', hash: 'xyz', text: 'new', cacheBreakpoint: false }],
			totalTokens: 2,
		};
		const delta = new DefaultDeltaEngine().apply(prior, next);
		expect(delta.reusedBlockIds).toContain('b1');
		expect(delta.rebuiltBlockIds).toContain('b2');
		expect(delta.ir.metadata?.contextDiff?.unchanged).toContain('b1');
	});
});

describe('Context Economy — engine + provider cache hints', () => {
	it('indexes symbols and emits cache hints on render', async () => {
		const eng = createPromptEngine({ workspaceId: 'test-economy' });
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
		const stats = eng.repoMap.stats();
		expect(stats.files).toBeGreaterThanOrEqual(1);
		expect(stats.symbols).toBeGreaterThanOrEqual(1);

		const result = await eng.run({
			sessionId: 's1',
			prompt: 'Fix the complete function caching',
			systemPrompt: 'You are Singularity.',
			intent: 'DEBUG',
			provider: 'anthropic',
			files: [],
			budgetTokens: 4_000,
		});

		expect(result.fingerprint?.blockFingerprints?.length).toBeGreaterThan(0);
		const rendered = renderForProvider(result.ir, 'anthropic');
		expect(rendered.cacheHints?.promptCacheKey || rendered.cacheHints?.cacheControl).toBeTruthy();
		const economy = buildEconomyReport({ ir: result.ir, prompt: 'Fix caching', modelId: 'test' });
		expect(economy.inputTokens.total).toBeGreaterThan(0);
		expect(economy.fingerprintSha256).toBeTruthy();
	});
});
