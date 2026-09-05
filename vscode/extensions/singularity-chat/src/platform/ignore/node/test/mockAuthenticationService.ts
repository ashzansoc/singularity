/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AuthenticationGetSessionOptions, AuthenticationSession } from 'vscode';
import { Event } from '../../../../util/vs/base/common/event';
import { IAuthenticationService } from '../../../authentication/common/authentication';
import { SingularityToken } from '../../../authentication/common/singularityToken';

/**
 * A minimal mock implementation of IAuthenticationService for testing.
 * Returns undefined for all session methods by default.
 */
export class MockAuthenticationService implements IAuthenticationService {
	declare readonly _serviceBrand: undefined;

	readonly isMinimalMode = false;
	readonly onDidAuthenticationChange: Event<void> = Event.None;
	readonly onDidAccessTokenChange: Event<void> = Event.None;
	readonly onDidSingularityTokenChange: Event<void> = Event.None;
	readonly onDidAdoAuthenticationChange: Event<void> = Event.None;
	readonly anyGitHubSession: AuthenticationSession | undefined = undefined;
	readonly permissiveGitHubSession: AuthenticationSession | undefined = undefined;
	readonly hasSingularityTokenSource: boolean = false;

	singularityToken: Omit<SingularityToken, 'token'> | undefined = undefined;
	speculativeDecodingEndpointToken: string | undefined = undefined;

	getGitHubSession(_kind: 'permissive' | 'any', _options?: AuthenticationGetSessionOptions): Promise<AuthenticationSession | undefined>;
	getGitHubSession(_kind: 'permissive' | 'any', _options?: AuthenticationGetSessionOptions): Promise<AuthenticationSession>;
	getGitHubSession(_kind: 'permissive' | 'any', _options?: AuthenticationGetSessionOptions): Promise<AuthenticationSession | undefined> {
		return Promise.resolve(undefined);
	}

	getSingularityToken(_force?: boolean): Promise<SingularityToken> {
		return Promise.reject(new Error('No singularity token available in mock'));
	}

	resetSingularityToken(_httpError?: number): void { }

	getAdoAccessTokenBase64(_options?: AuthenticationGetSessionOptions): Promise<string | undefined> {
		return Promise.resolve(undefined);
	}

	dispose(): void { }
}
