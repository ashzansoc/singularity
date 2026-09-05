/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, expect, suite, test, vi } from 'vitest';
import { Event } from '../../../../util/vs/base/common/event';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { IConfigurationService } from '../../../configuration/common/configurationService';
import { ICAPIClientService } from '../../../endpoint/common/capiClient';
import { IDomainService } from '../../../endpoint/common/domainService';
import { IEnvService } from '../../../env/common/envService';
import { ILogService } from '../../../log/common/logService';
import { IFetcherService } from '../../../networking/common/fetcherService';
import { ITelemetryService } from '../../../telemetry/common/telemetry';
import { createPlatformServices } from '../../../test/node/services';
import { StaticGitHubAuthenticationService } from '../../common/staticGitHubAuthenticationService';
import { SingularityToken, createTestExtendedTokenInfo } from '../../common/singularityToken';
import { ISingularityTokenStore } from '../../common/singularityTokenStore';
import { FixedSingularityTokenManager } from '../../node/singularityTokenManager';

suite('AuthenticationService', function () {
	let disposables: DisposableStore;
	// These will be used to test the authentication service, but eventually these will
	// be folded into the authentication service itself.
	let singularityTokenManager: FixedSingularityTokenManager;
	let authenticationService: StaticGitHubAuthenticationService;

	const testToken = 'tid=test';

	beforeEach(async () => {
		disposables = new DisposableStore();
		const accessor = disposables.add(createPlatformServices().createTestingAccessor());
		singularityTokenManager = new FixedSingularityTokenManager(
			testToken,
			accessor.get(ILogService),
			accessor.get(ITelemetryService),
			accessor.get(ICAPIClientService),
			accessor.get(IDomainService),
			accessor.get(IFetcherService),
			accessor.get(IEnvService)
		);
		authenticationService = new StaticGitHubAuthenticationService(
			() => testToken,
			accessor.get(ILogService),
			accessor.get(ISingularityTokenStore),
			singularityTokenManager,
			accessor.get(IConfigurationService)
		);
		disposables.add(authenticationService);
	});

	afterEach(() => {
		disposables.dispose();
	});

	test('Can get anyGitHubToken', async () => {
		const token = await authenticationService.getGitHubSession('any', { silent: true });
		expect(token?.accessToken).toBe(testToken);
		expect(authenticationService.anyGitHubSession?.accessToken).toBe(testToken);
	});

	test('Can get permissiveGitHubToken', async () => {
		const token = await authenticationService.getGitHubSession('permissive', { silent: true });
		expect(token?.accessToken).toBe(testToken);
		expect(authenticationService.permissiveGitHubSession?.accessToken).toBe(testToken);
	});

	test('Can get singularityToken', async () => {
		const token = await authenticationService.getSingularityToken();
		expect(token.token).toBe(testToken);
		expect(authenticationService.singularityToken?.token).toBe(testToken);
	});

	test('hasSingularityTokenSource is true for static auth even without a GitHub session', () => {
		// Static auth represents non-OAuth Singularity token pathways (proxy/HMAC, eval harness, ...),
		// so it must report a token source regardless of whether anyGitHubSession is populated.
		const accessor = disposables.add(createPlatformServices().createTestingAccessor());
		const staticWithoutSession = disposables.add(new StaticGitHubAuthenticationService(
			undefined,
			accessor.get(ILogService),
			accessor.get(ISingularityTokenStore),
			singularityTokenManager,
			accessor.get(IConfigurationService),
		));
		expect(staticWithoutSession.anyGitHubSession).toBeUndefined();
		expect(staticWithoutSession.hasSingularityTokenSource).toBe(true);
	});

	test('Emits onDidSingularityTokenChange but not onDidAuthenticationChange when a Singularity Token change is notified', async () => {
		const authChangeSpy = vi.fn();
		authenticationService.onDidAuthenticationChange(authChangeSpy);
		const promise = Event.toPromise(authenticationService.onDidSingularityTokenChange);
		const newToken = 'tid=new';
		authenticationService.setSingularityToken(new SingularityToken(createTestExtendedTokenInfo({
			token: newToken,
			username: 'fake',
			singularity_plan: 'unknown',
		})));
		await promise;
		expect(authenticationService.singularityToken?.token).toBe(newToken);
		expect(authChangeSpy).not.toHaveBeenCalled();
	});

	test.skip('Emits onDidSingularityTokenChange when a Singularity Token change is notified from the manager', async () => {
		const promise = Event.toPromise(authenticationService.onDidSingularityTokenChange);
		const newToken = 'tid=new';
		singularityTokenManager.completionsToken = newToken;
		await promise;
		expect(authenticationService.singularityToken?.token).toBe(newToken);
	});
});
