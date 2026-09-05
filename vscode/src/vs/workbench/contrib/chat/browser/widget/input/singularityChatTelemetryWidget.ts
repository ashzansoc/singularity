/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { RunOnceScheduler } from '../../../../../../base/common/async.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../nls.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';

interface ChatFooterTelemetrySnapshot {
	show: boolean;
	relayLabel: string;
	relayTooltip: string;
	tokensLabel: string;
	tokensTooltip: string;
}

const FALLBACK_SNAPSHOT: ChatFooterTelemetrySnapshot = {
	show: true,
	relayLabel: '$(circle-outline) Neural Relay —',
	relayTooltip: 'Neural Relay context reduction will appear after your first request.',
	tokensLabel: '$(symbol-numeric) 0 tokens',
	tokensTooltip: 'Project token usage is tracked by Singularity AI.',
};

export class SingularityChatTelemetryWidget extends Disposable {

	readonly domNode: HTMLElement;

	private readonly relayNode: HTMLElement;
	private readonly tokensNode: HTMLElement;
	private readonly refreshScheduler: RunOnceScheduler;

	constructor(
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();

		this.domNode = dom.$('.chat-singularity-telemetry');
		this.domNode.setAttribute('role', 'status');
		this.domNode.setAttribute('aria-label', localize('singularity.chatTelemetry.aria', "Neural relay and token usage"));

		this.relayNode = dom.append(this.domNode, dom.$('button.chat-singularity-telemetry-item.chat-singularity-telemetry-relay'));
		(this.relayNode as HTMLButtonElement).type = 'button';
		this.tokensNode = dom.append(this.domNode, dom.$('button.chat-singularity-telemetry-item.chat-singularity-telemetry-tokens'));
		(this.tokensNode as HTMLButtonElement).type = 'button';

		this._register(dom.addDisposableListener(this.relayNode, 'click', () => {
			void this.commandService.executeCommand('singularity.ai.chatFooter.relay');
		}));
		this._register(dom.addDisposableListener(this.tokensNode, 'click', () => {
			void this.commandService.executeCommand('singularity.ai.chatFooter.tokens');
		}));

		this.refreshScheduler = this._register(new RunOnceScheduler(() => this.refresh(), 250));
		this._register(this.commandService.onDidExecuteCommand(e => {
			if (
				e.commandId === 'singularity.ai.recordUsage' ||
				e.commandId === 'singularity.ai.recordRelay' ||
				e.commandId === 'singularity.ai.setRequestPhase' ||
				e.commandId === 'singularity.ai.chatFooter.notify'
			) {
				this.refreshScheduler.schedule();
			}
		}));

		const interval = mainWindow.setInterval(() => this.refresh(), 2000);
		this._register({ dispose: () => mainWindow.clearInterval(interval) });

		void this.refresh();
	}

	private async refresh(): Promise<void> {
		try {
			const snapshot = await this.commandService.executeCommand<ChatFooterTelemetrySnapshot>(
				'singularity.ai.getChatFooterTelemetry',
			);
			this.render(snapshot ?? FALLBACK_SNAPSHOT);
		} catch {
			this.render(FALLBACK_SNAPSHOT);
		}
	}

	private render(snapshot: ChatFooterTelemetrySnapshot | undefined): void {
		const data = snapshot?.show ? snapshot : FALLBACK_SNAPSHOT;
		this.domNode.style.display = '';
		this.relayNode.replaceChildren();
		this.tokensNode.replaceChildren();

		const relayText = data.relayLabel.replace(/\$\([^)]+\)\s*/g, '').trim() || '—';
		const tokensText = data.tokensLabel.replace(/\$\([^)]+\)\s*/g, '').trim() || '0 tokens';

		this.relayNode.appendChild(dom.$('span.codicon.codicon-arrow-down'));
		this.relayNode.appendChild(document.createTextNode(` ${relayText}`));
		this.tokensNode.appendChild(dom.$('span.codicon.codicon-symbol-numeric'));
		this.tokensNode.appendChild(document.createTextNode(` ${tokensText}`));

		this.relayNode.title = data.relayTooltip;
		this.tokensNode.title = data.tokensTooltip;
	}
}
