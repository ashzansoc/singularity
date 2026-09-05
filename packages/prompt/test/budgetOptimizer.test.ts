/**
 * Budget optimizers — unit tests (no LLM)
 */
import { describe, expect, it } from 'vitest';
import { optimizeBudget, DefaultBudgetOptimizer, BUDGET_PRIORITY } from '../src/budget/optimizer.js';
import { WeightedKnapsackBudgetOptimizer } from '../src/budget/knapsack.js';
import { DefaultAdaptiveBudgetLearner } from '../src/budget/adaptiveBudgets.js';
import { defaultBudget } from '../src/intelligence/contextIntelligence.js';

describe('optimizeBudget (legacy)', () => {
	it('keeps userPrompt under tight budget', () => {
		const r = optimizeBudget(
			[
				{ id: 'userPrompt', text: 'hi', tokenCount: 10 },
				{ id: 'memory', text: 'm'.repeat(400), tokenCount: 400 },
			],
			{ budgetTokens: 50 },
		);
		expect(r.kept.some((k) => k.id === 'userPrompt')).toBe(true);
		expect(r.totalTokens).toBeLessThanOrEqual(50);
	});

	it('never exceeds budget', () => {
		const r = optimizeBudget(
			[
				{ id: 'repository', text: 'r'.repeat(1000), tokenCount: 500 },
				{ id: 'retrieval', text: 't'.repeat(1000), tokenCount: 500 },
			],
			{ budgetTokens: 100 },
		);
		expect(r.totalTokens).toBeLessThanOrEqual(100);
	});

	it('truncates truncatable items', () => {
		const r = optimizeBudget(
			[{ id: 'repository', text: 'x'.repeat(400), tokenCount: 200, truncatable: true }],
			{ budgetTokens: 80 },
		);
		expect(r.truncated.length + r.kept.length).toBeGreaterThan(0);
	});

	it('drops when cannot fit', () => {
		const r = optimizeBudget(
			[{ id: 'memory', text: 'big', tokenCount: 5000 }],
			{ budgetTokens: 50 },
		);
		expect(r.dropped).toContain('memory');
	});

	it('BUDGET_PRIORITY has system highest (lowest number)', () => {
		expect(BUDGET_PRIORITY.system).toBeLessThan(BUDGET_PRIORITY.memory);
	});

	it('empty items → empty kept', () => {
		expect(optimizeBudget([], { budgetTokens: 100 }).kept).toEqual([]);
	});

	it('skips zero-token items', () => {
		const r = optimizeBudget([{ id: 'userPrompt', text: '', tokenCount: 0 }], {
			budgetTokens: 100,
		});
		expect(r.kept).toEqual([]);
	});
});

describe('DefaultBudgetOptimizer', () => {
	const opt = new DefaultBudgetOptimizer();

	it('sorts by priority ascending', () => {
		const r = opt.optimize(
			[
				{ id: 'low', priority: 9, tokenCount: 10, text: 'low' },
				{ id: 'high', priority: 1, tokenCount: 10, text: 'high' },
			],
			30,
		);
		expect(r.kept[0]!.id).toBe('high');
	});

	it('respects hard budget', () => {
		const r = opt.optimize(
			[
				{ id: 'a', priority: 1, tokenCount: 60, text: 'a' },
				{ id: 'b', priority: 2, tokenCount: 60, text: 'b' },
			],
			100,
		);
		expect(r.totalTokens).toBeLessThanOrEqual(100);
	});

	for (const budget of [16, 64, 256, 1024, 4096]) {
		it(`works with budget=${budget}`, () => {
			const r = opt.optimize(
				[{ id: 'a', priority: 1, tokenCount: 10, text: 'hello' }],
				budget,
			);
			expect(r.budgetTokens).toBeGreaterThanOrEqual(16);
			expect(r.totalTokens).toBeLessThanOrEqual(r.budgetTokens);
		});
	}
});

describe('WeightedKnapsackBudgetOptimizer', () => {
	const knap = new WeightedKnapsackBudgetOptimizer();

	it('always includes required', () => {
		const r = knap.optimize(
			[
				{ id: 'req', value: 1, weight: 50, required: true, text: 'r' },
				{ id: 'opt', value: 100, weight: 50, text: 'o' },
			],
			60,
		);
		expect(r.selected.some((s) => s.id === 'req')).toBe(true);
	});

	it('includes dependencies of required', () => {
		const r = knap.optimize(
			[
				{ id: 'req', value: 1, weight: 10, required: true, text: 'r', dependencies: ['dep'] },
				{ id: 'dep', value: 1, weight: 10, text: 'd' },
			],
			100,
		);
		expect(r.selected.map((s) => s.id).sort()).toEqual(['dep', 'req']);
	});

	it('prefers high density', () => {
		const r = knap.optimize(
			[
				{ id: 'dense', value: 100, weight: 10, text: 'd' },
				{ id: 'sparse', value: 20, weight: 10, text: 's' },
			],
			15,
		);
		expect(r.selected.some((s) => s.id === 'dense')).toBe(true);
	});

	it('never exceeds budget for optional', () => {
		const r = knap.optimize(
			[
				{ id: 'a', value: 10, weight: 40, text: 'a' },
				{ id: 'b', value: 10, weight: 40, text: 'b' },
				{ id: 'c', value: 10, weight: 40, text: 'c' },
			],
			90,
		);
		expect(r.totalWeight).toBeLessThanOrEqual(90);
	});

	it('handles circular dependencies without hang', () => {
		const r = knap.optimize(
			[
				{ id: 'a', value: 10, weight: 10, text: 'a', dependencies: ['b'] },
				{ id: 'b', value: 10, weight: 10, text: 'b', dependencies: ['a'] },
			],
			100,
		);
		expect(r.selected.length).toBeGreaterThan(0);
	});

	it('empty candidates', () => {
		expect(knap.optimize([], 100).selected).toEqual([]);
	});

	it('reports dropped ids', () => {
		const r = knap.optimize(
			[
				{ id: 'a', value: 1, weight: 80, text: 'a' },
				{ id: 'b', value: 1, weight: 80, text: 'b' },
			],
			90,
		);
		expect(r.dropped.length).toBeGreaterThan(0);
	});

	it('prefers many small over one large', () => {
		const r = knap.optimize(
			[
				{ id: 'big', value: 30, weight: 90, text: 'big' },
				{ id: 's1', value: 20, weight: 30, text: 's1' },
				{ id: 's2', value: 20, weight: 30, text: 's2' },
				{ id: 's3', value: 20, weight: 30, text: 's3' },
			],
			100,
		);
		const ids = r.selected.map((s) => s.id);
		expect(ids.filter((id) => id.startsWith('s')).length).toBeGreaterThanOrEqual(2);
	});

	for (let i = 0; i < 10; i++) {
		it(`random density case #${i}`, () => {
			const cands = Array.from({ length: 20 }, (_, j) => ({
				id: `c${j}`,
				value: 1 + ((i * 7 + j * 3) % 50),
				weight: 5 + ((i * 5 + j) % 40),
				text: 'x',
				required: j === 0,
			}));
			const r = knap.optimize(cands, 200);
			expect(r.totalWeight).toBeLessThanOrEqual(200);
			expect(r.selected.some((s) => s.id === 'c0')).toBe(true);
		});
	}
});

describe('AdaptiveBudgetLearner', () => {
	it('starts at default', () => {
		const b = new DefaultAdaptiveBudgetLearner();
		expect(b.recommend({ task: 'edit' })).toBe(defaultBudget('edit'));
	});

	it('moves toward observed usage after samples', () => {
		const b = new DefaultAdaptiveBudgetLearner();
		const key = { task: 'edit' as const, language: 'typescript' };
		const before = b.recommend(key);
		for (let i = 0; i < 10; i++) {
			b.observe(key, 3000, 'accepted');
		}
		expect(b.recommend(key)).not.toBe(before);
	});

	it('increases on regenerated', () => {
		const b = new DefaultAdaptiveBudgetLearner();
		const key = { task: 'debug' as const };
		for (let i = 0; i < 8; i++) {
			b.observe(key, defaultBudget('debug'), 'regenerated');
		}
		expect(b.recommend(key)).toBeGreaterThanOrEqual(defaultBudget('debug') * 0.9);
	});

	it('dump exposes stats', () => {
		const b = new DefaultAdaptiveBudgetLearner();
		b.observe({ task: 'plan' }, 1000, 'success');
		expect(Object.keys(b.dump()).length).toBeGreaterThan(0);
	});

	for (const lang of ['typescript', 'python', 'rust', 'go', 'cpp', 'javascript']) {
		it(`tracks language=${lang}`, () => {
			const b = new DefaultAdaptiveBudgetLearner();
			const key = { task: 'edit' as const, language: lang };
			b.observe(key, 5000, 'accepted');
			expect(b.dump()[`edit|${lang}|*`]).toBeDefined();
		});
	}

	for (const size of ['small', 'large'] as const) {
		it(`tracks repoSize=${size}`, () => {
			const b = new DefaultAdaptiveBudgetLearner();
			b.observe({ task: 'architecture', repoSize: size }, 20_000, 'success');
			expect(b.recommend({ task: 'architecture', repoSize: size })).toBeGreaterThan(0);
		});
	}
});
