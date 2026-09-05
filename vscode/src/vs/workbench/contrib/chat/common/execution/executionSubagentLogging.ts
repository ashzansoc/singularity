/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ILogService } from '../../../../../platform/log/common/log.js';

export interface ExecutionSubagentLogContext {
	executionId: string;
	taskId: string;
	agentId?: string;
	parentAgentId?: string;
	subagentId?: string;
	tool?: string;
	error?: string;
	status?: string;
}

function formatFields(ctx: ExecutionSubagentLogContext): string {
	const parts = [
		`executionId=${ctx.executionId}`,
		`taskId=${ctx.taskId}`,
	];
	if (ctx.agentId) {
		parts.push(`agentId=${ctx.agentId}`);
	}
	if (ctx.parentAgentId) {
		parts.push(`parentAgentId=${ctx.parentAgentId}`);
	}
	if (ctx.subagentId) {
		parts.push(`subagentId=${ctx.subagentId}`);
	}
	if (ctx.tool) {
		parts.push(`tool=${ctx.tool}`);
	}
	if (ctx.status) {
		parts.push(`status=${ctx.status}`);
	}
	if (ctx.error) {
		parts.push(`error=${ctx.error}`);
	}
	return parts.join(' ');
}

export function logSubagentSpawned(logService: ILogService, ctx: ExecutionSubagentLogContext): void {
	logService.info(`[SubagentSpawned] ${formatFields(ctx)}`);
}

export function logSubagentStarted(logService: ILogService, ctx: ExecutionSubagentLogContext): void {
	logService.info(`[SubagentStarted] ${formatFields(ctx)}`);
}

export function logSubagentToolCall(logService: ILogService, ctx: ExecutionSubagentLogContext): void {
	logService.info(`[SubagentToolCall] ${formatFields(ctx)}`);
}

export function logSubagentCompleted(logService: ILogService, ctx: ExecutionSubagentLogContext): void {
	logService.info(`[SubagentCompleted] ${formatFields(ctx)}`);
}

export function logSubagentFailed(logService: ILogService, ctx: ExecutionSubagentLogContext): void {
	logService.error(`[SubagentFailed] ${formatFields(ctx)}`);
}
