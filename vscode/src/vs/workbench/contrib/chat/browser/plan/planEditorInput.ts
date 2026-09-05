/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { ITextResourceConfigurationService } from '../../../../../editor/common/services/textResourceConfiguration.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { AbstractResourceEditorInput } from '../../../../common/editor/resourceEditorInput.js';
import { ICustomEditorLabelService } from '../../../../services/editor/common/customEditorLabelService.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';
import { PLAN_EDITOR_ID, PLAN_EDITOR_INPUT_ID } from '../../common/plan/planDocument.js';

export class PlanEditorInput extends AbstractResourceEditorInput {

	static readonly TypeID = PLAN_EDITOR_INPUT_ID;
	static readonly EditorID = PLAN_EDITOR_ID;

	override get typeId(): string {
		return PlanEditorInput.TypeID;
	}

	override get editorId(): string | undefined {
		return PlanEditorInput.EditorID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.CanSplitInGroup | EditorInputCapabilities.CanDropIntoEditor;
	}

	override getIcon(): ThemeIcon {
		return Codicon.checklist;
	}

	constructor(
		resource: URI,
		@ILabelService labelService: ILabelService,
		@IFileService fileService: IFileService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@ICustomEditorLabelService customEditorLabelService: ICustomEditorLabelService,
	) {
		super(resource, undefined, labelService, fileService, filesConfigurationService, textResourceConfigurationService, customEditorLabelService);
	}

	override getName(): string {
		const base = super.getName();
		return localize('planEditor.name', '{0} (Plan)', base);
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(otherInput)) {
			return true;
		}
		if (otherInput instanceof PlanEditorInput) {
			return otherInput.resource.toString() === this.resource.toString();
		}
		return false;
	}

	override toUntyped(): IUntypedEditorInput {
		return {
			resource: this.resource,
			options: {
				override: PlanEditorInput.EditorID,
			},
		};
	}
}
