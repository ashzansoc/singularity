/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Execution loop coordinator for Agent Host sessions.
 * Delegates task execution to {@link AgentHostExecutor} with batch boundaries
 * and checkpoint persistence handled by the workbench execution service.
 */
export { AgentHostExecutor, createAgentHostExecutor, type AgentHostExecutorOptions } from './agentHostExecutor.js';
export type {
	AgentExecutor,
	AgentTaskContext,
	AgentTaskResult,
	ExecutionRunRequest,
	ExecutionRunResponse,
	ExecutionGraphSnapshot,
} from './executionTypes.js';
