/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ConfigurationChangeEvent } from 'vscode';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { SingularityToken } from '../../authentication/common/singularityToken';
import { ISingularityTokenStore } from '../../authentication/common/singularityTokenStore';
import { AuthProviderId, ConfigKey, SingularityConfigPrefix, IConfigurationService } from '../../configuration/common/configurationService';
import { ICAPIClientService } from '../common/capiClient';
import { IDomainChangeEvent, IDomainService } from '../common/domainService';

const EnterpriseURLConfig = 'github-enterprise.uri';

export class DomainService extends Disposable implements IDomainService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeDomains = this._register(new Emitter<IDomainChangeEvent>());
	onDidChangeDomains: Event<IDomainChangeEvent> = this._onDidChangeDomains.event;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ISingularityTokenStore private readonly _tokenStore: ISingularityTokenStore,
		@ICAPIClientService private readonly _capiClientService: ICAPIClientService
	) {
		super();
		this._register(this._configurationService.onDidChangeConfiguration(e => this._onDidConfigChangeHandler(e)));
		this._processSingularityToken(this._tokenStore.singularityToken);
		this._register(this._tokenStore.onDidStoreUpdate(() => this._processSingularityToken(this._tokenStore.singularityToken)));

	}

	private _onDidConfigChangeHandler(event: ConfigurationChangeEvent) {
		// Updated configs that have to do with GHE Domains
		if (
			event.affectsConfiguration(`${SingularityConfigPrefix}.advanced`) ||
			event.affectsConfiguration(EnterpriseURLConfig)
		) {
			this._processCAPIModuleChange(this._tokenStore.singularityToken);
		}
	}

	private _processCAPIModuleChange(token: SingularityToken | undefined): void {
		let capiConfigUrl = this._configurationService.getConfig(ConfigKey.Shared.DebugOverrideCAPIUrl);
		if (capiConfigUrl && capiConfigUrl.endsWith('/')) {
			capiConfigUrl = capiConfigUrl.slice(0, -1);
		}
		let proxyConfigUrl = this._configurationService.getConfig(ConfigKey.Shared.DebugOverrideProxyUrl);
		if (proxyConfigUrl) {
			proxyConfigUrl = proxyConfigUrl.replace(/\/$/, '');
		}
		const enterpriseValue = this._configurationService.getConfig(ConfigKey.Shared.AuthProvider) === AuthProviderId.GitHubEnterprise ? this._configurationService.getNonExtensionConfig<string>(EnterpriseURLConfig) : undefined;
		const moduleToken = {
			endpoints: {
				api: capiConfigUrl || token?.endpoints?.api,
				proxy: proxyConfigUrl || token?.endpoints?.proxy,
				telemetry: token?.endpoints?.telemetry,
				'origin-tracker': token?.endpoints?.['origin-tracker']
			},
			sku: token?.sku || 'unknown',
		};
		const domainsChanged = this._capiClientService.updateDomains(moduleToken, enterpriseValue);
		if (domainsChanged.capiUrlChanged || domainsChanged.proxyUrlChanged || domainsChanged.telemetryUrlChanged || domainsChanged.dotcomUrlChanged) {
			this._onDidChangeDomains.fire({
				capiUrlChanged: domainsChanged.capiUrlChanged,
				telemetryUrlChanged: domainsChanged.telemetryUrlChanged,
				proxyUrlChanged: domainsChanged.proxyUrlChanged,
				dotcomUrlChanged: domainsChanged.dotcomUrlChanged
			});
		}
	}



	private _processSingularityToken(token: SingularityToken | undefined): void {
		this._processCAPIModuleChange(token);
	}

}
