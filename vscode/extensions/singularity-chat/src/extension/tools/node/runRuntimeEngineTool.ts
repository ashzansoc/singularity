/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { LanguageModelTextPart, LanguageModelToolResult, MarkdownString } from '../../../vscodeTypes';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { ToolName } from '../common/toolNames';
import { SingularityToolMode, ISingularityTool, ToolRegistry } from '../common/toolsRegistry';

export interface IRunRuntimeEngineParams {
	/** Engineering goal for Runtime v4 (planner → DAG workers → integrate). */
	goal: string;
	/** Optional short project summary hint. */
	projectSummary?: string;
	/** Optional concurrency override (default 4). */
	concurrency?: number;
	/** User-visible description while running. */
	description?: string;
}

interface RunRuntimeCommandResult {
	ok: boolean;
	summary: string;
	error?: string;
	appliedPaths: string[];
	events: Array<{ kind: string; message: string; taskId?: string }>;
	plan?: {
		id: string;
		taskCount: number;
		tasks: Array<{ id: string; title: string; ownedPaths: string[] }>;
	};
}

/**
 * Thin Singularity tool → singularity-ai `singularity.ai.runRuntime` command.
 * Streams a progress-oriented summary from structured RuntimeEvent[] results.
 */
class RunRuntimeEngineTool implements ISingularityTool<IRunRuntimeEngineParams> {
	public static readonly toolName = ToolName.RunRuntimeEngine;
	public static readonly nonDeferred = true;
	private _inputContext: IBuildPromptContext | undefined;

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<IRunRuntimeEngineParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		return new LanguageModelToolResult([
			new LanguageModelTextPart(
				'Multi-agent Runtime is disabled. Use the sequential Agent to implement changes (Design Spec + skill for UI work).',
			),
		]);
	}

	prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<IRunRuntimeEngineParams>,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const desc = options.input.description || options.input.goal || 'Runtime v4';
		return {
			invocationMessage: l10n.t`Running Runtime engine: ${desc}`,
			pastTenseMessage: l10n.t`Ran Runtime engine`,
		};
	}

	async resolveInput(
		input: IRunRuntimeEngineParams,
		promptContext: IBuildPromptContext,
		_mode: SingularityToolMode,
	): Promise<IRunRuntimeEngineParams> {
		this._inputContext = promptContext;
		return input;
	}
}

ToolRegistry.registerTool(RunRuntimeEngineTool);
