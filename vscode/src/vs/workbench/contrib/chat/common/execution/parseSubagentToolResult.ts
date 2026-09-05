/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ExecutionSubagentResultPayload } from '../../../../../platform/agentHost/node/execution/executionTypes.js';
import type { IToolResult } from '../tools/languageModelToolsService.js';

export function parseSubagentToolResult(
	taskId: string,
	toolResult: IToolResult,
	ownedPaths: readonly string[],
): ExecutionSubagentResultPayload {
	let summary = '';
	for (const part of toolResult.content ?? []) {
		if (part.kind === 'text') {
			summary += part.value;
		}
	}
	summary = summary.trim() || `Completed task ${taskId}`;

	const isError = Boolean(toolResult.toolResultError);
	return {
		subagentId: taskId,
		status: isError ? 'failed' : 'success',
		summary,
		filesCreated: [],
		filesModified: [...ownedPaths],
		filesDeleted: [],
		testsRun: [],
		testsPassed: [],
		testsFailed: [],
		issues: isError ? [summary] : [],
		recommendations: [],
	};
}
