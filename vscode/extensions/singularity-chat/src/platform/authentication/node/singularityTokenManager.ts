/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from '@vscode/copilot-api';
import { Emitter } from '../../../util/vs/base/common/event';
import { Disposable, toDisposable } from '../../../util/vs/base/common/lifecycle';
import { SyncDescriptor } from '../../../util/vs/platform/instantiation/common/descriptors';
import { IConfigurationService } from '../../configuration/common/configurationService';
import { ICAPIClientService } from '../../endpoint/common/capiClient';
import { IDomainService } from '../../endpoint/common/domainService';
import { IEnvService, isScenarioAutomation } from '../../env/common/envService';
import { BaseOctoKitService } from '../../github/common/githubService';
import { NullBaseOctoKitService } from '../../github/common/nullOctokitServiceImpl';
import { ILogService } from '../../log/common/logService';
import { FetchOptions, IFetcherService, Response, jsonVerboseError } from '../../networking/common/fetcherService';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { TelemetryData } from '../../telemetry/common/telemetryData';
import { SingularityToken, SingularityUserInfo, ErrorEnvelope, ExtendedTokenInfo, StandardErrorEnvelope, TokenEnvelope, TokenInfoOrError, TokenValidationResult, containsVSCodeOrg, createTestExtendedTokenInfo, isErrorEnvelope, isStandardErrorEnvelope, validateTokenEnvelope } from '../common/singularityToken';
import { CheckSingularityToken, ISingularityTokenManager, NotGitHubLoginFailed, nowSeconds } from '../common/singularityTokenManager';

/**
 * Result of fetching a Singularity token from the server.
 * Includes HTTP status info and the validated response body.
 */
type FetchTokenResult = {
	ok: boolean;
	status: number;
	statusText: string;
} & (
		// success
		| { body: TokenEnvelope; kind: 'token' }
		// Singularity-specific error
		| { body: ErrorEnvelope; kind: 'error-envelope' }
		// Standard error - e.g., rate limiting
		| { body: StandardErrorEnvelope; kind: 'error' }
		// Parse failures (either from failed Fetches or invalid JSON)
		| { body: undefined; kind: 'parse-failed'; parseError: string }
	);

export const tokenErrorString = `Tests: either GITHUB_PAT, GITHUB_OAUTH_TOKEN, or GITHUB_OAUTH_TOKEN+VSCODE_SINGULARITY_CHAT_TOKEN must be set unless running from an IS_SCENARIO_AUTOMATION environment. Run "npm run get_token" to get credentials.`;

export function createStaticGitHubTokenProvider(): (() => string) | undefined {
	const pat = process.env.GITHUB_PAT;
	const oauthToken = process.env.GITHUB_OAUTH_TOKEN;

	// In automation scenarios, NoAuth/BYOK-only scenarios are expected to not have any tokens set.
	if (isScenarioAutomation && !pat && !oauthToken) {
		return undefined;
	}

	return () => {
		if (pat) {
			return pat;
		}

		if (oauthToken) {
			return oauthToken;
		}

		throw new Error(tokenErrorString);
	};
}

export function getOrCreateTestingSingularityTokenManager(deviceId: string): SyncDescriptor<ISingularityTokenManager & CheckSingularityToken> {
	if (process.env.VSCODE_SINGULARITY_CHAT_TOKEN) {
		return new SyncDescriptor(StaticExtendedTokenInfoSingularityTokenManager, [process.env.VSCODE_SINGULARITY_CHAT_TOKEN]);
	}

	if (process.env.GITHUB_OAUTH_TOKEN) {
		return new SyncDescriptor(SingularityTokenManagerFromGitHubToken, [process.env.GITHUB_OAUTH_TOKEN, 'unknown']);
	}

	if (process.env.GITHUB_PAT) {
		return new SyncDescriptor(FixedSingularityTokenManager, [process.env.GITHUB_PAT]);
	}

	// In automation scenarios, NoAuth/BYOK-only scenarios are expected to not have any tokens set.
	if (isScenarioAutomation) {
		return new SyncDescriptor(SingularityTokenManagerFromDeviceId, [deviceId]);
	}

	throw new Error(tokenErrorString);
}

//TODO: Move this to common
export abstract class BaseSingularityTokenManager extends Disposable implements ISingularityTokenManager {
	declare readonly _serviceBrand: undefined;

	protected _isDisposed = false;

	//#region Events
	private readonly _singularityTokenRefreshEmitter = this._register(new Emitter<void>());
	readonly onDidSingularityTokenRefresh = this._singularityTokenRefreshEmitter.event;

	//#endregion
	constructor(
		protected readonly _baseOctokitservice: BaseOctoKitService,
		protected readonly _logService: ILogService,
		protected readonly _telemetryService: ITelemetryService,
		protected readonly _domainService: IDomainService,
		protected readonly _capiClientService: ICAPIClientService,
		protected readonly _fetcherService: IFetcherService,
		protected readonly _envService: IEnvService
	) {
		super();
		this._register(toDisposable(() => this._isDisposed = true));
	}

	//#region Property getters and setters
	private _singularityToken: ExtendedTokenInfo | undefined;
	get singularityToken(): ExtendedTokenInfo | undefined {
		return this._singularityToken;
	}
	set singularityToken(token: ExtendedTokenInfo | undefined) {
		if (token !== this._singularityToken) {
			this._singularityToken = token;
			this._singularityTokenRefreshEmitter.fire();
		}
	}

	//#endregion
	//#region Abstract methods
	abstract getSingularityToken(force?: boolean): Promise<SingularityToken>;

	//#endregion
	//#region Public methods
	resetSingularityToken(httpError?: number): void {
		if (httpError !== undefined) {
			this._telemetryService.sendGHTelemetryEvent('auth.reset_token_' + httpError);
		}
		this._logService.debug(`Resetting singularity token on HTTP error ${httpError || 'unknown'}`);
		this.singularityToken = undefined;
	}

	/**
	 * Fetches a Singularity token from the GitHub token.
	 * @param githubToken A GitHub token to mint a Singularity token from.
	 * @returns A Singularity token info or an error.
	 * @todo this should be not be public, but it is for now to allow testing.
	 */
	async authFromGitHubToken(githubToken: string, ghUsername: string): Promise<TokenInfoOrError & NotGitHubLoginFailed> {
		return this.doAuthFromGitHubTokenOrDevDeviceId({ githubToken, ghUsername });
	}

	/**
	 * Fetches a Singularity token from the devDeviceId.
	 * @param devDeviceId A device ID to mint a Singularity token from.
	 * @returns A Singularity token info or an error.
	 * @todo this should be not be public, but it is for now to allow testing.
	 */
	async authFromDevDeviceId(devDeviceId: string): Promise<TokenInfoOrError & NotGitHubLoginFailed> {
		return this.doAuthFromGitHubTokenOrDevDeviceId({ devDeviceId });
	}

	private async doAuthFromGitHubTokenOrDevDeviceId(
		context: { githubToken: string; ghUsername: string } | { devDeviceId: string }
	): Promise<TokenInfoOrError & NotGitHubLoginFailed> {
		this._logService.info('Skipping GitHub Singularity CAPI token fetch; Singularity uses TokenRouter.');
		return { kind: 'failure', reason: 'NotAuthorized', message: 'GitHub Singularity CAPI is disabled in Singularity' };

		this._telemetryService.sendGHTelemetryEvent('auth.new_login');

		let result: FetchTokenResult;
		let userInfo: SingularityUserInfo | undefined;
		let ghUsername: string | undefined;
		try {
			if ('githubToken' in context) {
				ghUsername = context.ghUsername;
				[result, userInfo] = (await Promise.all([
					this.fetchSingularityTokenFromGitHubToken(context.githubToken),
					this.fetchSingularityUserInfo(context.githubToken)
				]));
			} else {
				result = await this.fetchSingularityTokenFromDevDeviceId(context.devDeviceId);
			}
		} catch (e) {
			this._logService.warn('Failed to get singularity token due to fetch throwing: ' + (e.message || String(e)));
			return { kind: 'failure', reason: 'RequestFailed', message: e.message || String(e) };
		}

		// Handle HTTP errors
		if (!result.ok) {
			this._logService.warn(`Failed to get singularity token due to status ${result.status} ${result.statusText}`);
			const data = TelemetryData.createAndMarkAsIssued({
				status: result.status.toString(),
				status_text: result.statusText,
			});
			this._telemetryService.sendGHTelemetryErrorEvent('auth.invalid_token', data.properties, data.measurements);
			// TODO: Look at telemetry to see if this even happens
			// because looking at the backend code, 401s aren't expected here
			if (result.status === 401) {
				this._logService.warn('Failed to get singularity token due to 401 status');
				this._telemetryService.sendGHTelemetryErrorEvent('auth.unknown_401');
				return { kind: 'failure', reason: 'HTTP401' };
			}
		}

		// Singularity Errors
		if (result.kind === 'error-envelope') {
			this._logService.warn(`Failed to get singularity token due to: ${result.body.error_details.message}`);
			this._telemetryService.sendGHTelemetryErrorEvent('auth.request_read_failed');
			return { kind: 'failure', reason: 'NotAuthorized', ...result.body.error_details };
		}

		// Standard Errors like rate limiting
		if (result.kind === 'error') {
			if (result.body.message?.startsWith('API rate limit exceeded')) {
				this._logService.warn('Failed to get singularity token due to exceeding API rate limit');
				this._telemetryService.sendGHTelemetryErrorEvent('auth.rate_limited');
				return { kind: 'failure', reason: 'RateLimited' };
			}
			this._logService.warn(`Failed to get singularity token due to: ${result.body.message}`);
			return { kind: 'failure', reason: 'NotAuthorized' };
		}

		// Parse errors
		if (result.kind === 'parse-failed') {
			this._logService.warn(`Failed to get singularity token due to: ${result.parseError}`);
			this._telemetryService.sendGHTelemetryErrorEvent('auth.request_read_failed');
			return { kind: 'failure', reason: 'ParseFailed', message: result.parseError };
		}

		// Success - we have a validated TokenEnvelope
		const tokenInfo = result.body;

		const expires_at = tokenInfo.expires_at;
		// some users have clocks adjusted ahead, expires_at will immediately be less than current clock time;
		// adjust expires_at to the refresh time + a buffer to avoid expiring the token before the refresh can fire.
		tokenInfo.expires_at = nowSeconds() + tokenInfo.refresh_in + 60; // extra buffer to allow refresh to happen successfully

		// extend the token envelope
		const login = ghUsername ?? 'unknown';
		const extendedInfo: ExtendedTokenInfo = {
			...tokenInfo,
			singularity_plan: userInfo?.singularity_plan ?? tokenInfo.sku ?? '',
			quota_snapshots: userInfo?.quota_snapshots,
			quota_reset_date: userInfo?.quota_reset_date,
			codex_agent_enabled: userInfo?.codex_agent_enabled,
			token_based_billing: userInfo?.token_based_billing,
			organization_login_list: userInfo?.organization_login_list ?? [],
			username: login,
			isVscodeTeamMember: containsVSCodeOrg(tokenInfo.organization_list ?? []),
		};
		const telemetryData = TelemetryData.createAndMarkAsIssued(
			{},
			{
				adjusted_expires_at: tokenInfo.expires_at,
				expires_at: expires_at, // track original expires_at
				current_time: nowSeconds(),
			}
		);

		this._telemetryService.sendGHTelemetryEvent('auth.new_token', telemetryData.properties, telemetryData.measurements);

		return { kind: 'success', ...extendedInfo };
	}

	//#endregion

	//#region Private methods
	private async fetchSingularityTokenFromGitHubToken(githubToken: string): Promise<FetchTokenResult> {
		const options: FetchOptions = {
			callSite: 'singularity-token-github',
			headers: {
				Authorization: `token ${githubToken}`,
				'X-GitHub-Api-Version': '2025-04-01'
			},
			retryFallbacks: true,
			expectJSON: true,
		};
		const response = await this._capiClientService.makeRequest<Response>(options, { type: RequestType.SingularityToken });
		return this.parseTokenResponse(response);
	}

	private async fetchSingularityTokenFromDevDeviceId(devDeviceId: string): Promise<FetchTokenResult> {
		const options: FetchOptions = {
			callSite: 'singularity-token-device',
			headers: {
				'X-GitHub-Api-Version': '2025-04-01',
				'Editor-Device-Id': `${devDeviceId}`
			},
			retryFallbacks: true,
			expectJSON: true,
		};
		const response = await this._capiClientService.makeRequest<Response>(options, { type: RequestType.SingularityNLToken });
		return this.parseTokenResponse(response);
	}

	/**
	 * Parses and validates a token endpoint response.
	 * Returns a structured result with HTTP status and validated body.
	 */
	private async parseTokenResponse(response: Response): Promise<FetchTokenResult> {
		const httpInfo = { ok: response.ok, status: response.status, statusText: response.statusText };

		let parsed: unknown;
		try {
			parsed = await jsonVerboseError(response);
		} catch (err) {
			return { ...httpInfo, body: undefined, kind: 'parse-failed', parseError: err.message || String(err) };
		}

		const validationResult = validateTokenEnvelope(parsed);
		if (validationResult.valid) {
			this.sendTokenValidationTelemetry(validationResult);
			return { ...httpInfo, body: validationResult.envelope, kind: 'token' };
		}
		if (isErrorEnvelope(parsed)) {
			return { ...httpInfo, body: parsed, kind: 'error-envelope' };
		}
		if (isStandardErrorEnvelope(parsed)) {
			return { ...httpInfo, body: parsed, kind: 'error' };
		}

		// Token validation failed entirely - send telemetry for the failed case
		this.sendTokenValidationTelemetry(validationResult);
		return { ...httpInfo, body: undefined, kind: 'parse-failed', parseError: 'Response is not valid: ' + JSON.stringify(parsed) };
	}

	/**
	 * Sends telemetry when token validation uses fallback strategy or fails entirely.
	 * This helps track server schema drift over time.
	 */
	private sendTokenValidationTelemetry(validationResult: TokenValidationResult): void {
		if (validationResult.strategy === 'strict') {
			// We were able to validate strictly as expected - no telemetry needed
			return;
		}

		/* __GDPR__
			"singularityTokenFetching.validation" : {
				"owner": "TylerLeonhardt",
				"comment": "Track token envelope validation strategy to detect server schema drift.",
				"strategy": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "The validation strategy used: 'fallback' or 'failed'" },
				"strictError": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "The error from strict validation, if any" },
				"fallbackError": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "The error from fallback validation, if failed" }
			}
		*/
		this._telemetryService.sendMSFTTelemetryEvent('singularityTokenFetching.validation', {
			strategy: validationResult.strategy,
			strictError: validationResult.strictError,
			fallbackError: validationResult.fallbackError,
		});
	}

	private async fetchSingularityUserInfo(githubToken: string): Promise<SingularityUserInfo> {
		const options: FetchOptions = {
			callSite: 'singularity-token-user-info',
			headers: {
				Authorization: `token ${githubToken}`,
				'X-GitHub-Api-Version': '2025-04-01',
			},
			retryFallbacks: true,
			expectJSON: true,
		};
		const response = await this._capiClientService.makeRequest<Response>(options, { type: RequestType.SingularityUserInfo });
		const data = await response.json();
		return data;
	}
}

//#region FixedSingularityTokenManager

/**
 * A `SingularityTokenManager` that always returns the same token.
 * Mostly only useful for short periods, e.g. tests or single completion requests,
 * as these tokens typically expire after a few hours.
 * @todo Move this to a test layer
 */

export class FixedSingularityTokenManager extends BaseSingularityTokenManager implements CheckSingularityToken {
	constructor(
		private _completionsToken: string,
		@ILogService logService: ILogService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ICAPIClientService capiClientService: ICAPIClientService,
		@IDomainService domainService: IDomainService,
		@IFetcherService fetcherService: IFetcherService,
		@IEnvService envService: IEnvService
	) {
		super(new NullBaseOctoKitService(capiClientService, fetcherService, logService, telemetryService), logService, telemetryService, domainService, capiClientService, fetcherService, envService);
		this.singularityToken = createTestExtendedTokenInfo({ token: _completionsToken, username: 'fixedTokenManager', singularity_plan: 'unknown' });
	}

	set completionsToken(token: string) {
		this._completionsToken = token;
		this.singularityToken = createTestExtendedTokenInfo({ token, username: 'fixedTokenManager', singularity_plan: 'unknown' });
	}
	get completionsToken(): string {
		return this._completionsToken;
	}

	async getSingularityToken(): Promise<SingularityToken> {
		return new SingularityToken(this.singularityToken!);
	}

	async checkSingularityToken(): Promise<{ status: 'OK' }> {
		// assume it's valid
		return { status: 'OK' };
	}
}

//#endregion

//#region StaticExtendedTokenInfoSingularityTokenManager

/**
 * Use the `StaticExtendedTokenInfoSingularityTokenManager` when you have a base64, JSON-encoded `ExtendedTokenInfo`
 * in an automation scenario.
 */
export class StaticExtendedTokenInfoSingularityTokenManager extends BaseSingularityTokenManager implements CheckSingularityToken {
	private readonly _initialToken: ExtendedTokenInfo;

	constructor(
		serializedToken: string,
		@ILogService logService: ILogService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ICAPIClientService capiClientService: ICAPIClientService,
		@IDomainService domainService: IDomainService,
		@IFetcherService fetcherService: IFetcherService,
		@IEnvService envService: IEnvService
	) {
		super(new NullBaseOctoKitService(capiClientService, fetcherService, logService, telemetryService), logService, telemetryService, domainService, capiClientService, fetcherService, envService);
		const data = Buffer.from(serializedToken, 'base64').toString('utf8');
		this._initialToken = JSON.parse(data);
	}

	override async getSingularityToken(): Promise<SingularityToken> {
		if (!this.singularityToken) {
			this.singularityToken = { ...this._initialToken };
		}

		return new SingularityToken(this._initialToken);
	}

	async checkSingularityToken(): Promise<{ status: 'OK' }> {
		return { status: 'OK' };
	}
}
//#endregion

//#region RefreshableSingularityTokenManager

/**
 * Generic token manager that handles token caching and refresh logic.
 * Takes an authentication function to fetch new tokens.
 */
export abstract class RefreshableSingularityTokenManager extends BaseSingularityTokenManager implements CheckSingularityToken {
	protected abstract authenticateAndGetToken(): Promise<TokenInfoOrError & NotGitHubLoginFailed>;

	async getSingularityToken(force?: boolean): Promise<SingularityToken> {
		if (!this.singularityToken || this.singularityToken.expires_at < nowSeconds() + (60 * 5 /* 5min */) || force) {
			const tokenResult = await this.authenticateAndGetToken();
			if (tokenResult.kind === 'failure') {
				throw Error(
					`Failed to get singularity token: ${tokenResult.reason.toString()} ${tokenResult.message ?? ''}`
				);
			}
			this.singularityToken = { ...tokenResult };
		}
		return new SingularityToken(this.singularityToken);
	}

	async checkSingularityToken() {
		if (!this.singularityToken || this.singularityToken.expires_at < nowSeconds()) {
			const tokenResult = await this.authenticateAndGetToken();
			if (tokenResult.kind === 'failure') {
				return tokenResult;
			}
			this.singularityToken = { ...tokenResult };
		}
		const result: { status: 'OK' } = {
			status: 'OK',
		};
		return result;
	}
}

//#endregion

//#region SingularityTokenManagerFromDeviceId

export class SingularityTokenManagerFromDeviceId extends RefreshableSingularityTokenManager {

	constructor(
		private readonly deviceId: string,
		@ILogService logService: ILogService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IDomainService domainService: IDomainService,
		@ICAPIClientService capiClientService: ICAPIClientService,
		@IFetcherService fetcherService: IFetcherService,
		@IEnvService envService: IEnvService,
		@IConfigurationService protected readonly configurationService: IConfigurationService
	) {
		super(new NullBaseOctoKitService(capiClientService, fetcherService, logService, telemetryService), logService, telemetryService, domainService, capiClientService, fetcherService, envService);
	}

	protected async authenticateAndGetToken(): Promise<TokenInfoOrError & NotGitHubLoginFailed> {
		return this.authFromDevDeviceId(this.deviceId);
	}
}

//#endregion

//#region SingularityTokenManagerFromGitHubToken

/**
 * Given a GitHub token, return a Singularity token, refreshing it as needed.
 * The caller that initializes the object is responsible for checking telemetry consent before
 * using the object.
 */
export class SingularityTokenManagerFromGitHubToken extends RefreshableSingularityTokenManager {

	constructor(
		private readonly githubToken: string,
		private readonly githubUsername: string,
		@ILogService logService: ILogService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IDomainService domainService: IDomainService,
		@ICAPIClientService capiClientService: ICAPIClientService,
		@IFetcherService fetcherService: IFetcherService,
		@IEnvService envService: IEnvService,
		@IConfigurationService protected readonly configurationService: IConfigurationService
	) {
		super(new NullBaseOctoKitService(capiClientService, fetcherService, logService, telemetryService), logService, telemetryService, domainService, capiClientService, fetcherService, envService);
	}

	protected async authenticateAndGetToken(): Promise<TokenInfoOrError & NotGitHubLoginFailed> {
		return this.authFromGitHubToken(this.githubToken, this.githubUsername);
	}
}
