/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../base/common/observable.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import type { IAgent, IAgentDescriptor } from '../../common/agentService.js';
import { AgentModelRefreshScheduler } from '../../node/agentModelRefreshScheduler.js';

/**
 * Minimal stand-in for a provider: the scheduler only ever reads the descriptor
 * (for logging) and calls `refreshModels`.
 */
class TestAgent {
	refreshCount = 0;
	/** When set, `refreshModels` rejects with this instead of resolving. */
	refreshError: Error | undefined;

	constructor(private readonly _provider: string) { }

	getDescriptor(): IAgentDescriptor {
		return { provider: this._provider, displayName: this._provider, description: this._provider };
	}

	async refreshModels(): Promise<void> {
		this.refreshCount++;
		if (this.refreshError) {
			throw this.refreshError;
		}
	}
}

/** A provider that predates `refreshModels` and must simply be skipped. */
class LegacyTestAgent {
	getDescriptor(): IAgentDescriptor {
		return { provider: 'legacy', displayName: 'legacy', description: 'legacy' };
	}
}

function asAgents(...agents: readonly (TestAgent | LegacyTestAgent)[]): readonly IAgent[] {
	return agents as unknown as readonly IAgent[];
}

suite('AgentModelRefreshScheduler', () => {

	ensureNoDisposablesAreLeakedInTestSuite();
	const INTERVAL_MS = 1000;

	interface ISchedulerContext {
		readonly scheduler: AgentModelRefreshScheduler;
		readonly agents: ReturnType<typeof observableValue<readonly IAgent[]>>;
		/** Simulates a turn starting for `provider`, as `AgentHostTurnTracker` would. */
		startTurn(provider: string): void;
		/** Advances virtual time past `count` scheduler intervals. */
		advanceIntervals(count: number): Promise<void>;
	}

	/**
	 * Runs `fn` against a scheduler under a virtual clock.
	 *
	 * The scheduler is always disposed before the body returns. That is
	 * required, not just tidy: `runWithFakedTimers` drains the virtual queue on
	 * the way out and only stops once the queue is empty, so the scheduler's
	 * self-re-arming `IntervalTimer` would otherwise tick until the run trips
	 * its `maxEvents` budget.
	 */
	function withScheduler(initialAgents: readonly IAgent[], fn: (ctx: ISchedulerContext) => Promise<void>): Promise<void> {
		return runWithFakedTimers({ useFakeTimers: true }, async () => {
			const store = new DisposableStore();
			try {
				const agents = observableValue<readonly IAgent[]>('agents', initialAgents);
				const turnStarted = store.add(new Emitter<string>());
				const scheduler = store.add(new AgentModelRefreshScheduler(agents, turnStarted.event, INTERVAL_MS, new NullLogService()));
				await fn({
					scheduler,
					agents,
					startTurn: provider => turnStarted.fire(provider),
					// A half-interval offset keeps the wait clear of the tick
					// boundary, so a tick is unambiguously counted or not.
					advanceIntervals: count => timeout(INTERVAL_MS * count + INTERVAL_MS / 2),
				});
			} finally {
				store.dispose();
			}
		});
	}

	test('does not refresh a provider that has not been used', async () => {
		const singularity = new TestAgent('singularitycli');
		await withScheduler(asAgents(singularity), async ({ advanceIntervals }) => {
			await advanceIntervals(10);

			assert.strictEqual(singularity.refreshCount, 0, 'an idle provider must make no model requests');
		});
	});

	test('refreshes on the first turn, then only once per interval while in use', async () => {
		const singularity = new TestAgent('singularitycli');
		await withScheduler(asAgents(singularity), async ({ startTurn, advanceIntervals }) => {
			// First turn: the catalog has never been fetched, so refresh now.
			startTurn('singularitycli');
			const afterFirstTurn = singularity.refreshCount;

			// Further turns inside the same interval must not each hit the network.
			startTurn('singularitycli');
			startTurn('singularitycli');
			const afterBurst = singularity.refreshCount;

			// The activity recorded by the burst is honoured by the next tick.
			await advanceIntervals(1);

			assert.deepStrictEqual({
				afterFirstTurn,
				afterBurst,
				afterTick: singularity.refreshCount,
			}, {
				afterFirstTurn: 1,
				afterBurst: 1,
				afterTick: 2,
			});
		});
	});

	test('stops refreshing once a provider goes quiet', async () => {
		const singularity = new TestAgent('singularitycli');
		await withScheduler(asAgents(singularity), async ({ startTurn, advanceIntervals }) => {
			// A lone turn is served by the immediate path, which also consumes
			// the activity — so no catch-up tick follows it.
			startTurn('singularitycli');
			const countAfterTurn = singularity.refreshCount;
			await advanceIntervals(10);

			assert.deepStrictEqual({
				countAfterTurn,
				final: singularity.refreshCount,
			}, {
				countAfterTurn: 1,
				final: 1,
			});
		});
	});

	test('only refreshes the provider that was actually used', async () => {
		const singularity = new TestAgent('singularitycli');
		const claude = new TestAgent('claude');
		await withScheduler(asAgents(singularity, claude), async ({ startTurn, advanceIntervals }) => {
			startTurn('singularitycli');
			await advanceIntervals(3);

			assert.deepStrictEqual({
				singularity: singularity.refreshCount,
				claude: claude.refreshCount,
			}, {
				singularity: 1,
				claude: 0,
			});
		});
	});

	test('refreshes immediately when a turn arrives against an already-stale catalog', async () => {
		const singularity = new TestAgent('singularitycli');
		await withScheduler(asAgents(singularity), async ({ startTurn, advanceIntervals }) => {
			startTurn('singularitycli');
			// Go quiet long enough that the catalog is older than the interval.
			await advanceIntervals(5);
			const countBeforeReturn = singularity.refreshCount;

			// The next turn must not wait up to a full interval for fresh models.
			startTurn('singularitycli');

			assert.strictEqual(singularity.refreshCount, countBeforeReturn + 1);
		});
	});

	test('does not tick while no agents are registered, and starts once one appears', async () => {
		const agent = new TestAgent('singularitycli');
		await withScheduler([], async ({ agents, startTurn, advanceIntervals }) => {
			await advanceIntervals(10);
			agents.set(asAgents(agent), undefined);
			startTurn('singularitycli');

			assert.strictEqual(agent.refreshCount, 1, 'expected a refresh once an agent was registered and used');
		});
	});

	test('ignores turn activity for an unknown provider', async () => {
		const singularity = new TestAgent('singularitycli');
		await withScheduler(asAgents(singularity), async ({ startTurn, advanceIntervals }) => {
			startTurn('not-registered');
			await advanceIntervals(10);

			assert.strictEqual(singularity.refreshCount, 0);
		});
	});

	test('stops refreshing on dispose', async () => {
		const singularity = new TestAgent('singularitycli');
		await withScheduler(asAgents(singularity), async ({ scheduler, startTurn, advanceIntervals }) => {
			startTurn('singularitycli');
			const countAtDispose = singularity.refreshCount;
			scheduler.dispose();

			startTurn('singularitycli');
			await advanceIntervals(10);

			assert.deepStrictEqual({
				countAtDispose,
				final: singularity.refreshCount,
			}, {
				countAtDispose: 1,
				final: 1,
			});
		});
	});

	test('a failing or unimplemented refresh does not stop the other agents or later ticks', async () => {
		const failing = new TestAgent('failing');
		failing.refreshError = new Error('boom');
		const healthy = new TestAgent('healthy');
		await withScheduler(asAgents(failing, new LegacyTestAgent(), healthy), async ({ startTurn, advanceIntervals }) => {
			// Keep every provider "in use" so each tick refreshes them all.
			for (let i = 0; i < 3; i++) {
				startTurn('failing');
				startTurn('legacy');
				startTurn('healthy');
				startTurn('failing');
				startTurn('legacy');
				startTurn('healthy');
				await advanceIntervals(1);
			}

			assert.deepStrictEqual({
				failing: failing.refreshCount,
				healthy: healthy.refreshCount,
			}, {
				failing: 5,
				healthy: 5,
			});
		});
	});
});
