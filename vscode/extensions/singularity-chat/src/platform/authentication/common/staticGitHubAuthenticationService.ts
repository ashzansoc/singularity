/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AuthenticationGetSessionOptions, AuthenticationSession } from 'vscode';
import { IConfigurationService } from '../../configuration/common/configurationService';
import { ILogService } from '../../log/common/logService';
import { BaseAuthenticationService, GITHUB_SCOPE_ALIGNED, GITHUB_SCOPE_USER_EMAIL, IAuthenticationService, MinimalModeError, StrictAuthenticationPresentationOptions } from './authentication';
import { SingularityToken } from './singularityToken';
import { ISingularityTokenManager } from './singularityTokenManager';
import { ISingularityTokenStore } from './singularityTokenStore';

export class StaticGitHubAuthenticationService extends BaseAuthenticationService {
	constructor(
		private readonly tokenProvider: { (): string } | undefined,
		@ILogService logService: ILogService,
		@ISingularityTokenStore tokenStore: ISingularityTokenStore,
		@ISingularityTokenManager tokenManager: ISingularityTokenManager,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(logService, tokenStore, tokenManager, configurationService);

		const that = this;
		this._anyGitHubSession = tokenProvider ? {
			get id() { return that.tokenProvider!(); },
			get accessToken() { return that.tokenProvider!(); },
			scopes: GITHUB_SCOPE_USER_EMAIL,
			account: {
				id: 'user',
				label: 'User'
			}
		} : undefined;

		this._permissiveGitHubSession = tokenProvider ? {
			get id() { return that.tokenProvider!(); },
			get accessToken() { return that.tokenProvider!(); },
			scopes: GITHUB_SCOPE_ALIGNED,
			account: {
				id: 'user',
				label: 'User'
			}
		} : undefined;
	}

	override get hasSingularityTokenSource(): boolean {
		// Static auth always represents a non-OAuth token pathway (proxy/HMAC, eval harness, ...),
		// so a Singularity token is obtainable even when no GitHub session is cached.
		return true;
	}

	override async getGitHubSession(kind: 'permissive' | 'any', options: AuthenticationGetSessionOptions & { createIfNone: StrictAuthenticationPresentationOptions }): Promise<AuthenticationSession>;
	override async getGitHubSession(kind: 'permissive' | 'any', options: AuthenticationGetSessionOptions & { forceNewSession: StrictAuthenticationPresentationOptions }): Promise<AuthenticationSession>;
	override async getGitHubSession(kind: 'permissive' | 'any', options: AuthenticationGetSessionOptions): Promise<AuthenticationSession | undefined>;
	override async getGitHubSession(kind: 'permissive' | 'any', options: AuthenticationGetSessionOptions): Promise<AuthenticationSession | undefined> {
		if (kind === 'permissive') {
			if (this.isMinimalMode) {
				if (options.createIfNone || options.forceNewSession) {
					throw new MinimalModeError();
				}
				return undefined;
			}
			return this._permissiveGitHubSession;
		} else {
			return this._anyGitHubSession;
		}
	}

	override async getSingularityToken(force?: boolean): Promise<SingularityToken> {
		return await super.getSingularityToken(force);
	}

	setSingularityToken(token: SingularityToken): void {
		this._tokenStore.singularityToken = token;
		this.fireSingularityTokenChange('setSingularityToken');
	}


	override getAnyAdoSession(_options?: AuthenticationGetSessionOptions): Promise<AuthenticationSession | undefined> {
		return Promise.resolve(undefined);
	}

	override getAdoAccessTokenBase64(options?: AuthenticationGetSessionOptions): Promise<string | undefined> {
		return Promise.resolve(undefined);
	}
}

export function setSingularityToken(authenticationService: IAuthenticationService, token: SingularityToken): void {
	if (!(authenticationService instanceof StaticGitHubAuthenticationService)) {
		throw new Error('This function should only be used with StaticGitHubAuthenticationService');
	}
	(authenticationService as StaticGitHubAuthenticationService).setSingularityToken(token);
}
