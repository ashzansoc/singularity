/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Command, commands } from 'vscode';
import { Disposable } from '../../../../../util/vs/base/common/lifecycle';
import { IInstantiationService, ServicesAccessor } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { collectCompletionDiagnostics, formatDiagnosticsAsMarkdown } from '../../lib/src/diagnostics';
import { telemetry, TelemetryData } from '../../lib/src/telemetry';
import { CMDSendCompletionsFeedbackChat } from './constants';
import type { GhostTextCompletionItem } from './ghostText/ghostTextProvider';

export const sendCompletionFeedbackCommand: Command = {
	command: CMDSendCompletionsFeedbackChat,
	title: 'Send Singularity Completion Feedback',
	tooltip: 'Send feedback about the last shown Singularity completion item',
};

export class SingularityCompletionFeedbackTracker extends Disposable {
	private lastShownSingularityCompletionItem: GhostTextCompletionItem | undefined;

	constructor(@IInstantiationService private readonly instantiationService: IInstantiationService) {
		super();
		this._register(commands.registerCommand(sendCompletionFeedbackCommand.command, async () => {
			const item = this.lastShownSingularityCompletionItem;
			const telemetryArg: TelemetryData | undefined = item?.singularityCompletion.telemetry;
			this.instantiationService.invokeFunction(telemetry, 'ghostText.sentFeedback', telemetryArg);

			await this.instantiationService.invokeFunction(openGitHubIssue, item, telemetryArg);
		}));
	}

	trackItem(item: GhostTextCompletionItem) {
		this.lastShownSingularityCompletionItem = item;
	}
}

async function openGitHubIssue(
	accessor: ServicesAccessor,
	item: GhostTextCompletionItem | undefined,
	telemetry: TelemetryData | undefined
) {
	const body = generateGitHubIssueBody(accessor, item, telemetry);
	await commands.executeCommand('workbench.action.openIssueReporter', {
		issueTitle: 'Singularity completion feedback',
		issueSource: 'vscode',
		issueBody: body,
	});
}

function generateGitHubIssueBody(
	accessor: ServicesAccessor,
	item: GhostTextCompletionItem | undefined,
	telemetry: TelemetryData | undefined
) {
	const diagnostics = collectCompletionDiagnostics(accessor, telemetry, item?.opportunityId);
	const formattedDiagnostics = formatDiagnosticsAsMarkdown(diagnostics);
	if (typeof item?.insertText !== 'string') {
		return '';
	}

	return `## Singularity Completion Feedback
### Describe the issue, feedback, or steps to reproduce it:


### Completion text:
\`\`\`
${item.insertText}
\`\`\`

<details>
<summary>Diagnostics</summary>

${formattedDiagnostics}

</details>
`;
}
