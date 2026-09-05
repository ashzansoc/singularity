/**
 * Feature 2 — Weighted knapsack Context Budget Optimizer.
 * Prefer many high-value small nodes; never drop required; include dependencies.
 */

import type {
	KnapsackBudgetOptimizer,
	KnapsackCandidate,
	KnapsackResult,
} from '../interfaces/v3.js';

export class WeightedKnapsackBudgetOptimizer implements KnapsackBudgetOptimizer {
	optimize(candidates: KnapsackCandidate[], budget: number): KnapsackResult {
		const cap = Math.max(16, budget);
		const byId = new Map(candidates.map((c) => [c.id, c]));

		const selectedIds = new Set<string>();
		const visiting = new Set<string>();
		let totalWeight = 0;
		let totalValue = 0;

		const ensure = (id: string): boolean => {
			if (selectedIds.has(id)) {
				return true;
			}
			if (visiting.has(id)) {
				return false; // cycle
			}
			const c = byId.get(id);
			if (!c) {
				return false;
			}
			visiting.add(id);
			for (const dep of c.dependencies ?? []) {
				ensure(dep);
			}
			visiting.delete(id);
			if (selectedIds.has(id)) {
				return true;
			}
			if (totalWeight + c.weight > cap && !c.required) {
				return false;
			}
			if (totalWeight + c.weight > cap && c.required) {
				if (selectedIds.size === 0 || c.weight <= cap) {
					selectedIds.add(id);
					totalWeight = Math.min(cap, totalWeight + c.weight);
					totalValue += c.value;
					return true;
				}
				return false;
			}
			selectedIds.add(id);
			totalWeight += c.weight;
			totalValue += c.value;
			return true;
		};

		for (const c of candidates.filter((x) => x.required)) {
			ensure(c.id);
		}

		const optional = candidates
			.filter((c) => !c.required && !selectedIds.has(c.id))
			.map((c) => ({
				c,
				density: c.value / Math.max(1, c.weight),
			}))
			.sort((a, b) => b.density - a.density);

		for (const { c } of optional) {
			if (totalWeight >= cap) {
				break;
			}
			ensure(c.id);
		}

		const selected = [...selectedIds]
			.map((id) => byId.get(id)!)
			.filter(Boolean);
		const dropped = candidates.filter((c) => !selectedIds.has(c.id)).map((c) => c.id);

		return {
			selected,
			dropped,
			totalValue,
			totalWeight: Math.min(totalWeight, cap),
			budget: cap,
		};
	}
}
