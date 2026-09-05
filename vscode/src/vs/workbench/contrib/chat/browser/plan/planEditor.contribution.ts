/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../../common/contributions.js';
import { DEFAULT_EDITOR_ASSOCIATION, EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../../services/editor/common/editorResolverService.js';
import { isPlanResource, PLAN_EDITOR_ID } from '../../common/plan/planDocument.js';
import { PlanEditor } from './planEditor.js';
import { PlanEditorInput } from './planEditorInput.js';

class PlanEditorInputSerializer implements IEditorSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return editorInput instanceof PlanEditorInput;
	}

	serialize(editorInput: EditorInput): string | undefined {
		if (!(editorInput instanceof PlanEditorInput)) {
			return undefined;
		}
		return JSON.stringify({ resourceJSON: editorInput.resource.toJSON() });
	}

	deserialize(instantiationService: IInstantiationService, serializedEditor: string): EditorInput | undefined {
		try {
			const { resourceJSON } = JSON.parse(serializedEditor) as { resourceJSON: URI };
			const resource = URI.revive(resourceJSON);
			return instantiationService.createInstance(PlanEditorInput, resource);
		} catch {
			return undefined;
		}
	}
}

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		PlanEditor,
		PlanEditor.ID,
		localize('planEditor', "Plan"),
	),
	[new SyncDescriptor(PlanEditorInput)],
);

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	PlanEditorInput.TypeID,
	PlanEditorInputSerializer,
);

function createPlanEditorInput(instantiationService: IInstantiationService, resource: URI): { editor: PlanEditorInput } {
	return { editor: instantiationService.createInstance(PlanEditorInput, resource) };
}

class PlanEditorResolverContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.planEditorResolver';

	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		const info = {
			id: PLAN_EDITOR_ID,
			label: localize('planEditorDisplayName', "Plan"),
			detail: DEFAULT_EDITOR_ASSOCIATION.providerDisplayName,
			priority: RegisteredEditorPriority.exclusive,
		};

		const createEditorInput = ({ resource }: { resource: URI }) => createPlanEditorInput(instantiationService, resource);

		const options = {
			singlePerResource: true,
			canSupportResource: (resource: URI) => isPlanResource(resource),
		};

		this._register(editorResolverService.registerEditor(
			'**/plan.md',
			info,
			options,
			{ createEditorInput },
		));

		this._register(editorResolverService.registerEditor(
			'**/*.plan.md',
			info,
			options,
			{ createEditorInput },
		));

		this._register(editorResolverService.registerEditor(
			'**/todo.md',
			{
				...info,
				label: localize('todoEditorDisplayName', "Todo"),
			},
			options,
			{ createEditorInput },
		));

		this._register(editorResolverService.registerEditor(
			'plan.md',
			{
				...info,
				priority: RegisteredEditorPriority.option,
			},
			{
				singlePerResource: true,
				canSupportResource: (resource: URI) => basename(resource) === 'plan.md' || resource.scheme === Schemas.untitled,
			},
			{ createEditorInput },
		));

		this._register(editorResolverService.registerEditor(
			'todo.md',
			{
				...info,
				label: localize('todoEditorDisplayNameBare', "Todo"),
				priority: RegisteredEditorPriority.option,
			},
			{
				singlePerResource: true,
				canSupportResource: (resource: URI) => basename(resource) === 'todo.md' || resource.scheme === Schemas.untitled,
			},
			{ createEditorInput },
		));
	}
}

registerWorkbenchContribution2(PlanEditorResolverContribution.ID, PlanEditorResolverContribution, WorkbenchPhase.BlockRestore);
