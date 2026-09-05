/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, append, $ } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';

export type SingularityWorkbenchMode = 'code' | 'chat';

const STORAGE_KEY = 'singularity.workbenchMode';

const MODES: ReadonlyArray<{ id: SingularityWorkbenchMode; label: string }> = [
	{ id: 'code', label: localize('singularity.mode.code', 'Code') },
	{ id: 'chat', label: localize('singularity.mode.chat', 'Chat') },
];

/**
 * Code | Chat segmented control for the title bar.
 */
export class SingularityModeSwitcher extends Disposable {

	readonly element: HTMLElement;

	private readonly buttons = new Map<SingularityWorkbenchMode, HTMLButtonElement>();
	private mode: SingularityWorkbenchMode;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
	) {
		super();

		const stored = this.storageService.get(STORAGE_KEY, StorageScope.WORKSPACE);
		this.mode = stored === 'chat' || stored === 'code' ? stored : 'chat';

		this.element = $('div.singularity-mode-switcher');
		this.element.setAttribute('role', 'tablist');
		this.element.setAttribute('aria-label', localize('singularity.mode.switcher', 'Workbench mode'));

		for (const mode of MODES) {
			const button = append(this.element, $('button.singularity-mode-switcher-btn')) as HTMLButtonElement;
			button.type = 'button';
			button.textContent = mode.label;
			button.setAttribute('role', 'tab');
			button.dataset.mode = mode.id;
			this.buttons.set(mode.id, button);
			this._register(addDisposableListener(button, 'click', () => {
				void this.setMode(mode.id, true);
			}));
		}

		this.render();
	}

	private render(): void {
		for (const [id, button] of this.buttons) {
			const active = id === this.mode;
			button.classList.toggle('active', active);
			button.setAttribute('aria-selected', String(active));
			button.tabIndex = active ? 0 : -1;
		}
	}

	async setMode(mode: SingularityWorkbenchMode, runAction: boolean): Promise<void> {
		if (this.mode !== mode) {
			this.mode = mode;
			this.storageService.store(STORAGE_KEY, mode, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			this.render();
		}

		if (!runAction) {
			return;
		}

		switch (mode) {
			case 'code':
				await this.focusIde();
				break;
			case 'chat':
				await this.openAgents();
				break;
		}
	}

	private async focusIde(): Promise<void> {
		try {
			this.layoutService.setPartHidden(false, Parts.EDITOR_PART);
		} catch {
			// ignore
		}
		try {
			await this.commandService.executeCommand('workbench.action.focusActiveEditorGroup');
		} catch {
			await this.editorService.activeEditorPane?.focus();
		}
	}

	private async openAgents(): Promise<void> {
		try {
			await this.commandService.executeCommand('workbench.action.openWorkspaceInAgentsWindow', { source: 'titleBar' });
		} catch {
			try {
				await this.commandService.executeCommand('workbench.action.openAgentsWindow');
			} catch {
				this.notificationService.notify({
					severity: Severity.Info,
					message: localize('singularity.mode.chat.unavailable', "Agents window is not available in this build."),
				});
			}
		}
	}

}
