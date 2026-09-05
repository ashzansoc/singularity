/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'vscode';
import { getTokenRouterApiKey, isUsingBetaProxy } from '../../../platform/env/node/singularityBundledEnv';

/**
 * TokenRouter account RPM is shared across models ("Maximum 5 requests within 1 minutes").
 * Without a process-wide gate, agent tool loops stampede Pro, hit 429, then each waiter
 * sleeps ~65s and stampedes again. This gate:
 *  1) reserves slots in a sliding 60s window before sending
 *  2) coalesces post-429 cooldowns onto one shared wait
 */

const WINDOW_MS = 60_000;
/** Paid TokenRouter accounts — stay under shared cap. */
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 4;
/** Beta llm-proxy accounts are often 1 req/min — match upstream to avoid 429 stampedes. */
const BETA_MAX_REQUESTS_PER_WINDOW = 1;

export type TokenRouterRpmLogger = { warn(message: string): void; info?(message: string): void };

class TokenRouterRpmGate {
	private readonly _timestamps: number[] = [];
	private _cooldownUntil = 0;
	private _cooldownPromise: Promise<void> | undefined;
	/** Serialize slot acquisition so concurrent callers don't all pass the same length check. */
	private _acquireChain: Promise<void> = Promise.resolve();

	async acquire(token: CancellationToken, log?: TokenRouterRpmLogger): Promise<void> {
		const run = this._acquireChain.then(() => this._acquireSlot(token, log));
		// Don't let a rejection break the chain for later callers.
		this._acquireChain = run.then(() => undefined, () => undefined);
		await run;
	}

	async noteAccountRpmLimit(reason: string, token: CancellationToken, log?: TokenRouterRpmLogger): Promise<number> {
		const waitMs = parseRetryWaitMs(reason) ?? 65_000;
		const until = Date.now() + waitMs;
		if (until > this._cooldownUntil) {
			this._cooldownUntil = until;
			this._cooldownPromise = delayCancellable(waitMs, token).then(() => {
				this._cooldownUntil = 0;
				this._cooldownPromise = undefined;
			});
			log?.warn(
				`[TokenRouter] Shared account RPM cooldown ${Math.round(waitMs / 1000)}s (coalesced for all models)`,
			);
		}
		if (this._cooldownPromise) {
			await this._cooldownPromise;
		}
		return waitMs;
	}

	/** Test/debug helpers */
	get pendingInWindow(): number {
		this._prune(Date.now());
		return this._timestamps.length;
	}

	resetForTests(): void {
		this._timestamps.length = 0;
		this._cooldownUntil = 0;
		this._cooldownPromise = undefined;
		this._acquireChain = Promise.resolve();
	}

	/** Skip Design Director / progress sidecars when the agent turn needs the RPM slot. */
	shouldDeferAuxiliaryLlm(): boolean {
		this._prune(Date.now());
		const max = this._maxRequestsPerWindow();
		return this._cooldownUntil > Date.now() || this._timestamps.length >= max;
	}

	private _maxRequestsPerWindow(): number {
		const key = getTokenRouterApiKey();
		return key && isUsingBetaProxy(key) ? BETA_MAX_REQUESTS_PER_WINDOW : DEFAULT_MAX_REQUESTS_PER_WINDOW;
	}

	private async _acquireSlot(token: CancellationToken, log?: TokenRouterRpmLogger): Promise<void> {
		while (true) {
			if (token.isCancellationRequested) {
				throw new Error('Cancelled');
			}
			const now = Date.now();
			if (this._cooldownUntil > now) {
				const waitMs = this._cooldownUntil - now;
				if (waitMs <= 100) {
					this._cooldownUntil = 0;
					this._cooldownPromise = undefined;
					continue;
				}
				log?.warn(`[TokenRouter] Waiting ${Math.ceil(waitMs / 1000)}s for shared RPM cooldown`);
				if (this._cooldownPromise) {
					await this._cooldownPromise;
				} else {
					await delayCancellable(waitMs, token);
				}
				continue;
			}
			this._cooldownPromise = undefined;

			this._prune(now);
			const max = this._maxRequestsPerWindow();
			if (this._timestamps.length < max) {
				this._timestamps.push(Date.now());
				return;
			}

			const oldest = this._timestamps[0]!;
			const waitMs = Math.max(250, oldest + WINDOW_MS - now + 50);
			log?.info?.(
				`[TokenRouter] RPM gate: ${this._timestamps.length}/${max} in window; waiting ${Math.round(waitMs / 1000)}s for a slot`,
			);
			await delayCancellable(waitMs, token);
		}
	}

	private _prune(now: number): void {
		while (this._timestamps.length && this._timestamps[0]! <= now - WINDOW_MS) {
			this._timestamps.shift();
		}
	}
}

export const tokenRouterRpmGate = new TokenRouterRpmGate();

/** Beta llm-proxy is 1 req/min — never burn the slot on title/progress sidecars. */
export function shouldSkipAuxiliaryTokenRouterLlm(): boolean {
	const key = getTokenRouterApiKey();
	return !!(key && isUsingBetaProxy(key));
}

/** Background LLM debug names that must not acquire RPM slots on beta. */
export const TOKENROUTER_AUXILIARY_DEBUG_NAMES = new Set([
	'title',
	'progressMessages',
	'contextualProgressMessage',
]);

export function parseRetryWaitMs(reason: string): number | undefined {
	const m = reason.match(/within\s+(\d+)\s+minutes?/i);
	if (m) {
		return (Number(m[1]) || 1) * 60_000 + 5_000;
	}
	return undefined;
}

export function isSharedAccountRpmLimit(reason: string): boolean {
	return /maximum\s+\d+\s+requests\s+within\s+\d+\s+minutes|request limit|too many requests/i.test(reason);
}

function delayCancellable(ms: number, token: CancellationToken): Promise<void> {
	return new Promise((resolve, reject) => {
		if (token.isCancellationRequested) {
			reject(new Error('Cancelled'));
			return;
		}
		const t = setTimeout(() => {
			sub.dispose();
			resolve();
		}, ms);
		const sub = token.onCancellationRequested(() => {
			clearTimeout(t);
			sub.dispose();
			reject(new Error('Cancelled'));
		});
	}).catch((err) => {
		if (token.isCancellationRequested) {
			throw err instanceof Error ? err : new Error('Cancelled');
		}
	});
}
