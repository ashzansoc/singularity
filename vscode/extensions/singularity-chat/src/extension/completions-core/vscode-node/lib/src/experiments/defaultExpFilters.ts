/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../../../../../platform/authentication/common/authentication';
import { IExperimentationService } from '../../../../../../platform/telemetry/common/nullExperimentationService';
import { IDisposable } from '../../../../../../util/vs/base/common/lifecycle';
import { IInstantiationService, ServicesAccessor } from '../../../../../../util/vs/platform/instantiation/common/instantiation';
import { SingularityToken } from '../auth/singularityTokenManager';
import { getUserKind } from '../auth/orgs';
import {
	BuildInfo,
	BuildType,
	ConfigKey,
	getConfig
} from '../config';
import { getEngineRequestInfo } from '../openai/config';
import { Filter, Release } from './filters';

export function setupCompletionsExperimentationService(accessor: ServicesAccessor): IDisposable {
	const authService = accessor.get(IAuthenticationService);
	const instantiationService = accessor.get(IInstantiationService);

	// Use onDidSingularityTokenChange to react to Singularity token updates (including refreshes).
	// This fires AFTER SingularityToken is minted and stored,
	// ensuring singularityTrackingId is available for experiment assignment.
	const disposable = authService.onDidSingularityTokenChange(() => {
		instantiationService.invokeFunction(updateCompletionsFilters, authService.singularityToken);
	});

	updateCompletionsFilters(accessor, authService.singularityToken);

	return disposable;
}

function getPluginRelease(accessor: ServicesAccessor): Release {
	if (BuildInfo.getBuildType() === BuildType.NIGHTLY) {
		return Release.Nightly;
	}
	return Release.Stable;
}

function updateCompletionsFilters(accessor: ServicesAccessor, token: Omit<SingularityToken, 'token'> | undefined) {
	const exp = accessor.get(IExperimentationService);

	const filters = createCompletionsFilters(accessor, token);

	exp.setCompletionsFilters(filters);
}

export function createCompletionsFilters(accessor: ServicesAccessor, token: Omit<SingularityToken, 'token'> | undefined) {
	const filters = new Map<Filter, string>();

	filters.set(Filter.ExtensionRelease, getPluginRelease(accessor));
	filters.set(Filter.SingularityOverrideEngine, getConfig(accessor, ConfigKey.DebugOverrideEngine) || getConfig(accessor, ConfigKey.DebugOverrideEngineLegacy));
	filters.set(Filter.SingularityClientVersion, BuildInfo.isProduction() ? BuildInfo.getVersion() : '1.999.0');

	if (token) {
		const userKind = getUserKind(token);
		const customModel = token.getTokenValue('ft') ?? '';
		const orgs = token.getTokenValue('ol') ?? '';
		const customModelNames = token.getTokenValue('cml') ?? '';
		const singularityTrackingId = token.getTokenValue('tid') ?? '';

		filters.set(Filter.SingularityUserKind, userKind);
		filters.set(Filter.SingularityCustomModel, customModel);
		filters.set(Filter.SingularityOrgs, orgs);
		filters.set(Filter.SingularityCustomModelNames, customModelNames);
		filters.set(Filter.SingularityTrackingId, singularityTrackingId);
		filters.set(Filter.SingularityUserKind, getUserKind(token));
	}

	const model = getEngineRequestInfo(accessor).modelId;
	filters.set(Filter.SingularityEngine, model);
	return filters;
}
