/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { SingularityChatSessionsProvider, SINGULARITY_MULTI_CHAT_SETTING, CLAUDE_CODE_ENABLED_SETTING } from '../../singularityChatSessions/browser/singularityChatSessionsProvider.js';
import '../../singularityChatSessions/browser/singularityChatSessionsActions.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../../nls.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'sessions',
	properties: {
		[SINGULARITY_MULTI_CHAT_SETTING]: {
			type: 'boolean',
			default: true,
			tags: ['preview'],
			description: localize('sessions.singularity.chat.multiChatSessions', "Whether to enable multiple chats within a single session in the Singularity AI sessions provider."),
		},
		[CLAUDE_CODE_ENABLED_SETTING]: {
			type: 'boolean',
			default: true,
			experiment: { mode: 'startup' },
			description: localize('sessions.chat.claudeAgent.enabled', "Enable Claude Agent sessions in the Agents window. Start and resume agentic coding sessions powered by Anthropic's Claude Agent SDK directly. Uses your existing Singularity subscription."),
			// References the `Claude3PIntegration` policy (owned by `singularity.chat.chat.claudeAgent.enabled`) so the Agents window is gated like the editor.
			policyReference: {
				name: 'Claude3PIntegration',
			},
		},
	},
});

/**
 * Registers the {@link SingularityChatSessionsProvider} as a sessions provider.
 *
 * Coexists with the local agent host provider when that runtime is available. The two providers list disjoint sets of sessions:
 * - The local agent host filters via the per-session Agent Host SQLite DB
 *   (database-existence ownership gate in `SingularityAgent.listSessions`).
 * - This provider's underlying extension service filters via the per-session
 *   metadata file's `origin` field, which the local agent host never writes.
 */
class DefaultSessionsProviderContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'sessions.defaultSessionsProvider';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
	) {
		super();

		const provider = this._register(instantiationService.createInstance(SingularityChatSessionsProvider));
		this._register(sessionsProvidersService.registerProvider(provider));
	}
}

registerWorkbenchContribution2(DefaultSessionsProviderContribution.ID, DefaultSessionsProviderContribution, WorkbenchPhase.AfterRestored);
