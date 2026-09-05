/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IModalEditorOptions, IModalEditorOptionsProvider } from '../../../../platform/editor/common/editor.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { CONNECTORS_HUB_SIZE_RATIO } from '../common/connectors.js';

const ConnectorsHubEditorIcon = registerIcon('connectors-hub-editor-label-icon', Codicon.plug, localize('connectorsHubEditorLabelIcon', 'Icon of the Connectors hub.'));

export class ConnectorsHubEditorInput extends EditorInput implements IModalEditorOptionsProvider {

	static readonly ID = 'workbench.input.connectorsHub';

	readonly resource = undefined;

	override get capabilities(): EditorInputCapabilities {
		return super.capabilities | EditorInputCapabilities.Singleton | EditorInputCapabilities.RequiresModal;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(otherInput) || otherInput instanceof ConnectorsHubEditorInput;
	}

	override get typeId(): string {
		return ConnectorsHubEditorInput.ID;
	}

	override getName(): string {
		return localize('connectorsHubEditorInputName', "Connectors");
	}

	override getIcon(): ThemeIcon {
		return ConnectorsHubEditorIcon;
	}

	getModalEditorOptions(): IModalEditorOptions {
		return {
			compactHeader: true,
			sizeRatio: CONNECTORS_HUB_SIZE_RATIO,
			backdropBlur: true,
		};
	}

	override async resolve(): Promise<null> {
		return null;
	}
}
