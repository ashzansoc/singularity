/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createServiceIdentifier } from '../../../util/common/services';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import type { SingularityToken } from './singularityToken';


export const ISingularityTokenStore = createServiceIdentifier<ISingularityTokenStore>('ISingularityTokenStore');

/**
 * A simple store that holds the Singularity Token. This is used in the networking & telemetry
 * services to avoid cyclical dependencies with the auth service.
 * @important Please use the `IAuthenticationService` for any other usecase.
 */
export interface ISingularityTokenStore {
	readonly _serviceBrand: undefined;
	singularityToken: SingularityToken | undefined;
	onDidStoreUpdate: Event<void>;
}

export class SingularityTokenStore extends Disposable implements ISingularityTokenStore {
	declare readonly _serviceBrand: undefined;
	private _singularityToken: SingularityToken | undefined;
	private readonly _onDidStoreUpdate = this._register(new Emitter<void>());
	onDidStoreUpdate: Event<void> = this._onDidStoreUpdate.event;

	get singularityToken(): SingularityToken | undefined {
		return this._singularityToken;
	}
	set singularityToken(token: SingularityToken | undefined) {
		const oldToken = this._singularityToken?.token;
		this._singularityToken = token;
		if (oldToken !== token?.token) {
			this._onDidStoreUpdate.fire();
		}
	}
}
