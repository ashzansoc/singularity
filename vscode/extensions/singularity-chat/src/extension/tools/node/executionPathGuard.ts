/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getSubAgentInvocationId } from '../../prompt/common/intents';
import type { IBuildPromptContext } from '../../prompt/common/intents';

function resolveSessionResource(promptContext: IBuildPromptContext | undefined): string | undefined {
	const fromRequest = (promptContext?.request as { sessionResource?: { toString(): string } } | undefined)?.sessionResource?.toString();
	if (fromRequest) {
		return fromRequest;
	}
	const token = promptContext?.tools?.toolInvocationToken as { sessionResource?: { toString(): string } } | undefined;
	return token?.sessionResource?.toString();
}

/** Blocks parent-agent edits to paths owned by active execution subagents. */
export async function assertPathNotOwnedByExecutionSubagent(
	filePath: string,
	promptContext: IBuildPromptContext | undefined,
): Promise<void> {
	if (getSubAgentInvocationId(promptContext ?? {})) {
		return;
	}
	const sessionResource = resolveSessionResource(promptContext);
	if (!sessionResource) {
		return;
	}
	try {
		const owned = await vscode.commands.executeCommand<boolean>('singularity.execution.isPathOwned', sessionResource, filePath);
		if (owned) {
			throw new Error(`Path "${filePath}" is assigned to an active execution subagent. The parent agent must not modify it.`);
		}
	} catch (err) {
		if (err instanceof Error && err.message.includes('assigned to an active execution subagent')) {
			throw err;
		}
		// Command may be unavailable in tests.
	}
}
