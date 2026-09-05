/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResponsePartKind, type ISessionWithDefaultChat } from '../../common/state/sessionState.js';
import type { ExecutionSubagentResultPayload } from './subagentCompletionRegistry.js';

export function collectExecutionSubagentResult(
	state: ISessionWithDefaultChat | undefined,
	taskId: string,
	ownedPaths: readonly string[],
): ExecutionSubagentResultPayload {
	const turns = state?.turns ?? [];
	const lastTurn = turns[turns.length - 1];
	let summary = '';
	if (lastTurn) {
		const chunks: string[] = [];
		for (const part of lastTurn.responseParts) {
			if (part.kind === ResponsePartKind.Markdown) {
				chunks.push(part.content);
			}
		}
		summary = chunks.join('\n').trim();
	}
	if (!summary) {
		summary = `Completed task ${taskId}`;
	}
	return {
		subagentId: taskId,
		status: 'success',
		summary,
		filesCreated: [],
		filesModified: [...ownedPaths],
		filesDeleted: [],
		testsRun: [],
		testsPassed: [],
		testsFailed: [],
		issues: [],
		recommendations: [],
	};
}
