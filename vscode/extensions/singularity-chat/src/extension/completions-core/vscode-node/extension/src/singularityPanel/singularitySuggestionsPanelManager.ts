/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextDocument, WebviewPanel } from 'vscode';
import { IVSCodeExtensionContext } from '../../../../../../platform/extContext/common/extensionContext';
import { IInstantiationService } from '../../../../../../util/vs/platform/instantiation/common/instantiation';
import { IPosition, ITextDocument } from '../../../lib/src/textDocument';
import { solutionCountTarget } from '../lib/singularityPanel/common';
import { BaseSuggestionsPanelManager, ListDocumentInterface } from '../panelShared/baseSuggestionsPanelManager';
import { PanelCompletion } from './common';
import { SingularityListDocument } from './singularityListDocument';
import { SingularitySuggestionsPanel } from './singularitySuggestionsPanel';
import { singularityPanelConfig } from './panelConfig';

export class SingularitySuggestionsPanelManager extends BaseSuggestionsPanelManager<PanelCompletion> {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
	) {
		super(singularityPanelConfig, instantiationService, extensionContext);
	}

	protected createListDocument(
		wrapped: ITextDocument,
		position: IPosition,
		panel: SingularitySuggestionsPanel
	): ListDocumentInterface {
		return this._instantiationService.createInstance(SingularityListDocument, wrapped, position, panel, solutionCountTarget);
	}

	protected createSuggestionsPanel(
		panel: WebviewPanel,
		document: TextDocument,
		manager: this
	): SingularitySuggestionsPanel {
		return this._instantiationService.createInstance(SingularitySuggestionsPanel, panel, document, manager);
	}
}
