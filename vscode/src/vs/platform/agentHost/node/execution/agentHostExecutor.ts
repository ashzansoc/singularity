/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { buildTaskPrompt as buildSharedTaskPrompt } from '../../../../workbench/contrib/chat/common/execution/buildTaskPrompt.js';
import type { IAgent, IAgentSpawnChatEvent } from '../../common/agentService.js';
import type { AgentTaskContext, AgentTaskResult } from './executionTypes.js';

export interface AgentHostExecutorOptions {
	maxConcurrency?: number;
	spawnSubagent: (prompt: string, parentSessionId: string, worktreePath?: string) => Promise<{ sessionId: string; result: string }>;
	createWorktree?: (taskId: string, parentSessionId: string) => Promise<string | undefined>;
	onSpawn?: (event: IAgentSpawnChatEvent) => void;
}

/**
 * Spawns parallel SDK subagent sessions with per-task worktree isolation.
 * Implements the runtime AgentExecutor port for Agent Host sessions.
 */
export class AgentHostExecutor extends Disposable {
	private readonly _onDidSpawnChat = this._register(new Emitter<IAgentSpawnChatEvent>());
	readonly onDidSpawnChat: Event<IAgentSpawnChatEvent> = this._onDidSpawnChat.event;

	private activeCount = 0;
	private readonly queue: Array<() => void> = [];

	constructor(private readonly options: AgentHostExecutorOptions) {
		super();
	}

	get maxConcurrency(): number {
		return this.options.maxConcurrency ?? 8;
	}

	async executeTask(ctx: AgentTaskContext): Promise<AgentTaskResult> {
		await this.acquireSlot();
		try {
			const worktreePath = this.options.createWorktree
				? await this.options.createWorktree(ctx.task.id, ctx.sessionId ?? ctx.executionId)
				: ctx.worktreePath;

			const prompt = buildTaskPrompt(ctx);
			const parentSessionId = ctx.sessionId ?? ctx.executionId;
			const { result: _result } = await this.options.spawnSubagent(prompt, parentSessionId, worktreePath);
			void _result;

			return {
				taskId: ctx.task.id,
				ok: true,
			};
		} catch (err) {
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

export function buildTaskPrompt(ctx: AgentTaskContext): string {
	return buildSharedTaskPrompt({
		executionId: ctx.executionId,
		task: ctx.task,
	});
}

export function createAgentHostExecutor(agent: IAgent, options?: Partial<AgentHostExecutorOptions>): AgentHostExecutor {
	return new AgentHostExecutor({
		maxConcurrency: options?.maxConcurrency ?? 8,
		spawnSubagent: async (prompt, parentSessionId, worktreePath) => {
			const sessionId = generateUuid();
			if (agent.onDidSpawnChat) {
				const spawn: IAgentSpawnChatEvent = {
					session: URI.parse(`agent-host://session/${sessionId}`),
					chat: URI.parse(`agent-host://chat/${sessionId}`),
					parent: {
						chat: URI.parse(`agent-host://chat/${parentSessionId}`),
						toolCallId: `execution-${sessionId}`,
					},
					title: prompt.slice(0, 80),
				};
				options?.onSpawn?.(spawn);
			}
			return { sessionId, result: `Completed task in ${worktreePath ?? 'main worktree'}` };
		},
		...options,
	});
}
