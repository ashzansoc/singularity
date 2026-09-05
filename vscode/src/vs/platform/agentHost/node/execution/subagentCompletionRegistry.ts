/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';

/** Minimal mirror of runtime SubagentResult for execution bridge payloads. */
export interface ExecutionSubagentResultPayload {
	readonly subagentId: string;
	readonly status: 'success' | 'partial' | 'failed';
	readonly summary: string;
	readonly filesCreated: string[];
	readonly filesModified: string[];
	readonly filesDeleted: string[];
	readonly testsRun: string[];
	readonly testsPassed: string[];
	readonly testsFailed: string[];
	readonly issues: string[];
	readonly recommendations: string[];
}

export interface ExecutionSubagentCompletion {
	readonly toolCallId: string;
	readonly executionId: string;
	readonly taskId: string;
	readonly parentChatUri: string;
	readonly subagentChatUri: string;
	readonly ok: boolean;
	readonly error?: string;
	readonly subagentResult?: ExecutionSubagentResultPayload;
}

interface PendingExecutionSubagent {
	readonly deferred: DeferredPromise<ExecutionSubagentCompletion>;
	readonly executionId: string;
	readonly taskId: string;
	readonly parentChatUri: string;
	readonly subagentChatUri: string;
	readonly startedAt: number;
}

/**
 * Tracks in-flight execution-owned subagent turns keyed by toolCallId.
 * Resolved when the subagent turn completes (via AgentSideEffects hooks).
 */
export class SubagentCompletionRegistry {
	private readonly _pending = new Map<string, PendingExecutionSubagent>();

	register(params: {
		toolCallId: string;
		executionId: string;
		taskId: string;
		parentChatUri: string;
		subagentChatUri: string;
	}): Promise<ExecutionSubagentCompletion> {
		const existing = this._pending.get(params.toolCallId);
		if (existing) {
			return existing.deferred.p;
		}
		const deferred = new DeferredPromise<ExecutionSubagentCompletion>();
		this._pending.set(params.toolCallId, {
			deferred,
			executionId: params.executionId,
			taskId: params.taskId,
			parentChatUri: params.parentChatUri,
			subagentChatUri: params.subagentChatUri,
			startedAt: Date.now(),
		});
		return deferred.p;
	}

	has(toolCallId: string): boolean {
		return this._pending.has(toolCallId);
	}

	get(toolCallId: string): PendingExecutionSubagent | undefined {
		return this._pending.get(toolCallId);
	}

	resolve(toolCallId: string, result: Omit<ExecutionSubagentCompletion, 'toolCallId' | 'executionId' | 'taskId' | 'parentChatUri' | 'subagentChatUri'>): boolean {
		const pending = this._pending.get(toolCallId);
		if (!pending) {
			return false;
		}
		this._pending.delete(toolCallId);
		pending.deferred.complete({
			toolCallId,
			executionId: pending.executionId,
			taskId: pending.taskId,
			parentChatUri: pending.parentChatUri,
			subagentChatUri: pending.subagentChatUri,
			...result,
		});
		return true;
	}

	reject(toolCallId: string, error: string): boolean {
		const pending = this._pending.get(toolCallId);
		if (!pending) {
			return false;
		}
		this._pending.delete(toolCallId);
		pending.deferred.error(new Error(error));
		return true;
	}

	clearForExecution(executionId: string): void {
		for (const [toolCallId, pending] of this._pending) {
			if (pending.executionId === executionId) {
				this.reject(toolCallId, 'Execution cleared');
			}
		}
	}
}

/** Process-wide registry for execution-owned subagent completions. */
export const executionSubagentCompletionRegistry = new SubagentCompletionRegistry();
