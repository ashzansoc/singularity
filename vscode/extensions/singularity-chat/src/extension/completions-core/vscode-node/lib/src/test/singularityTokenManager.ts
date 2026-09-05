/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SingularityToken, createTestExtendedTokenInfo, type ExtendedTokenInfo } from '../../../../../../platform/authentication/common/singularityToken';
import { ICompletionsSingularityTokenManager } from '../auth/singularityTokenManager';

// Buffer to allow refresh to happen successfully
export class FakeSingularityTokenManager implements ICompletionsSingularityTokenManager {
	declare _serviceBrand: undefined;
	private _token: SingularityToken;

	constructor() {
		this._token = FakeSingularityTokenManager.createTestSingularityToken({ token: 'tid=test;rt=1' });
	}

	get token(): SingularityToken | undefined {
		return this._token;
	}

	primeToken(): Promise<boolean> {
		return Promise.resolve(true);
	}

	async getToken(): Promise<SingularityToken> {
		return this._token;
	}

	resetToken(httpError?: number): void {
	}

	getLastToken(): Omit<SingularityToken, 'token'> | undefined {
		return this._token;
	}

	private static readonly REFRESH_BUFFER_SECONDS = 60;
	private static createTestSingularityToken(overrides?: Partial<Omit<ExtendedTokenInfo, 'expires_at'>>): SingularityToken {
		const expires_at = Date.now() + ((overrides?.refresh_in ?? 0) + FakeSingularityTokenManager.REFRESH_BUFFER_SECONDS) * 1000;
		return new SingularityToken(createTestExtendedTokenInfo({ expires_at, ...overrides }));
	}
}
