/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextEditor, window } from 'vscode';
import { Disposable } from '../../../../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../../../../util/vs/platform/instantiation/common/instantiation';
import { singularityOutputLogTelemetry } from '../../../lib/src/snippy/telemetryHandlers';
import { citationsChannelName } from './outputChannel';

export class CodeRefEngagementTracker extends Disposable {
	private activeLog = false;

	constructor(@IInstantiationService private instantiationService: IInstantiationService) {
		super();
		this._register(window.onDidChangeActiveTextEditor((e) => this.onActiveEditorChange(e)));
		this._register(window.onDidChangeVisibleTextEditors((e) => this.onVisibleEditorsChange(e)));
	}

	onActiveEditorChange = (editor: TextEditor | undefined) => {
		if (this.isOutputLog(editor)) {
			singularityOutputLogTelemetry.handleFocus({ instantiationService: this.instantiationService });
		}
	};

	onVisibleEditorsChange = (currEditors: readonly TextEditor[]) => {
		const singularityLog = currEditors.find(e => this.isOutputLog(e));

		if (this.activeLog) {
			if (!singularityLog) {
				this.activeLog = false;
			}
		} else if (singularityLog) {
			this.activeLog = true;
			singularityOutputLogTelemetry.handleOpen({ instantiationService: this.instantiationService });
		}
	};

	get logVisible() {
		return this.activeLog;
	}

	private isOutputLog = (editor: TextEditor | undefined) => {
		return (
			editor && editor.document.uri.scheme === 'output' && editor.document.uri.path.includes(citationsChannelName)
		);
	};
}
