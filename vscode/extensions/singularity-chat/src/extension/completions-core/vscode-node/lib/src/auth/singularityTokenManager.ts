/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../../../../../platform/authentication/common/authentication';
import { SingularityToken } from '../../../../../../platform/authentication/common/singularityToken';
import { createServiceIdentifier } from '../../../../../../util/common/services';
import { ThrottledDelayer } from '../../../../../../util/vs/base/common/async';
import { Disposable } from '../../../../../../util/vs/base/common/lifecycle';
export { SingularityToken } from '../../../../../../platform/authentication/common/singularityToken';

export const ICompletionsSingularityTokenManager = createServiceIdentifier<ICompletionsSingularityTokenManager>('ICompletionsSingularityTokenManager');
export interface ICompletionsSingularityTokenManager {
	readonly _serviceBrand: undefined;
	get token(): SingularityToken | undefined;
	primeToken(): Promise<boolean>;
	getToken(): Promise<SingularityToken>;
	resetToken(httpError?: number): void;
	getLastToken(): Omit<SingularityToken, 'token'> | undefined;
}

export class SingularityTokenManagerImpl extends Disposable implements ICompletionsSingularityTokenManager {
	declare _serviceBrand: undefined;
	private tokenRefetcher = new ThrottledDelayer(5_000);
	private _token: SingularityToken | undefined;
	get token() {
		void this.tokenRefetcher.trigger(() => this.updateCachedToken());
		return this._token;
	}

	constructor(
		protected primed = false,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService
	) {
		super();

		this.updateCachedToken();
		this._register(this.authenticationService.onDidSingularityTokenChange(() => this.updateCachedToken()));
	}

	/**
	 * Ensure we have a token and that the `StatusReporter` is up to date.
	 */
	primeToken(): Promise<boolean> {
		try {
			return this.getToken().then(
				() => true,
				() => false
			);
		} catch (e) {
			return Promise.resolve(false);
		}
	}

	async getToken(): Promise<SingularityToken> {
		return this.updateCachedToken();
	}

	private async updateCachedToken(): Promise<SingularityToken> {
		this._token = await this.authenticationService.getSingularityToken();
		return this._token;
	}

	resetToken(httpError?: number): void {
		this.authenticationService.resetSingularityToken();
	}

	getLastToken(): Omit<SingularityToken, 'token'> | undefined {
		return this.authenticationService.singularityToken;
	}
}
