/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands } from 'vscode';

/**
 * Fire-and-forget project token accounting for the Singularity AI status bar.
 * Safe when the singularity-ai extension is not installed / not yet activated.
 */
export function reportSingularityProjectTokenUsage(
	usage: {
		readonly prompt_tokens?: number;
		readonly completion_tokens?: number;
		readonly prompt_tokens_details?: {
			readonly cached_tokens?: number;
		};
		readonly cache_read_input_tokens?: number;
		readonly cached_tokens?: number;
	},
	modelId?: string,
): void {
	const promptTotal = usage.prompt_tokens ?? 0;
	const outputTokens = usage.completion_tokens ?? 0;
	const cachedFieldPresent =
		usage.prompt_tokens_details?.cached_tokens !== undefined
		|| usage.cache_read_input_tokens !== undefined
		|| usage.cached_tokens !== undefined;
	const cachedInputTokens = cachedFieldPresent
		? (usage.prompt_tokens_details?.cached_tokens
			?? usage.cache_read_input_tokens
			?? usage.cached_tokens
			?? 0)
		: 0;
	const cached = Math.min(Math.max(0, cachedInputTokens), Math.max(0, promptTotal));
	const inputTokens = Math.max(0, promptTotal - cached);
	if (!inputTokens && !outputTokens && !cached && !cachedFieldPresent) {
		return;
	}

	const payload = {
		inputTokens,
		outputTokens,
		cachedInputTokens: cached,
		cacheReported: cachedFieldPresent,
		...(modelId ? { modelId } : {}),
	};
	void (async () => {
		try {
			await commands.executeCommand('singularity.ai.recordUsage', payload);
		} catch (first) {
			// First call can race before singularity-ai activates — retry once.
			try {
				await new Promise((r) => setTimeout(r, 250));
				await commands.executeCommand('singularity.ai.recordUsage', payload);
			} catch {
				// Extension host may be unavailable (unit tests, early boot).
			}
		}
	})();
}

/** Live status-bar phase. Safe when singularity-ai is not activated. */
export function reportSingularityRequestPhase(
	phase: string,
	liveLabel?: string,
): void {
	void commands.executeCommand('singularity.ai.setRequestPhase', { phase, liveLabel }).then(
		undefined,
		() => { /* extension optional */ },
	);
}

