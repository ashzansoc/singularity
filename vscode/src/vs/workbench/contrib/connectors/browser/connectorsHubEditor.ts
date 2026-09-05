/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ConnectorsHubWidget } from './connectorsHubWidget.js';
import { ConnectorsHubEditorInput } from './connectorsHubEditorInput.js';

const $ = DOM.$;
const CONNECTORS_HUB_STYLE_ID = 'singularity-connectors-hub-styles';

function ensureConnectorsHubStyles(): void {
	if (typeof document === 'undefined' || document.getElementById(CONNECTORS_HUB_STYLE_ID)) {
		return;
	}
	const link = document.createElement('link');
	link.id = CONNECTORS_HUB_STYLE_ID;
	link.rel = 'stylesheet';
	link.href = new URL('./media/connectorsHub.css', import.meta.url).href;
	document.head.appendChild(link);
}

export class ConnectorsHubEditor extends EditorPane {

	static readonly ID = 'workbench.editor.connectorsHub';

	private readonly editorDisposables = this._register(new DisposableStore());
	private dimension: Dimension | undefined;
	private widget: ConnectorsHubWidget | undefined;
	private bodyContainer: HTMLElement | undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(ConnectorsHubEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		ensureConnectorsHubStyles();
		void import('./media/connectorsHub.css').catch(() => undefined);
		this.editorDisposables.clear();
		this.bodyContainer = DOM.append(parent, $('.connectors-hub-editor'));
		this.widget = this.editorDisposables.add(this.instantiationService.createInstance(ConnectorsHubWidget));
		this.bodyContainer.appendChild(this.widget.element);
	}

	override async setInput(input: ConnectorsHubEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (this.dimension) {
			this.layout(this.dimension);
		}
		void this.widget?.render();
	}

	override layout(dimension: Dimension): void {
		this.dimension = dimension;
		this.widget?.layout(dimension);
	}

	override focus(): void {
		super.focus();
		this.widget?.focusSearch();
	}
}
