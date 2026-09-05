/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { fromNow, safeIntl } from '../../../../base/common/date.js';
import { language } from '../../../../base/common/platform.js';

const dayInMilliseconds = 24 * 60 * 60 * 1000;

const chatRequestTimeFormatter = safeIntl.DateTimeFormat(language, {
	hour: 'numeric',
	minute: '2-digit',
});

const chatRequestFullDateTimeFormatter = safeIntl.DateTimeFormat(language, {
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: 'numeric',
	minute: '2-digit',
});

export interface IFormattedChatRequestTimestamp {
	readonly text: string;
	readonly fullText: string;
	readonly dateTime: string;
	readonly isRelative: boolean;
}

/**
 * Format a millisecond duration as a human-readable elapsed time string.
 * Examples: "0s", "45s", "1m 23s", "12m 5s"
 */
export function formatElapsedTime(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	if (totalSeconds < 60) {
		return localize('seconds', "{0}s", totalSeconds);
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return localize('minutesSeconds', "{0}m {1}s", minutes, seconds);
}

/**
 * Precise duration for per-response perf (includes sub-second).
 * Examples: "0.4s", "12.3s", "1m 05s"
 */
export function formatElapsedTimePrecise(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) {
		return localize('seconds', "{0}s", 0);
	}
	if (ms < 10_000) {
		const seconds = Math.round(ms / 100) / 10; // one decimal
		return localize('secondsPrecise', "{0}s", seconds.toFixed(1));
	}
	return formatElapsedTime(ms);
}

export function formatChatResponseElapsedTime(elapsedMs: number | undefined): string | undefined {
	return typeof elapsedMs === 'number' && elapsedMs >= 1000
		? formatElapsedTime(elapsedMs)
		: undefined;
}

/**
 * Per-prompt delivery metrics: wall-clock time and output tokens/sec (TPS).
 * Shown under every completed chat response.
 */
export function formatChatResponsePerf(
	elapsedMs: number | undefined,
	completionTokens: number | undefined,
): string | undefined {
	if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
		return undefined;
	}
	const parts: string[] = [formatElapsedTimePrecise(elapsedMs)];
	if (
		typeof completionTokens === 'number'
		&& Number.isFinite(completionTokens)
		&& completionTokens > 0
		&& elapsedMs > 0
	) {
		const tps = completionTokens / (elapsedMs / 1000);
		const tpsLabel = tps >= 100
			? Math.round(tps).toString()
			: tps >= 10
				? tps.toFixed(0)
				: tps.toFixed(1);
		parts.push(localize('tokensPerSecond', "{0} tok/s", tpsLabel));
		parts.push(localize('outputTokensShort', "{0} out", completionTokens.toLocaleString(language)));
	}
	return parts.join(' \u00b7 ');
}

export function formatChatRequestTimestamp(timestamp: number | undefined): IFormattedChatRequestTimestamp | undefined {
	if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) {
		return undefined;
	}

	const date = new Date(timestamp);
	const age = Date.now() - timestamp;
	const isRelative = age > dayInMilliseconds;
	return {
		text: isRelative
			? fromNow(timestamp, false, true)
			: chatRequestTimeFormatter.value.format(date),
		fullText: chatRequestFullDateTimeFormatter.value.format(date),
		dateTime: date.toISOString(),
		isRelative,
	};
}

export function formatChatResponseDetails(details: string | undefined, timing: string | undefined): string {
	const parts: string[] = timing ? [timing] : [];
	if (details) {
		parts.push(details);
	}
	return parts.join(' \u2022 ');
}
