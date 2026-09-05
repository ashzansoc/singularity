/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../../../../../platform/authentication/common/authentication';
import { SingularityToken } from '../../../../../../platform/authentication/common/singularityToken';

export function onSingularityToken(authService: IAuthenticationService, listener: (token: Omit<SingularityToken, 'token'>) => unknown) {
	return authService.onDidSingularityTokenChange(() => {
		const singularityToken = authService.singularityToken;
		if (singularityToken) {
			listener(singularityToken);
		}
	});
}
