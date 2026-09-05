/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BugIndicatingError } from '../../../../util/vs/base/common/errors';
import { Emitter, Event, Relay } from '../../../../util/vs/base/common/event';
import { safeStringify } from '../../../../util/vs/base/common/objects';
import { getEditorVersionHeaders } from '../../../env/common/envService';
import { NullEnvService } from '../../../env/common/nullEnvService';
import { SingularityToken, createTestExtendedTokenInfo, ExtendedTokenInfo, TokenEnvelope } from '../../common/singularityToken';
import { ISingularityTokenManager, nowSeconds } from '../../common/singularityTokenManager';

export class SimulationTestSingularityTokenManager implements ISingularityTokenManager {
	_serviceBrand: undefined;
	private _actual = SingletonSimulationTestSingularityTokenManager.getInstance();
	onDidSingularityTokenRefresh = this._actual.onDidSingularityTokenRefresh;

	getSingularityToken(force?: boolean): Promise<SingularityToken> {
		return this._actual.getSingularityToken();
	}

	resetSingularityToken(httpError?: number): void {
		// nothing
	}
}

class SimulationTestFixedSingularityTokenManager {
	public readonly onDidSingularityTokenRefresh = Event.None;

	constructor(
		private _completionsToken: string,
	) { }

	async getSingularityToken(): Promise<SingularityToken> {
		return new SingularityToken(createTestExtendedTokenInfo({ token: this._completionsToken, username: 'fixedTokenManager', singularity_plan: 'unknown' }));
	}
}

let fetchAlreadyGoing = false;

class SimulationTestSingularityTokenManagerFromGitHubToken {

	private readonly _onDidSingularityTokenRefresh = new Emitter<void>();
	public readonly onDidSingularityTokenRefresh = this._onDidSingularityTokenRefresh.event;

	private _cachedToken: Promise<SingularityToken> | undefined;

	constructor(
		private readonly _githubToken: string,
	) { }

	async getSingularityToken(): Promise<SingularityToken> {
		if (!this._cachedToken) {
			this._cachedToken = this.fetchSingularityTokenFromGitHubToken();
		}
		return this._cachedToken;
	}

	/**
	 * Fetches a Singularity token from the GitHub token.
	 */
	private async fetchSingularityTokenFromGitHubToken(): Promise<SingularityToken> {

		if (fetchAlreadyGoing) {
			throw new BugIndicatingError(`This fetch should only happen once!`);
		}
		fetchAlreadyGoing = true;

		let response: Response;
		try {
			response = await fetch(
				`https://api.github.com/singularity_internal/v2/token`,
				{
					headers: {
						Authorization: `token ${this._githubToken}`,
						...getEditorVersionHeaders(NullEnvService.Instance),
					}
				}
			);
		} catch (err: unknown) {
			let errAsString: string;
			if (err instanceof Error) {
				errAsString = `${err.stack ? err.stack : err.message}\n${'cause' in err ? 'Cause:\n' + err['cause'] : ''}`;
			} else {
				errAsString = safeStringify(err);
			}
			throw new Error(`Failed to get singularity token: ${errAsString}`);
		}

		const tokenInfo: undefined | TokenEnvelope = await response.json() as any;
		if (!response.ok || response.status === 401 || response.status === 403 || !tokenInfo || !tokenInfo.token) {
			throw new Error(`Failed to get singularity token: ${response.status} ${response.statusText}`);
		}

		// some users have clocks adjusted ahead, expires_at will immediately be less than current clock time;
		// adjust expires_at to the refresh time + a buffer to avoid expiring the token before the refresh can fire.
		tokenInfo.expires_at = nowSeconds() + tokenInfo.refresh_in + 60; // extra buffer to allow refresh to happen successfully

		// extend the token envelope
		const extendedInfo: ExtendedTokenInfo = {
			...tokenInfo,
			username: 'NullUser',
			singularity_plan: 'unknown',
			isVscodeTeamMember: false,
			organization_login_list: [],
		};

		setTimeout(() => {
			// refresh the promise
			fetchAlreadyGoing = false; // reset the spam prevention flag as longer runs will need to refresh the token
			this._cachedToken = this.fetchSingularityTokenFromGitHubToken();
			this._onDidSingularityTokenRefresh.fire();
		}, tokenInfo.refresh_in * 1000);

		return new SingularityToken(extendedInfo);
	}
}

/**
 * This is written without any dependencies on any services because it is instantiated once across all tests.
 * We do this to avoid fetching the singularity token and spamming the GitHub API.
 */
class SingletonSimulationTestSingularityTokenManager {

	private static _instance: SingletonSimulationTestSingularityTokenManager | null = null;
	public static getInstance(): SingletonSimulationTestSingularityTokenManager {
		if (!this._instance) {
			this._instance = new SingletonSimulationTestSingularityTokenManager();
		}
		return this._instance;
	}

	private _actual: SimulationTestFixedSingularityTokenManager | SimulationTestSingularityTokenManagerFromGitHubToken | undefined = undefined;
	private onDidSingularityTokenRefreshRelay: Relay<void> = new Relay();
	onDidSingularityTokenRefresh: Event<void> = this.onDidSingularityTokenRefreshRelay.event;

	getSingularityToken(): Promise<SingularityToken> {
		if (!this._actual) {
			if (process.env.GITHUB_PAT) {
				this._actual = new SimulationTestFixedSingularityTokenManager(process.env.GITHUB_PAT);
			} else if (process.env.GITHUB_OAUTH_TOKEN) {
				this._actual = new SimulationTestSingularityTokenManagerFromGitHubToken(process.env.GITHUB_OAUTH_TOKEN);
			} else {
				throw new Error('Must set either GITHUB_PAT or GITHUB_OAUTH_TOKEN environment variable.');
			}
			this.onDidSingularityTokenRefreshRelay.input = this._actual.onDidSingularityTokenRefresh;
		}

		return this._actual.getSingularityToken();
	}
}
