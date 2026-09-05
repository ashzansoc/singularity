/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const SINGULARITY_TRIAL_DAYS = 7;
export const SINGULARITY_MONTHLY_USD = 10;
export const SINGULARITY_GST_RATE = 0.18;

export type SingularityAccessKind = 'restoring' | 'signedOut' | 'trial' | 'subscribed' | 'expired';

export interface ISingularityBillingSnapshot {
	readonly kind: SingularityAccessKind;
	readonly githubLogin: string | undefined;
	readonly displayName: string | undefined;
	readonly alias: string;
	readonly avatarUrl: string | undefined;
	readonly trialDaysRemaining: number;
	readonly trialDaysTotal: typeof SINGULARITY_TRIAL_DAYS;
	readonly trialEndsAt: number | undefined;
	readonly subscribedUntil: number | undefined;
	readonly monthlyUsd: typeof SINGULARITY_MONTHLY_USD;
	readonly gstRate: typeof SINGULARITY_GST_RATE;
	readonly monthlyTotalUsd: number;
	readonly canUseProduct: boolean;
}

export const ISingularityBillingService = createDecorator<ISingularityBillingService>('singularityBillingService');

export const OPEN_SINGULARITY_PROFILE_COMMAND_ID = 'workbench.action.singularity.openProfile';

export interface ISingularityBillingService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	getSnapshot(): ISingularityBillingSnapshot;
	activateSubscription(): Promise<void>;
}
