/**
 * Feature 10 — Learning Engine
 * Continuous feedback updates usefulness, budgets signals, and model prefs.
 */

import type {
	LearningEngine,
	LearningEvent,
	NodeUsefulnessStats,
	OutcomeSignal,
} from '../interfaces/v3.js';

export class DefaultLearningEngine implements LearningEngine {
	private readonly events: LearningEvent[] = [];
	private readonly nodes = new Map<string, NodeUsefulnessStats>();
	private readonly layoutScores = new Map<string, { score: number; n: number }>();
	private readonly modelWins = new Map<string, Map<string, number>>();
	private readonly maxEvents: number;

	constructor(opts?: { maxEvents?: number }) {
		this.maxEvents = opts?.maxEvents ?? 2_000;
	}

	record(event: LearningEvent): void {
		this.events.push(event);
		while (this.events.length > this.maxEvents) {
			this.events.shift();
		}

		const positive =
			event.outcome === 'accepted' ||
			event.outcome === 'success' ||
			(event.userFeedback !== undefined && event.userFeedback > 0);
		const negative =
			event.outcome === 'regenerated' ||
			event.outcome === 'failed' ||
			event.outcome === 'cancelled' ||
			event.outcome === 'tool_failure';

		for (const id of event.retrievedNodeIds) {
			const s = this.ensure(id);
			s.shown++;
			if (positive) {
				s.accepted++;
			}
			if (negative && event.outcome === 'regenerated') {
				/* regenerated often means missing context — don't punish shown nodes */
			} else if (negative) {
				s.ignored++;
			}
			s.usefulness = this.computeUsefulness(s);
			this.nodes.set(id, s);
		}

		const layout = this.layoutScores.get(event.intent) ?? { score: 0.5, n: 0 };
		const delta = positive ? 0.05 : negative ? -0.04 : 0;
		layout.score = clamp01(layout.score + delta);
		layout.n++;
		this.layoutScores.set(event.intent, layout);

		if (event.model && positive) {
			if (!this.modelWins.has(event.intent)) {
				this.modelWins.set(event.intent, new Map());
			}
			const m = this.modelWins.get(event.intent)!;
			m.set(event.model, (m.get(event.model) ?? 0) + 1);
		}
	}

	nodeUsefulness(nodeId: string): number {
		return this.nodes.get(nodeId)?.usefulness ?? 0.5;
	}

	layoutPreference(intent: string): number {
		return this.layoutScores.get(intent)?.score ?? 0.5;
	}

	preferredModel(intent: string): string | undefined {
		const m = this.modelWins.get(intent);
		if (!m || m.size === 0) {
			return undefined;
		}
		return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
	}

	observeMissingNodes(nodeIds: string[]): void {
		for (const id of nodeIds) {
			const s = this.ensure(id);
			s.regeneratedMissing++;
			s.usefulness = this.computeUsefulness(s);
			this.nodes.set(id, s);
		}
	}

	observeIgnoredNodes(nodeIds: string[]): void {
		for (const id of nodeIds) {
			const s = this.ensure(id);
			s.ignored++;
			s.usefulness = this.computeUsefulness(s);
			this.nodes.set(id, s);
		}
	}

	stats(): { events: number; nodesTracked: number } {
		return { events: this.events.length, nodesTracked: this.nodes.size };
	}

	listEvents(limit = 50): LearningEvent[] {
		return this.events.slice(-limit);
	}

	private ensure(nodeId: string): NodeUsefulnessStats {
		return (
			this.nodes.get(nodeId) ?? {
				nodeId,
				shown: 0,
				accepted: 0,
				ignored: 0,
				regeneratedMissing: 0,
				usefulness: 0.5,
			}
		);
	}

	private computeUsefulness(s: NodeUsefulnessStats): number {
		const shown = Math.max(1, s.shown);
		const acceptRate = s.accepted / shown;
		const ignoreRate = s.ignored / shown;
		const missingBoost = Math.min(0.3, s.regeneratedMissing * 0.05);
		return clamp01(0.5 + acceptRate * 0.4 - ignoreRate * 0.3 + missingBoost);
	}
}

export function isPositiveOutcome(o: OutcomeSignal): boolean {
	return o === 'accepted' || o === 'success';
}

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n));
}
