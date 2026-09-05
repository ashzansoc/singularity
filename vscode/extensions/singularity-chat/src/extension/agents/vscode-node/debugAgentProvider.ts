/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AGENT_FILE_EXTENSION } from '../../../platform/customInstructions/common/promptTypes';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { AgentConfig, buildAgentMarkdown, DEFAULT_READ_TOOLS, singularityModePreamble } from './agentTypes';

const BASE_DEBUG_AGENT_CONFIG: AgentConfig = {
	name: 'Debug',
	description: 'Find root causes from logs, stack traces, and failing tests',
	argumentHint: 'Paste a stack trace or describe the bug',
	target: 'vscode',
	disableModelInvocation: true,
	agents: [],
	tools: [
		...DEFAULT_READ_TOOLS,
		'vscode/askQuestions',
	],
	body: '',
};

/**
 * Singularity Debug mode — read-only investigation of bugs and failures.
 */
export class DebugAgentProvider extends Disposable implements vscode.ChatCustomAgentProvider {
	readonly label = vscode.l10n.t('Debug Agent');

	private static readonly CACHE_DIR = 'debug-agent';
	private static readonly AGENT_FILENAME = `Debug${AGENT_FILE_EXTENSION}`;

	private readonly _onDidChangeCustomAgents = this._register(new vscode.EventEmitter<void>());
	readonly onDidChangeCustomAgents = this._onDidChangeCustomAgents.event;

	constructor(
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	async provideCustomAgents(
		_context: unknown,
		_token: vscode.CancellationToken
	): Promise<vscode.ChatResource[]> {
		const config: AgentConfig = {
			...BASE_DEBUG_AGENT_CONFIG,
			body: DebugAgentProvider.buildAgentBody(),
		};
		const content = buildAgentMarkdown(config);
		const fileUri = await this._writeCacheFile(content);
		return [{ uri: fileUri, sessionTypes: ['local'] }];
	}

	private async _writeCacheFile(content: string): Promise<vscode.Uri> {
		const cacheDir = vscode.Uri.joinPath(
			this._extensionContext.globalStorageUri,
			DebugAgentProvider.CACHE_DIR
		);

		try {
			await this._fileSystemService.stat(cacheDir);
		} catch {
			await this._fileSystemService.createDirectory(cacheDir);
		}

		const fileUri = vscode.Uri.joinPath(cacheDir, DebugAgentProvider.AGENT_FILENAME);
		await this._fileSystemService.writeFile(fileUri, new TextEncoder().encode(content));
		this._logService.trace(`[DebugAgentProvider] Wrote agent file: ${fileUri.toString()}`);
		return fileUri;
	}

	static buildAgentBody(): string {
		return `${singularityModePreamble('Debug')}

You are a DEBUG AGENT — you find root causes. You do not implement fixes unless the user explicitly asks you to hand off to Agent mode.

Your pipeline: **Collect → Hypothesize → Verify → Suggest fixes**.

<rules>
- NEVER use file editing tools or state-changing terminal commands
- Prefer evidence from stack traces, logs, terminal output, failing tests, and relevant source
- Use #tool:execute/getTerminalOutput and #tool:execute/testFailure when available
- Use #tool:vscode/askQuestions when the failure context is incomplete
- Separate facts from hypotheses; mark confidence clearly
- Suggest concrete fixes with file/symbol references, but do NOT apply them
</rules>

<workflow>
1. **Collect** — gather stack traces, error messages, recent changes, and related code
2. **Hypothesize** — list 1–3 plausible root causes ordered by likelihood
3. **Verify** — read code and test/terminal evidence to confirm or reject hypotheses
4. **Suggest** — recommend the smallest fix, plus how to validate it
</workflow>

<output_style>
Structure answers as:
- **Symptom**
- **Likely root cause** (with evidence)
- **Suggested fix** (steps / code sketch — do not apply)
- **How to verify**
</output_style>`;
	}
}
