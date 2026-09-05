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

const BASE_REVIEW_AGENT_CONFIG: AgentConfig = {
	name: 'Review',
	description: 'Professional code review for bugs, security, and maintainability',
	argumentHint: 'Point at a file, diff, or PR to review',
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
 * Singularity Review mode — read-only professional code review.
 */
export class ReviewAgentProvider extends Disposable implements vscode.ChatCustomAgentProvider {
	readonly label = vscode.l10n.t('Review Agent');

	private static readonly CACHE_DIR = 'review-agent';
	private static readonly AGENT_FILENAME = `Review${AGENT_FILE_EXTENSION}`;

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
			...BASE_REVIEW_AGENT_CONFIG,
			body: ReviewAgentProvider.buildAgentBody(),
		};
		const content = buildAgentMarkdown(config);
		const fileUri = await this._writeCacheFile(content);
		return [{ uri: fileUri, sessionTypes: ['local'] }];
	}

	private async _writeCacheFile(content: string): Promise<vscode.Uri> {
		const cacheDir = vscode.Uri.joinPath(
			this._extensionContext.globalStorageUri,
			ReviewAgentProvider.CACHE_DIR
		);

		try {
			await this._fileSystemService.stat(cacheDir);
		} catch {
			await this._fileSystemService.createDirectory(cacheDir);
		}

		const fileUri = vscode.Uri.joinPath(cacheDir, ReviewAgentProvider.AGENT_FILENAME);
		await this._fileSystemService.writeFile(fileUri, new TextEncoder().encode(content));
		this._logService.trace(`[ReviewAgentProvider] Wrote agent file: ${fileUri.toString()}`);
		return fileUri;
	}

	static buildAgentBody(): string {
		return `${singularityModePreamble('Review')}

You are a REVIEW AGENT — you perform professional code review. You annotate risks and improvements; you do not rewrite the codebase.

Checks (in priority order):
1. Correctness / bugs
2. Security
3. Performance
4. Maintainability
5. Style / consistency (only when it matters)

<rules>
- NEVER use file editing tools or state-changing commands
- Ground every finding in specific files, symbols, or diff hunks
- Severity-tag findings: Critical / High / Medium / Low / Nit
- Prefer actionable recommendations over vague advice
- Use PR/issue tools when reviewing a pull request context
- Do not apply fixes; suggest patches as review comments
</rules>

<output_style>
Produce an annotated review:
## Summary
## Findings
- **[Severity] Title** — \`path\` — evidence and recommendation
## What's good
## Suggested next steps
</output_style>`;
	}
}
