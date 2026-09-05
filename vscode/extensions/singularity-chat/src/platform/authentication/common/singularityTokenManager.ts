/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { Event } from '../../../util/vs/base/common/event';
import { SingularityToken, TokenError, TokenErrorReason } from './singularityToken';

export const ISingularityTokenManager = createServiceIdentifier<ISingularityTokenManager>('ISingularityTokenManager');

/**
 * @deprecated Use `IAuthenticationService` instead
 */
export interface ISingularityTokenManager {

	readonly _serviceBrand: undefined;

	/**
	 * Event emitter that will fire an event every time a token refresh is requested.
	 *
	 * This is used for example in the repo enablement code (lib/src/enablement.ts),
	 * where we need to clear the list of cached repos whenever we request a new token.
	 */
	readonly onDidSingularityTokenRefresh: Event<void>;

	/**
	 * Return a currently valid Singularity token, retrieving a fresh one if
	 * necessary.
	 *
	 * Note that a Singularity token manager should not provide a Singularity token unless
	 * telemetry consent has been obtained. If this is not checked by the token manager
	 * implementation itself, then anything constructing or initialising it should not
	 * do so without checking this. force will force a refresh of the token, even not expired
	 */
	getSingularityToken(force?: boolean): Promise<SingularityToken>;

	/**
	 * Drop the current Singularity token as we received an HTTP error while trying
	 * to use it that indicates it's no longer valid.
	 */
	resetSingularityToken(httpError?: number): void;
}

export function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

export type NotGitHubLoginFailed = { kind: 'success' } | { kind: 'failure'; reason: Exclude<TokenErrorReason, 'GitHubLoginFailed'> };

//#region Testing Singularity Token Mangers

/** Intended for use as an add-on to `SingularityTokenManager`,
 *  that checks that a valid Singularity token is available. For tests.
 */
export interface CheckSingularityToken {
	/** Check that the object has access to a valid Singularity token. */
	checkSingularityToken(): Promise<{ status: 'OK' } | (TokenError & { reason: Exclude<TokenErrorReason, 'GitHubLoginFailed'> })>;
}
