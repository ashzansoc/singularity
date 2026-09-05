/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { singularityBrainViewIcon } from './icons.js';
import { SingularityBrainViewPane } from './singularityBrainViewPane.js';

export const SINGULARITY_BRAIN_CONTAINER_ID = 'workbench.view.extension.singularityBrain';
export const SINGULARITY_BRAIN_VIEW_ID = 'singularity.brain.view';
/**
 * Open command for the nav entry. Registered ONCE by ViewsService via
 * `openCommandActionDescriptor` below — do NOT also registerAction2() it here,
 * or startup fails with a duplicate-command error.
 */
const SINGULARITY_BRAIN_OPEN_COMMAND_ID = 'singularity.brain.open';

const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

const brainContainer = viewContainersRegistry.registerViewContainer({
	id: SINGULARITY_BRAIN_CONTAINER_ID,
	title: localize2('singularity.brain.nav', 'Intelligence'),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [SINGULARITY_BRAIN_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	icon: singularityBrainViewIcon,
	order: 3,
	hideIfEmpty: false,
	openCommandActionDescriptor: {
		id: SINGULARITY_BRAIN_OPEN_COMMAND_ID,
		mnemonicTitle: localize({ key: 'miSingularityBrain', comment: ['&& denotes a mnemonic'] }, '&&Intelligence'),
		order: 3,
	},
}, ViewContainerLocation.Sidebar);

viewsRegistry.registerViews([{
	id: SINGULARITY_BRAIN_VIEW_ID,
	name: localize2('singularity.brain.viewName', 'Intelligence'),
	containerIcon: singularityBrainViewIcon,
	ctorDescriptor: new SyncDescriptor(SingularityBrainViewPane),
	canToggleVisibility: false,
	canMoveView: true,
	weight: 100,
}], brainContainer);
