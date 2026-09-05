/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export const SINGULARITY_PROFILE_EDITOR_ID = 'workbench.editor.singularityProfile';
export const SINGULARITY_PROFILE_EDITOR_INPUT_ID = 'workbench.input.singularityProfile';

export class SingularityProfileEditorInput extends EditorInput {

	static readonly ID = SINGULARITY_PROFILE_EDITOR_INPUT_ID;

	readonly resource = undefined;

	override get capabilities(): EditorInputCapabilities {
		return super.capabilities | EditorInputCapabilities.Singleton;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(otherInput) || otherInput instanceof SingularityProfileEditorInput;
	}

	override get typeId(): string {
		return SingularityProfileEditorInput.ID;
	}

	override getName(): string {
		return localize('singularity.profile.editorName', "Profile");
	}

	override getIcon(): ThemeIcon {
		return Codicon.account;
	}

	override async resolve(): Promise<null> {
		return null;
	}
}
