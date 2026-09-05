/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Mirrors @singularity/runtime AgentExecutor types for Agent Host (no npm dep in core). */

export interface AgentTaskContext {
	executionId: string;
	task: {
		id: string;
		title: string;
		description?: string;
		deliverable?: string;
		expectedOutput: string;
		ownedPaths: string[];
		acceptanceCriteria?: string[];
	};
	workspaceRoot: string;
	sessionId?: string;
	parentSessionId?: string;
	parentChatUri?: string;
	worktreePath?: string;
}

export interface AgentTaskResult {
	taskId: string;
	ok: boolean;
	error?: string;
	failureClass?: string;
	modelId?: string;
	tokensUsed?: number;
	subagentResult?: ExecutionSubagentResultPayload;
	workerResult?: {
		taskId: string;
		status: 'ok' | 'error';
		summary: string;
		filesModified: string[];
		tokensUsed?: number;
	};
}

/** Minimal mirror of runtime SubagentResult for execution bridge payloads. */
export interface ExecutionSubagentResultPayload {
	subagentId: string;
	status: 'success' | 'partial' | 'failed';
	summary: string;
	filesCreated: string[];
	filesModified: string[];
	filesDeleted: string[];
	testsRun: string[];
	testsPassed: string[];
	testsFailed: string[];
	issues: string[];
	recommendations: string[];
}

export interface ExecutionTaskRequest extends AgentTaskContext {
	parentSessionId: string;
	parentChatUri: string;
}

export interface AgentExecutor {
	executeTask(ctx: AgentTaskContext): Promise<AgentTaskResult>;
	maxConcurrency?: number;
}

export interface ExecutionRunRequest {
	goal: string;
	sessionId: string;
	workspaceRoot: string;
	executionId?: string;
	maxConcurrentAgents?: number;
	parentSessionId?: string;
	parentChatUri?: string;
}

export interface ExecutionRunResponse {
	ok: boolean;
	executionId: string;
	summary: string;
	taskCount?: number;
	criticalPathLength?: number;
	appliedPaths?: string[];
}

export interface ExecutionGraphSnapshot {
	executionId: string;
	objective: string;
	status: string;
	batches: Array<Array<{ id: string; title: string; status: string }>>;
	criticalPathLength: number;
}
