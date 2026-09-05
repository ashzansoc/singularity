/**
 * Prompt Engine v3 benches — intelligence + knapsack + warm compile.
 */
import { bench, describe } from 'vitest';
import { createPromptEngine } from '../src/engine.js';
import { WeightedKnapsackBudgetOptimizer } from '../src/budget/knapsack.js';
import { scoreContextNode } from '../src/intelligence/qualityScorer.js';
import { InMemoryContextGraph } from '../src/graph/contextGraph.js';
import { DefaultHashEmbedder } from '../src/embed/hashEmbedder.js';

const SAMPLE = `
export function authenticate(user: string, password: string) {
  const hash = hashPassword(password);
  return db.users.find({ user, hash });
}
`.repeat(15);

describe('v3 benches', () => {
	bench('quality scorer × 200 nodes', () => {
		const emb = new DefaultHashEmbedder();
		const q = emb.embed('authenticate');
		for (let i = 0; i < 200; i++) {
			const node = InMemoryContextGraph.makeNode({
				id: `n${i}`,
				kind: 'function',
				label: `fn${i}`,
				content: SAMPLE.slice(0, 200),
				embedding: emb.embed(`fn${i} authenticate`),
			});
			scoreContextNode({ node, queryEmbedding: q });
		}
	});

	bench('knapsack 100 candidates', () => {
		const opt = new WeightedKnapsackBudgetOptimizer();
		const cands = Array.from({ length: 100 }, (_, i) => ({
			id: `c${i}`,
			value: 100 - (i % 40),
			weight: 20 + (i % 50),
			text: 'x',
			required: i < 2,
		}));
		opt.optimize(cands, 2000);
	});

	bench('warm v3 compile + cache', async () => {
		const engine = createPromptEngine({ workspaceId: 'bench-v3', budgetTokens: 8000 });
		const req = {
			sessionId: 'b',
			prompt: 'Explain authenticate',
			intent: 'EXPLAIN',
			provider: 'openai',
			files: [
				{ uri: 'file:///auth.ts', content: SAMPLE, version: 1, languageId: 'typescript' },
			],
			retrieval: { cursorUri: 'file:///auth.ts', selectionText: 'authenticate' },
		};
		await engine.run(req);
		await engine.run({ ...req, files: undefined });
	});
});
