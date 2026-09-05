/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range, commands, window, type Disposable } from 'vscode';
import { SingularityNamedAnnotationList } from '../../../../../../platform/completions-core/common/openai/singularityAnnotations';
import { DisposableStore, IDisposable } from '../../../../../../util/vs/base/common/lifecycle';
import { IInstantiationService, type ServicesAccessor } from '../../../../../../util/vs/platform/instantiation/common/instantiation';
import * as constants from '../constants';
import { registerCommand } from '../telemetry';
import { wrapDoc } from '../textDocumentManager';
import { SingularitySuggestionsPanelManager } from './singularitySuggestionsPanelManager';

// Exported for testing
export enum PanelNavigationType {
	Previous = 'previous',
	Next = 'next',
}

/**
 * This interface contains data associated to a completion displayed in the panel.
 */
export interface PanelCompletion {
	insertText: string;
	range: Range;
	singularityAnnotations?: SingularityNamedAnnotationList;
	postInsertionCallback: () => PromiseLike<void> | void;
}

export function registerPanelSupport(accessor: ServicesAccessor): Disposable {
	const instantiationService = accessor.get(IInstantiationService);
	const suggestionsPanelManager = instantiationService.createInstance(SingularitySuggestionsPanelManager);

	const disposableStore = new DisposableStore();

	function registerOpenPanelCommand(id: string): IDisposable {
		return registerCommand(accessor, id, async () => {
			// hide ghost text while opening the generation ui
			await commands.executeCommand('editor.action.inlineSuggest.hide');
			await instantiationService.invokeFunction(commandOpenPanel, suggestionsPanelManager);
		});
	}

	// Register both commands to also support command palette
	disposableStore.add(registerOpenPanelCommand(constants.CMDOpenPanelChat));
	disposableStore.add(registerOpenPanelCommand(constants.CMDOpenPanelClient));

	// No command palette support needed for these commands
	disposableStore.add(suggestionsPanelManager.registerCommands());

	return disposableStore;
}

function commandOpenPanel(accessor: ServicesAccessor, suggestionsPanelManager: SingularitySuggestionsPanelManager) {
	const editor = window.activeTextEditor;
	if (!editor) { return; }
	const wrapped = wrapDoc(editor.document);
	if (!wrapped) { return; }

	const { line, character } = editor.selection.active;

	suggestionsPanelManager.renderPanel(editor.document, { line, character }, wrapped);
	return commands.executeCommand('setContext', constants.SingularityPanelVisible, true);
}
