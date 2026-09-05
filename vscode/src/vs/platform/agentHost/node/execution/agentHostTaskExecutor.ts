/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import type { ILogService } from '../../../log/common/log.js';
import type { IAgentSpawnChatEvent } from '../../common/agentService.js';
import { buildSubagentChatUri, parseRequiredSessionUriFromChatUri } from '../../common/state/sessionState.js';
import { buildTaskPrompt } from './agentHostExecutor.js';
import { buildExecutionToolCallId } from './executionSubagentIds.js';
import { logSubagentCompleted, logSubagentFailed, logSubagentSpawned, logSubagentStarted } from './executionSubagentLogging.js';
import { executionOwnedPathsRegistry } from './executionOwnedPathsRegistry.js';
import { executionSubagentCompletionRegistry, type ExecutionSubagentResultPayload } from './subagentCompletionRegistry.js';
import type { AgentTaskContext, AgentTaskResult, ExecutionTaskRequest } from './executionTypes.js';

export interface ExecutionSubagentSpawnParams {
	readonly executionId: string;
	readonly taskId: string;
	readonly parentChatUri: string;
	readonly taskPrompt: string;
	readonly title: string;
	readonly ownedPaths: readonly string[];
}

export interface ExecutionSubagentSpawnHooks {
	readonly onChatSpawned: (event: IAgentSpawnChatEvent) => void;
	readonly startExecutionSubagentTurn: (params: {
		parentChatUri: string;
		toolCallId: string;
		taskPrompt: string;
		title: string;
	}) => string;
	readonly runSubagentTurn: (params: {
		parentChatUri: string;
		subagentChatUri: string;
		turnId: string;
		taskPrompt: string;
	}) => Promise<void>;
	readonly collectSubagentResult: (subagentChatUri: string, taskId: string, ownedPaths: readonly string[]) => ExecutionSubagentResultPayload;
}

export function buildExecutionSpawnEvent(params: ExecutionSubagentSpawnParams): IAgentSpawnChatEvent {
	const parentChat = URI.parse(params.parentChatUri);
	const parentSession = parseRequiredSessionUriFromChatUri(params.parentChatUri);
	const toolCallId = buildExecutionToolCallId(params.executionId, params.taskId);
	const subagentChatUri = buildSubagentChatUri(parentSession, toolCallId);
	return {
		session: URI.parse(parentSession),
		chat: URI.parse(subagentChatUri),
		parent: { chat: parentChat, toolCallId },
		title: params.title,
	};
}

export interface AgentHostTaskExecutorOptions {
	readonly maxConcurrency?: number;
	readonly logService: ILogService;
	readonly spawnHooks: ExecutionSubagentSpawnHooks;
}

/**
 * Real Agent Host executor: spawns peer subagent chats, waits for turn
 * completion, and returns structured results to the execution engine.
 */
export class AgentHostTaskExecutor {
	private activeCount = 0;
	private readonly queue: Array<() => void> = [];

	constructor(private readonly options: AgentHostTaskExecutorOptions) { }

	get maxConcurrency(): number {
		return this.options.maxConcurrency ?? 8;
	}

	async executeTask(ctx: AgentTaskContext): Promise<AgentTaskResult> {
		const req = ctx as ExecutionTaskRequest;
		if (!req.parentChatUri) {
			return { taskId: ctx.task.id, ok: false, error: 'parentChatUri is required', failureClass: 'provider_error' };
		}

		await this.acquireSlot();
		const toolCallId = buildExecutionToolCallId(ctx.executionId, ctx.task.id);
		const taskPrompt = buildTaskPrompt(ctx);
		const spawnEvent = buildExecutionSpawnEvent({
			executionId: ctx.executionId,
			taskId: ctx.task.id,
			parentChatUri: req.parentChatUri,
			taskPrompt,
			title: ctx.task.title,
			ownedPaths: ctx.task.ownedPaths ?? [],
		});
		const subagentChatUri = spawnEvent.chat.toString();

		executionOwnedPathsRegistry.register(req.parentChatUri, ctx.task.ownedPaths ?? []);

		logSubagentSpawned(this.options.logService, {
			executionId: ctx.executionId,
			taskId: ctx.task.id,
			parentAgentId: req.parentChatUri,
			subagentId: subagentChatUri,
		});

		const completion = executionSubagentCompletionRegistry.register({
			toolCallId,
			executionId: ctx.executionId,
			taskId: ctx.task.id,
			parentChatUri: req.parentChatUri,
			subagentChatUri,
		});

		try {
			this.options.spawnHooks.onChatSpawned(spawnEvent);
			const turnId = this.options.spawnHooks.startExecutionSubagentTurn({
				parentChatUri: req.parentChatUri,
				toolCallId,
				taskPrompt,
				title: ctx.task.title,
			});

			logSubagentStarted(this.options.logService, {
				executionId: ctx.executionId,
				taskId: ctx.task.id,
				subagentId: subagentChatUri,
				parentAgentId: req.parentChatUri,
			});

			await this.options.spawnHooks.runSubagentTurn({
				parentChatUri: req.parentChatUri,
				subagentChatUri,
				turnId,
				taskPrompt,
			});

			const done = await completion;
			if (!done.ok) {
				logSubagentFailed(this.options.logService, {
					executionId: ctx.executionId,
					taskId: ctx.task.id,
					subagentId: subagentChatUri,
					parentAgentId: req.parentChatUri,
					error: done.error ?? 'Subagent failed',
				});
				return {
					taskId: ctx.task.id,
					ok: false,
					error: done.error ?? 'Subagent failed',
					failureClass: 'provider_error',
				};
			}

			const subagentResult = done.subagentResult ?? this.options.spawnHooks.collectSubagentResult(
				subagentChatUri,
				ctx.task.id,
				ctx.task.ownedPaths ?? [],
			);

			logSubagentCompleted(this.options.logService, {
				executionId: ctx.executionId,
				taskId: ctx.task.id,
				subagentId: subagentChatUri,
				parentAgentId: req.parentChatUri,
				status: subagentResult.status,
			});

			return {
				taskId: ctx.task.id,
				ok: true,
				subagentResult,
				workerResult: {
					taskId: ctx.task.id,
					status: 'ok',
					summary: subagentResult.summary,
					filesModified: subagentResult.filesModified,
				},
			};
		} catch (err) {
			executionSubagentCompletionRegistry.reject(toolCallId, String(err));
			logSubagentFailed(this.options.logService, {
				executionId: ctx.executionId,
				taskId: ctx.task.id,
				subagentId: subagentChatUri,
				parentAgentId: req.parentChatUri,
				error: String(err),
			});
			return {
				taskId: ctx.task.id,
				ok: false,
				error: String(err),
				failureClass: 'provider_error',
			};
		} finally {
			this.releaseSlot();
		}
	}

	private acquireSlot(): Promise<void> {
		if (this.activeCount < this.maxConcurrency) {
			this.activeCount++;
			return Promise.resolve();
		}
		return new Promise(resolve => this.queue.push(resolve));
	}

	private releaseSlot(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.activeCount = Math.max(0, this.activeCount - 1);
		}
	}
}
