/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IChatSubmitRequestHandlerService } from '../../chat/browser/chatSubmitRequestHandlerService.js';
import { ISingularityBillingService, OPEN_SINGULARITY_PROFILE_COMMAND_ID } from '../../../services/singularityBilling/common/singularityBilling.js';
import { SingularityProfileEditor } from './singularityProfileEditor.js';
import { SingularityProfileEditorInput, SINGULARITY_PROFILE_EDITOR_ID, SINGULARITY_PROFILE_EDITOR_INPUT_ID } from './singularityProfileEditorInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		SingularityProfileEditor,
		SINGULARITY_PROFILE_EDITOR_ID,
		localize('singularity.profile.pane', "Profile"),
	),
	[new SyncDescriptor(SingularityProfileEditorInput)],
);

class SingularityProfileEditorInputSerializer implements IEditorSerializer {
	canSerialize(): boolean {
		return false;
	}
	serialize(): string {
		return '';
	}
	deserialize(instantiationService: IInstantiationService): EditorInput {
		return instantiationService.createInstance(SingularityProfileEditorInput);
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	SINGULARITY_PROFILE_EDITOR_INPUT_ID,
	SingularityProfileEditorInputSerializer,
);

registerAction2(class OpenSingularityProfileAction extends Action2 {
	constructor() {
		super({
			id: OPEN_SINGULARITY_PROFILE_COMMAND_ID,
			title: localize2('singularity.profile.open', "Open Profile"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		await editorService.openEditor(instantiationService.createInstance(SingularityProfileEditorInput), { pinned: true });
	}
});

class SingularityAccessGateContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.singularityAccessGate';

	constructor(
		@ISingularityBillingService billingService: ISingularityBillingService,
		@IChatSubmitRequestHandlerService submitHandlers: IChatSubmitRequestHandlerService,
		@IEditorService editorService: IEditorService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._register(submitHandlers.register({
			id: 'singularity.billing.gate',
			tryHandle: async () => {
				const snapshot = billingService.getSnapshot();
				if (snapshot.kind === 'restoring' || snapshot.canUseProduct) {
					return false;
				}

				await editorService.openEditor(instantiationService.createInstance(SingularityProfileEditorInput), { pinned: true });
				return true;
			}
		}));
	}
}

registerWorkbenchContribution2(SingularityAccessGateContribution.ID, SingularityAccessGateContribution, WorkbenchPhase.AfterRestored);
