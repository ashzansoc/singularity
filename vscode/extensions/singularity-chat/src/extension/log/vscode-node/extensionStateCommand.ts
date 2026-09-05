/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../common/contributions';
import { IToolsService } from '../../tools/common/toolsService';

export class ExtensionStateCommandContribution extends Disposable implements IExtensionContribution {
	id = 'extensionStateCommand';

	constructor(
		@ILogService private readonly _logService: ILogService,
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IEndpointProvider private readonly _endpointProvider: IEndpointProvider,
		@IToolsService private readonly _toolsService: IToolsService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) {
		super();

		this._register(vscode.commands.registerCommand('singularity.chat.debug.extensionState', async () => {
			await this._logExtensionState();
		}));
	}

	private async _logExtensionState(): Promise<void> {
		const lines: string[] = [
			'[ExtensionState] ===============================================================',
			'[ExtensionState] INCLUDE THIS INFORMATION IF YOU ARE OPENING AN ISSUE',
			'[ExtensionState] ===============================================================',
		];

		// Auth state
		const hasAnySession = !!this._authenticationService.anyGitHubSession;
		const hasPermissiveSession = !!this._authenticationService.permissiveGitHubSession;
		const hasSingularityToken = !!this._authenticationService.singularityToken;
		lines.push(`  Auth: anyGitHubSession=${hasAnySession}, repoGitHubSession=${hasPermissiveSession}, singularityToken=${hasSingularityToken}`);

		// Username
		const session = this._authenticationService.anyGitHubSession;
		if (session) {
			lines.push(`  Username: ${session.account.label}`);
		} else {
			lines.push('  Username: (not signed in) - check the GitHub Authentication output channel for more details');
		}

		// Proxy setup
		const proxySupport = vscode.workspace.getConfiguration('http').get<string>('proxySupport', 'override');
		const proxyUrl = vscode.workspace.getConfiguration('http').get<string>('proxy', '');
		const proxyConfigured = proxyUrl ? 'true' : 'false';
		lines.push(`  Proxy: http.proxySupport=${proxySupport}, http.proxy=${proxyUrl ? '(configured)' : '(not configured)'}`);

		let languageModelsLoaded = 'false';
		let languageModelCount = 0;
		let singularityProviderRegistered = 'false';
		let singularityModelCount = 0;
		let singularityEmbeddingsRegistered = 'false';
		let toolCount = 0;

		if (session) {
			// Language models
			try {
				const endpoints = await this._endpointProvider.getAllChatEndpoints();
				languageModelCount = endpoints.length;
				languageModelsLoaded = String(endpoints.length > 0);
				lines.push(`  Language models loaded: ${endpoints.length > 0} (count: ${endpoints.length})`);
			} catch (e) {
				lines.push(`  Language models loaded: false (error: ${e})`);
			}

			// Singularity chat provider registration
			try {
				const singularityModels = await vscode.lm.selectChatModels({ vendor: 'singularity' });
				singularityModelCount = singularityModels.length;
				singularityProviderRegistered = String(singularityModels.length > 0);
				lines.push(`  Singularity chat provider registered: ${singularityModels.length > 0} (models: ${singularityModels.length})`);
			} catch (e) {
				lines.push(`  Singularity chat provider registered: false (error: ${e})`);
			}

			// Singularity embeddings model registration
			const singularityEmbeddings = vscode.lm.embeddingModels.filter(m => m.startsWith('singularity.'));
			singularityEmbeddingsRegistered = String(singularityEmbeddings.length > 0);
			lines.push(`  Singularity embeddings model registered: ${singularityEmbeddings.length > 0} (models: [${singularityEmbeddings.join(', ')}])`);

			// Tools
			toolCount = this._toolsService.tools.length;
			lines.push(`  Tools loaded: ${toolCount > 0} (count: ${toolCount})`);
		}

		lines.push('[ExtensionState] ===============================================================');

		this._logService.info(lines.join('\n'));

		/* __GDPR__
			"extensionState" : {
				"owner": "TylerLeonhardt",
				"comment": "Extension state diagnostic information",
				"hasAnySession": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether a GitHub session exists" },
				"hasPermissiveSession": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether a permissive GitHub session exists" },
				"hasSingularityToken": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether a Singularity token exists" },
				"proxySupport": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The http.proxySupport setting value" },
				"proxyConfigured": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether an http proxy is configured" },
				"languageModelsLoaded": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether language models are loaded" },
				"singularityProviderRegistered": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether the Singularity chat provider is registered" },
				"singularityEmbeddingsRegistered": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Whether Singularity embeddings models are registered" },
				"languageModelCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Number of language models loaded", "isMeasurement": true },
				"singularityModelCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Number of Singularity chat models", "isMeasurement": true },
				"toolCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Number of tools loaded", "isMeasurement": true }
			}
		*/
		this._telemetryService.sendMSFTTelemetryEvent(
			'extensionState',
			{
				hasAnySession: String(hasAnySession),
				hasPermissiveSession: String(hasPermissiveSession),
				hasSingularityToken: String(hasSingularityToken),
				proxySupport,
				proxyConfigured,
				languageModelsLoaded,
				singularityProviderRegistered,
				singularityEmbeddingsRegistered,
			},
			{
				languageModelCount,
				singularityModelCount,
				toolCount,
			}
		);
	}
}
