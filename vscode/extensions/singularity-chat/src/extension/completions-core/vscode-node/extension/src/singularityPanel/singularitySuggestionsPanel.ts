/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextDocument, WebviewPanel } from 'vscode';
import { IVSCodeExtensionContext } from '../../../../../../platform/extContext/common/extensionContext';
import { BaseSuggestionsPanel, SolutionContent, WebviewMessage } from '../panelShared/baseSuggestionsPanel';
import { PanelCompletion } from './common';
import { SingularitySuggestionsPanelManager } from './singularitySuggestionsPanelManager';
import { singularityPanelConfig } from './panelConfig';

export interface SingularitySolutionsMessage {
	command: 'solutionsUpdated';
	solutions: SolutionContent[];
	percentage: number;
}

export class SingularitySuggestionsPanel extends BaseSuggestionsPanel<PanelCompletion> {
	constructor(
		webviewPanel: WebviewPanel,
		document: TextDocument,
		suggestionsPanelManager: SingularitySuggestionsPanelManager,
		@IVSCodeExtensionContext contextService: IVSCodeExtensionContext,
	) {
		super(webviewPanel, document, suggestionsPanelManager, singularityPanelConfig, contextService);
	}

	protected renderSolutionContent(item: PanelCompletion, baseContent: SolutionContent): SolutionContent {
		// Singularity panel just returns the base content without modifications
		return baseContent;
	}

	protected createSolutionsMessage(content: SolutionContent[], percentage: number): SingularitySolutionsMessage {
		return {
			command: 'solutionsUpdated',
			solutions: content,
			percentage,
		};
	}

	protected override async handleCustomMessage(message: WebviewMessage): Promise<boolean> {
		switch (message.command) {
			case 'acceptSolution': {
				const solution = this.items()[message.solutionIndex];
				await this.acceptSolution(solution, true);
				return Promise.resolve(true);
			}
			default:
				return Promise.resolve(false);
		}
	}
}
