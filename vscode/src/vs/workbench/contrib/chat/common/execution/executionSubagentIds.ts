/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const PREFIX = 'execution-';
const SEPARATOR = '::';

export function buildExecutionToolCallId(executionId: string, taskId: string): string {
	return `${PREFIX}${executionId}${SEPARATOR}${taskId}`;
}

export function isExecutionToolCallId(toolCallId: string): boolean {
	return toolCallId.startsWith(PREFIX);
}

export function parseExecutionToolCallId(toolCallId: string): { executionId: string; taskId: string } | undefined {
	if (!isExecutionToolCallId(toolCallId)) {
		return undefined;
	}
	const rest = toolCallId.slice(PREFIX.length);
	const sep = rest.indexOf(SEPARATOR);
	if (sep <= 0) {
		return undefined;
	}
	return {
		executionId: rest.slice(0, sep),
		taskId: rest.slice(sep + SEPARATOR.length),
	};
}
