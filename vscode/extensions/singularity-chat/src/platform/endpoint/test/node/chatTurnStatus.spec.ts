/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	bindChatTurnStatus,
	isChatTurnStatusBound,
	reportChatTurnStatus,
	reportEngineCalled,
	startChatTurnStatusHeartbeat,
} from '../../node/chatTurnStatus';

describe('chatTurnStatus', () => {
	let unbind: (() => void) | undefined;

	afterEach(() => {
		unbind?.();
		unbind = undefined;
		vi.useRealTimers();
	});

	it('reports to the bound listener and supports unbind', () => {
		const seen: Array<{ title: string; detail?: string }> = [];
		unbind = bindChatTurnStatus((u) => seen.push(u));
		expect(isChatTurnStatusBound()).toBe(true);

		reportChatTurnStatus('Routing', 'Selecting model…');
		expect(seen).toEqual([{ title: 'Routing', detail: 'Selecting model…' }]);

		unbind();
		unbind = undefined;
		expect(isChatTurnStatusBound()).toBe(false);
		reportChatTurnStatus('Ignored');
		expect(seen).toHaveLength(1);
	});

	it('dedupes identical updates within 400ms', () => {
		const seen: string[] = [];
		unbind = bindChatTurnStatus((u) => seen.push(u.title));
		reportChatTurnStatus('Same');
		reportChatTurnStatus('Same');
		expect(seen).toEqual(['Same']);
	});

	it('reportEngineCalled stays off the chat thinking stream', () => {
		const seen: Array<{ title: string; detail?: string }> = [];
		unbind = bindChatTurnStatus((u) => seen.push(u));
		reportEngineCalled('Context Engine');
		expect(seen).toEqual([]);
	});

	it('heartbeat ticks with elapsed seconds', async () => {
		vi.useFakeTimers();
		const seen: string[] = [];
		unbind = bindChatTurnStatus((u) => seen.push(`${u.title}:${u.detail ?? ''}`));
		const stop = startChatTurnStatusHeartbeat('Design Director', 'Writing Spec…', 1_000);
		expect(seen[0]).toContain('Writing Spec…');
		await vi.advanceTimersByTimeAsync(1_000);
		expect(seen.some((s) => s.includes('(1s)'))).toBe(true);
		stop();
	});
});
