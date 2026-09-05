/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { LanguageModelTextPart, LanguageModelToolResult } from '../../../vscodeTypes';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { ToolName } from '../common/toolNames';
import { SingularityToolMode, ISingularityTool, ToolRegistry } from '../common/toolsRegistry';

export type LlmWikiOperation =
	| 'init'
	| 'status'
	| 'ingest'
	| 'query'
	| 'search'
	| 'lint'
	| 'file';

export interface ILlmWikiParams {
	/** init | status | ingest | query | search | lint | file */
	operation: LlmWikiOperation;
	/** Source text (ingest) or search/query text */
	text?: string;
	title?: string;
	/** Workspace-relative or absolute path to ingest */
	path?: string;
	url?: string;
	notes?: string;
	/** Query question (query / file) */
	question?: string;
	/** Answer body to file (file) */
	answer?: string;
	citations?: string[];
	/** When true, file a grounded query answer into wiki/queries/ */
	fileAnswer?: boolean;
	limit?: number;
	description?: string;
}

interface WikiRunResult {
	ok?: boolean;
	reason?: string;
	skipped?: boolean;
	created?: boolean;
	wikiRoot?: string;
	status?: {
		initialized?: boolean;
		pageCount?: number;
		sourceCount?: number;
		wikiRoot?: string;
	};
	rawRelPath?: string;
	sourcePageRelPath?: string;
	takeaways?: string[];
	entities?: string[];
	concepts?: string[];
	pagesTouched?: string[];
	plan?: Array<{ relPath: string; action: string; title: string; reason: string }>;
	draft?: string;
	hits?: Array<{ relPath: string; title: string; score: number; excerpt: string }>;
	citations?: string[];
	noConfidentAnswer?: boolean;
	filedRelPath?: string;
	issues?: Array<{ kind: string; relPath?: string; detail: string }>;
	suggestions?: string[];
	relPath?: string;
}

/**
 * Singularity tool → singularity-ai `singularity.ai.wiki.run`.
 * Implements Karpathy's LLM Wiki pattern: ingest / query / lint / file.
 */
class LlmWikiTool implements ISingularityTool<ILlmWikiParams> {
	public static readonly toolName = ToolName.LlmWiki;
	public static readonly nonDeferred = true;
	private _inputContext: IBuildPromptContext | undefined;

	async invoke(
		options: vscode.LanguageModelToolInvocationOptions<ILlmWikiParams>,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelToolResult> {
		const op = options.input.operation;
		if (!op) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: operation is required for llm_wiki.'),
			]);
		}

		const stream = this._inputContext?.stream;
		stream?.progress(l10n.t('LLM Wiki: {0}…', op));

		let result: WikiRunResult;
		try {
			result = (await vscode.commands.executeCommand(
				'singularity.ai.wiki.run',
				options.input,
			)) as WikiRunResult;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(
					`LLM Wiki unavailable (${message}). Ensure singularity-ai is enabled.`,
				),
			]);
		}

		if (!result) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart('LLM Wiki returned no result.'),
			]);
		}

		return new LanguageModelToolResult([new LanguageModelTextPart(formatWikiResult(op, result))]);
	}

	prepareInvocation(
		options: vscode.LanguageModelToolInvocationPrepareOptions<ILlmWikiParams>,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		const desc = options.input.description || options.input.operation || 'LLM Wiki';
		return {
			invocationMessage: l10n.t`LLM Wiki: ${desc}`,
			pastTenseMessage: l10n.t`Ran LLM Wiki`,
		};
	}

	async resolveInput(
		input: ILlmWikiParams,
		promptContext: IBuildPromptContext,
		_mode: SingularityToolMode,
	): Promise<ILlmWikiParams> {
		this._inputContext = promptContext;
		return input;
	}
}

function formatWikiResult(op: LlmWikiOperation, result: WikiRunResult): string {
	const lines: string[] = [`# LLM Wiki — ${op}`];

	if (result.ok === false && result.reason) {
		lines.push(`\nFailed: ${result.reason}`);
		return lines.join('\n');
	}

	if (op === 'init') {
		lines.push(
			`\nWiki root: \`${result.wikiRoot ?? result.status?.wikiRoot ?? '?'}\``,
			result.created ? 'Created new wiki.' : 'Wiki already existed.',
		);
		return lines.join('\n');
	}

	if (op === 'status' && result.status) {
		const s = result.status;
		lines.push(
			`\nInitialized: ${s.initialized}`,
			`Pages: ${s.pageCount ?? 0}`,
			`Sources: ${s.sourceCount ?? 0}`,
			`Root: \`${s.wikiRoot ?? ''}\``,
		);
		return lines.join('\n');
	}

	if (op === 'ingest') {
		if (result.skipped) {
			lines.push(`\nSkipped: ${result.reason ?? 'unknown'}`);
			return lines.join('\n');
		}
		lines.push(
			`\nRaw: \`${result.rawRelPath ?? ''}\``,
			`Source page: \`${result.sourcePageRelPath ?? ''}\``,
		);
		if (result.takeaways?.length) {
			lines.push('\n## Takeaways');
			for (const t of result.takeaways) {
				lines.push(`- ${t}`);
			}
		}
		if (result.plan?.length) {
			lines.push('\n## Pages touched');
			for (const p of result.plan) {
				lines.push(`- [${p.action}] \`${p.relPath}\` — ${p.title}: ${p.reason}`);
			}
		}
		lines.push('\nReview updates in the wiki panel. Refine entity/concept pages as needed.');
		return lines.join('\n');
	}

	if (op === 'query') {
		if (result.noConfidentAnswer) {
			lines.push('\n**No confident answer.** Do not file an ungrounded answer.');
		}
		if (result.draft) {
			lines.push('\n## Draft', '', result.draft);
		}
		if (result.filedRelPath) {
			lines.push(`\nFiled at \`${result.filedRelPath}\`.`);
		}
		return lines.join('\n');
	}

	if (op === 'search' && result.hits?.length) {
		lines.push('\n## Hits');
		for (const h of result.hits) {
			lines.push(`- **${h.title}** (\`${h.relPath}\`, ${h.score}) — ${h.excerpt}`);
		}
		return lines.join('\n');
	}

	if (op === 'lint') {
		lines.push(`\n${result.issues?.length ?? 0} issue(s).`);
		for (const issue of result.issues?.slice(0, 40) ?? []) {
			lines.push(`- **${issue.kind}** ${issue.relPath ? `\`${issue.relPath}\`` : ''} — ${issue.detail}`);
		}
		if (result.suggestions?.length) {
			lines.push('\n## Suggestions');
			for (const s of result.suggestions) {
				lines.push(`- ${s}`);
			}
		}
		return lines.join('\n');
	}

	if (op === 'file' && result.relPath) {
		lines.push(`\nFiled at \`${result.relPath}\`.`);
		return lines.join('\n');
	}

	lines.push('\n', JSON.stringify(result, null, 2));
	return lines.join('\n');
}

ToolRegistry.registerTool(LlmWikiTool);
