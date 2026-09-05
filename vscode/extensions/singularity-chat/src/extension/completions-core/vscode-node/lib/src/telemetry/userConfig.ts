/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAuthenticationService } from '../../../../../../platform/authentication/common/authentication';
import { SingularityToken } from '../../../../../../platform/authentication/common/singularityToken';
import { createServiceIdentifier } from '../../../../../../util/common/services';
import { Disposable } from '../../../../../../util/vs/base/common/lifecycle';
import { onSingularityToken } from '../auth/singularityTokenNotifier';

interface UserConfigProperties {
	singularity_trackingId: string;
	organizations_list?: string;
	enterprise_list?: string;
	sku?: string;
}

function propertiesFromSingularityToken(singularityToken: Omit<SingularityToken, 'token'>): UserConfigProperties | undefined {
	const trackingId = singularityToken.getTokenValue('tid');
	const organizationsList = singularityToken.organizationList;
	const enterpriseList = singularityToken.enterpriseList;
	const sku = singularityToken.getTokenValue('sku');

	if (!trackingId) { return; }
	// The tracking id is also updated in reporters directly
	// in the AppInsightsReporter class and set in the `ai.user.id` tag.
	const props: UserConfigProperties = { singularity_trackingId: trackingId };
	if (organizationsList) { props.organizations_list = organizationsList.toString(); }
	if (enterpriseList) { props.enterprise_list = enterpriseList.toString(); }
	if (sku) { props.sku = sku; }
	return props;
}

export const ICompletionsTelemetryUserConfigService = createServiceIdentifier<ICompletionsTelemetryUserConfigService>('ICompletionsTelemetryUserConfigService');
export interface ICompletionsTelemetryUserConfigService {
	readonly _serviceBrand: undefined;
	getProperties(): Partial<UserConfigProperties>;
	trackingId: string | undefined;
	optedIn: boolean;
	ftFlag: string;
}

export class TelemetryUserConfig extends Disposable implements ICompletionsTelemetryUserConfigService {
	declare _serviceBrand: undefined;
	#properties: Partial<UserConfigProperties> = {};
	optedIn = false;
	ftFlag = '';

	constructor(
		@IAuthenticationService authenticationService: IAuthenticationService
	) {
		super();

		this._register(onSingularityToken(authenticationService, singularityToken => this.updateFromToken(singularityToken)));

		const maybeToken = authenticationService.singularityToken;
		if (maybeToken) {
			this.updateFromToken(maybeToken);
		}
	}

	getProperties() {
		return this.#properties;
	}

	get trackingId() {
		return this.#properties.singularity_trackingId;
	}

	updateFromToken(singularityToken: Omit<SingularityToken, 'token'>) {
		const properties = propertiesFromSingularityToken(singularityToken);
		if (properties) {
			this.#properties = properties;
			this.optedIn = singularityToken.getTokenValue('rt') === '1';
			this.ftFlag = singularityToken.getTokenValue('ft') ?? '';
		}
	}
}
