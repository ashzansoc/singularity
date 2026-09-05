/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { isSharedAccountRpmLimit, parseRetryWaitMs, tokenRouterRpmGate } from '../tokenRouterRpmGate';

describe('tokenRouterRpmGate', () => {
	afterEach(() => {
		tokenRouterRpmGate.resetForTests();
		vi.useRealTimers();
	});

	it('detects shared account RPM messages', () => {
		expect(isSharedAccountRpmLimit('Maximum 5 requests within 1 minutes')).toBe(true);
		expect(isSharedAccountRpmLimit('You have reached the request limit')).toBe(true);
		expect(isSharedAccountRpmLimit('model overloaded')).toBe(false);
	});

	it('parses retry wait from within N minutes', () => {
		expect(parseRetryWaitMs('Maximum 5 requests within 1 minutes')).toBe(65_000);
		expect(parseRetryWaitMs('within 2 minutes')).toBe(125_000);
	});

	it('serializes slot acquisition under the window cap', async () => {
		vi.useFakeTimers();
		const acquires: Promise<void>[] = [];
		for (let i = 0; i < 4; i++) {
			acquires.push(tokenRouterRpmGate.acquire(CancellationToken.None));
		}
		await Promise.all(acquires);
		expect(tokenRouterRpmGate.pendingInWindow).toBe(4);

		let fifthDone = false;
		const fifth = tokenRouterRpmGate.acquire(CancellationToken.None).then(() => {
			fifthDone = true;
		});
		await vi.advanceTimersByTimeAsync(1_000);
		expect(fifthDone).toBe(false);

		await vi.advanceTimersByTimeAsync(60_000);
		await fifth;
		expect(fifthDone).toBe(true);
	});

	it('coalesces account RPM cooldowns', async () => {
		vi.useFakeTimers();
		const a = tokenRouterRpmGate.noteAccountRpmLimit('Maximum 5 requests within 1 minutes', CancellationToken.None);
		const b = tokenRouterRpmGate.noteAccountRpmLimit('Maximum 5 requests within 1 minutes', CancellationToken.None);
		await vi.advanceTimersByTimeAsync(65_000);
		await Promise.all([a, b]);
	});
});
