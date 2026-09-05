/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IActionViewItemService } from '../../../../../platform/actions/browser/actionViewItemService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';
import { Menus } from '../../../../browser/menus.js';
import { ISessionContext } from '../../../../services/sessions/browser/sessionContext.js';
import { PickerActionViewItem } from './singularityChatSessionsActions.js';
import { MobilePermissionPicker } from './mobilePermissionPicker.js';
import { SingularityPermissionPickerDelegate } from './permissionPicker.js';

/**
 * Web-only contribution that registers the mobile-aware
 * {@link MobilePermissionPicker} for the Singularity CLI permission picker
 * action. The desktop contribution
 * (`SingularityPickerActionViewItemContribution` in
 * `singularityChatSessionsActions.ts`) skips this picker when `isWeb`, so
 * there is no duplicate-registration conflict. Imported only from
 * `sessions.web.main.ts`.
 *
 * On phone-layout viewports `MobilePermissionPicker.showPicker()`
 * routes the Default/Bypass/Autopilot choice through a bottom sheet;
 * on tablet/desktop web viewports it falls through to the inherited
 * desktop action-widget popup.
 */
class SingularityPermissionPickerWebContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.singularityPermissionPickerWeb';

	constructor(
		@IActionViewItemService actionViewItemService: IActionViewItemService,
	) {
		super();

		this._register(actionViewItemService.register(
			Menus.NewSessionControl,
			'sessions.defaultSingularity.permissionPicker',
			(_action, _options, scopedInstantiationService) => {
				const { session } = scopedInstantiationService.invokeFunction(accessor => accessor.get(ISessionContext));
				const delegate = scopedInstantiationService.createInstance(SingularityPermissionPickerDelegate, session);
				const picker = scopedInstantiationService.createInstance(MobilePermissionPicker, delegate);
				return new PickerActionViewItem(picker, delegate);
			},
		));
	}
}

registerWorkbenchContribution2(SingularityPermissionPickerWebContribution.ID, SingularityPermissionPickerWebContribution, WorkbenchPhase.AfterRestored);
