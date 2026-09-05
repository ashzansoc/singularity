/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import type { ILogService } from '../../../../../platform/log/common/log.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import type { AgentTaskContext, AgentTaskResult } from '../../../../../platform/agentHost/node/execution/executionTypes.js';
import { RunSubagentTool } from '../../common/tools/builtinTools/runSubagentTool.js';
import { ILanguageModelToolsService, type IToolInvocation } from '../../common/tools/languageModelToolsService.js';
import { buildTaskPrompt } from '../../common/execution/buildTaskPrompt.js';
import { buildExecutionToolCallId } from '../../common/execution/executionSubagentIds.js';
import { executionOwnedPathsRegistry } from '../../common/execution/executionOwnedPathsRegistry.js';
import { logSubagentCompleted, logSubagentFailed, logSubagentSpawned, logSubagentStarted, logSubagentToolCall } from '../../common/execution/executionSubagentLogging.js';
import { parseSubagentToolResult } from '../../common/execution/parseSubagentToolResult.js';

export interface ExtensionHostExecutionTaskRequest extends AgentTaskContext {
	parentSessionResource: string;
	parentRequestId: string;
	parentAgentId?: string;
	dependencySummaries?: string[];
	phase?: 'worker' | 'integration' | 'verification';
}

export interface ExtensionHostTaskExecutorOptions {
	readonly maxConcurrency?: number;
	readonly logService: ILogService;
	readonly instantiationService: IInstantiationService;
	readonly languageModelToolsService: ILanguageModelToolsService;
}

/**
 * Executes execution-engine tasks via the existing RunSubagentTool primitive.
 */
export class ExtensionHostTaskExecutor {
	private activeCount = 0;
	private readonly queue: Array<() => void> = [];

	constructor(private readonly options: ExtensionHostTaskExecutorOptions) { }

	get maxConcurrency(): number {
		return this.options.maxConcurrency ?? 8;
	}

	async executeTask(ctx: AgentTaskContext): Promise<AgentTaskResult> {
		const req = ctx as ExtensionHostExecutionTaskRequest;
		if (!req.parentSessionResource || !req.parentRequestId) {
			return { taskId: ctx.task.id, ok: false, error: 'parentSessionResource and parentRequestId are required', failureClass: 'provider_error' };
		}

		await this.acquireSlot();
		const sessionResource = URI.parse(req.parentSessionResource);
		const parentSessionKey = req.parentSessionResource;
		const toolCallId = buildExecutionToolCallId(ctx.executionId, ctx.task.id);
		const ownedPaths = ctx.task.ownedPaths ?? [];
		const taskPrompt = buildTaskPrompt({
			executionId: ctx.executionId,
			task: ctx.task,
			dependencySummaries: req.dependencySummaries,
			phase: req.phase ?? 'worker',
		});

		executionOwnedPathsRegistry.register(parentSessionKey, ownedPaths);

		logSubagentSpawned(this.options.logService, {
			executionId: ctx.executionId,
			taskId: ctx.task.id,
			parentAgentId: req.parentAgentId ?? parentSessionKey,
			subagentId: toolCallId,
		});

		const store = new DisposableStore();
		try {
			store.add(this.options.languageModelToolsService.onDidInvokeTool(e => {
				if (e.subagentInvocationId === toolCallId) {
					logSubagentToolCall(this.options.logService, {
						executionId: ctx.executionId,
						taskId: ctx.task.id,
						subagentId: toolCallId,
						tool: e.toolId,
					});
				}
			}));

			logSubagentStarted(this.options.logService, {
				executionId: ctx.executionId,
				taskId: ctx.task.id,
				subagentId: toolCallId,
				parentAgentId: req.parentAgentId ?? parentSessionKey,
			});

			const runSubagentTool = this.options.instantiationService.createInstance(RunSubagentTool);
			const invocation: IToolInvocation = {
				callId: toolCallId,
				toolId: RunSubagentTool.Id,
				parameters: {
					prompt: taskPrompt,
					description: ctx.task.title.slice(0, 80),
				},
				context: { sessionResource },
				chatRequestId: req.parentRequestId,
				chatStreamToolCallId: toolCallId,
				toolSpecificData: {
					kind: 'subagent',
					description: ctx.task.title,
					prompt: taskPrompt,
				},
			};

			const toolResult = await runSubagentTool.invoke(
				invocation,
				async () => 0,
				{ report: () => { } },
				CancellationToken.None,
			);

			const subagentResult = parseSubagentToolResult(ctx.task.id, toolResult, ownedPaths);
			const ok = !toolResult.toolResultError && subagentResult.status !== 'failed';

			if (ok) {
				logSubagentCompleted(this.options.logService, {
					executionId: ctx.executionId,
					taskId: ctx.task.id,
					subagentId: toolCallId,
					parentAgentId: req.parentAgentId ?? parentSessionKey,
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
			}

			logSubagentFailed(this.options.logService, {
				executionId: ctx.executionId,
				taskId: ctx.task.id,
				subagentId: toolCallId,
				parentAgentId: req.parentAgentId ?? parentSessionKey,
				error: subagentResult.summary,
			});
			return {
				taskId: ctx.task.id,
				ok: false,
				error: subagentResult.summary,
				failureClass: 'provider_error',
				subagentResult,
			};
		} catch (err) {
			logSubagentFailed(this.options.logService, {
				executionId: ctx.executionId,
				taskId: ctx.task.id,
				subagentId: toolCallId,
				parentAgentId: req.parentAgentId ?? parentSessionKey,
				error: String(err),
			});
			return {
				taskId: ctx.task.id,
				ok: false,
				error: String(err),
				failureClass: 'provider_error',
			};
		} finally {
			store.dispose();
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
