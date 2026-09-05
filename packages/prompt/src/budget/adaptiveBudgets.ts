/**
 * Feature 4 — Adaptive Context Budgets learned from telemetry.
 */

import { defaultBudget, intentToTask } from '../intelligence/contextIntelligence.js';
import type {
	AdaptiveBudgetKey,
	AdaptiveBudgetLearner,
	OutcomeSignal,
	TaskBudgetKind,
} from '../interfaces/v3.js';

interface BudgetStat {
	ema: number;
	samples: number;
}

function keyOf(k: AdaptiveBudgetKey): string {
	return `${k.task}|${(k.language ?? '*').toLowerCase()}|${k.repoSize ?? '*'}`;
}

export class DefaultAdaptiveBudgetLearner implements AdaptiveBudgetLearner {
	private readonly stats = new Map<string, BudgetStat>();

	recommend(key: AdaptiveBudgetKey): number {
		const exact = this.stats.get(keyOf(key));
		if (exact && exact.samples >= 3) {
			return Math.round(exact.ema);
		}
		const langWild = this.stats.get(keyOf({ ...key, language: undefined }));
		if (langWild && langWild.samples >= 3) {
			return Math.round(langWild.ema);
		}
		return defaultBudget(key.task);
	}

	observe(key: AdaptiveBudgetKey, usedTokens: number, outcome: OutcomeSignal): void {
		const k = keyOf(key);
		const prev = this.stats.get(k) ?? {
			ema: defaultBudget(key.task),
			samples: 0,
		};

		let target = usedTokens;
		if (outcome === 'regenerated' || outcome === 'failed' || outcome === 'tool_failure') {
			target = usedTokens * 1.25;
		} else if (outcome === 'accepted' || outcome === 'success') {
			target = usedTokens * 0.95;
		}

		const alpha = prev.samples < 5 ? 0.4 : 0.15;
		const ema = prev.ema * (1 - alpha) + target * alpha;
		this.stats.set(k, { ema: clampBudget(ema, key.task), samples: prev.samples + 1 });
	}

	/** Expose for tests / debug. */
	dump(): Record<string, BudgetStat> {
		return Object.fromEntries(this.stats);
	}
}

function clampBudget(n: number, task: TaskBudgetKind): number {
	const min = Math.floor(defaultBudget(task) * 0.4);
	const max = Math.ceil(defaultBudget(task) * 2.5);
	return Math.max(min, Math.min(max, n));
}

export { intentToTask, defaultBudget };
