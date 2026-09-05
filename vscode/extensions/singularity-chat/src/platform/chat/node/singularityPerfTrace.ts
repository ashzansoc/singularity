/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands } from 'vscode';

/**
 * Fire-and-forget perf trace forwarding to the singularity-ai extension's
 * RequestTracer (JSONL sink under .singularity/traces). Timings and token
 * counts only — no prompt or response content. Safe when singularity-ai is
 * not installed / not yet activated.
 */
export function tracePerfChatRequest(sample: {
	modelId?: string;
	ttftMs?: number;
	completionTokens?: number;
	reasoningTokens?: number;
	ok?: boolean;
}): void {
	if (process.env.SINGULARITY_TRACE === '0') {
		return;
	}
	void (async () => {
		try {
			await commands.executeCommand('singularity.ai.perfTraceChat', sample);
		} catch {
			// singularity-ai may be inactive; tracing must never surface errors here.
		}
	})();
}
