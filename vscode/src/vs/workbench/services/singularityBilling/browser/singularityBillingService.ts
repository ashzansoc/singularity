/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IDefaultAccount } from '../../../../base/common/defaultAccount.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ISingularityBillingService, ISingularityBillingSnapshot, SINGULARITY_GST_RATE, SINGULARITY_MONTHLY_USD, SINGULARITY_TRIAL_DAYS } from '../common/singularityBilling.js';

const STORE_KEY = 'singularity.billing.accounts.v1';
const SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1000;

interface IAccountBillingRecord {
	readonly firstSeenAt: number;
	readonly subscribedUntil?: number;
}

interface IBillingStore {
	readonly accounts: Record<string, IAccountBillingRecord>;
}

export class SingularityBillingService extends Disposable implements ISingularityBillingService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private snapshot: ISingularityBillingSnapshot = restoringSnapshot();

	constructor(
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this.snapshot = restoringSnapshot();
		this._register(this.defaultAccountService.onDidChangeDefaultAccount(account => this.refresh(account ?? undefined)));
		void this.defaultAccountService.getDefaultAccount().then(account => {
			this.refresh(account ?? undefined);
		});
	}

	getSnapshot(): ISingularityBillingSnapshot {
		return this.snapshot;
	}

	async activateSubscription(): Promise<void> {
		const login = this.snapshot.githubLogin;
		if (!login) {
			return;
		}
		const store = this.readStore();
		const existing = store.accounts[login] ?? { firstSeenAt: Date.now() };
		store.accounts[login] = {
			...existing,
			subscribedUntil: Date.now() + SUBSCRIPTION_MS,
		};
		this.writeStore(store);
		this.refresh(this.defaultAccountService.currentDefaultAccount ?? undefined);
	}

	private refresh(account: IDefaultAccount | undefined): void {
		if (!account?.accountName) {
			this.snapshot = unsignedSnapshot();
			this._onDidChange.fire();
			return;
		}

		const login = account.accountName;
		const store = this.readStore();
		let record = store.accounts[login];
		if (!record) {
			record = { firstSeenAt: Date.now() };
			store.accounts[login] = record;
			this.writeStore(store);
		}

		const now = Date.now();
		const trialEndsAt = record.firstSeenAt + SINGULARITY_TRIAL_DAYS * 24 * 60 * 60 * 1000;
		const trialDaysRemaining = Math.max(0, Math.ceil((trialEndsAt - now) / (24 * 60 * 60 * 1000)));
		const subscribed = typeof record.subscribedUntil === 'number' && record.subscribedUntil > now;
		const kind = subscribed ? 'subscribed' : (now < trialEndsAt ? 'trial' : 'expired');

		this.snapshot = {
			kind,
			githubLogin: login,
			displayName: account.accountName,
			alias: aliasFromLogin(login),
			avatarUrl: `https://github.com/${encodeURIComponent(login)}.png?size=128`,
			trialDaysRemaining: subscribed ? SINGULARITY_TRIAL_DAYS : trialDaysRemaining,
			trialDaysTotal: SINGULARITY_TRIAL_DAYS,
			trialEndsAt,
			subscribedUntil: record.subscribedUntil,
			monthlyUsd: SINGULARITY_MONTHLY_USD,
			gstRate: SINGULARITY_GST_RATE,
			monthlyTotalUsd: Math.round(SINGULARITY_MONTHLY_USD * (1 + SINGULARITY_GST_RATE) * 100) / 100,
			canUseProduct: kind === 'trial' || kind === 'subscribed',
		};
		this._onDidChange.fire();
	}

	private readStore(): IBillingStore {
		try {
			const raw = this.storageService.get(STORE_KEY, StorageScope.APPLICATION);
			if (!raw) {
				return { accounts: {} };
			}
			const parsed = JSON.parse(raw) as IBillingStore;
			return parsed?.accounts ? parsed : { accounts: {} };
		} catch {
			return { accounts: {} };
		}
	}

	private writeStore(store: IBillingStore): void {
		this.storageService.store(STORE_KEY, JSON.stringify(store), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}

function restoringSnapshot(): ISingularityBillingSnapshot {
	return {
		kind: 'restoring',
		githubLogin: undefined,
		displayName: undefined,
		alias: '…',
		avatarUrl: undefined,
		trialDaysRemaining: 0,
		trialDaysTotal: SINGULARITY_TRIAL_DAYS,
		trialEndsAt: undefined,
		subscribedUntil: undefined,
		monthlyUsd: SINGULARITY_MONTHLY_USD,
		gstRate: SINGULARITY_GST_RATE,
		monthlyTotalUsd: Math.round(SINGULARITY_MONTHLY_USD * (1 + SINGULARITY_GST_RATE) * 100) / 100,
		canUseProduct: false,
	};
}

function unsignedSnapshot(): ISingularityBillingSnapshot {
	return {
		kind: 'signedOut',
		githubLogin: undefined,
		displayName: undefined,
		alias: '?',
		avatarUrl: undefined,
		trialDaysRemaining: 0,
		trialDaysTotal: SINGULARITY_TRIAL_DAYS,
		trialEndsAt: undefined,
		subscribedUntil: undefined,
		monthlyUsd: SINGULARITY_MONTHLY_USD,
		gstRate: SINGULARITY_GST_RATE,
		monthlyTotalUsd: Math.round(SINGULARITY_MONTHLY_USD * (1 + SINGULARITY_GST_RATE) * 100) / 100,
		canUseProduct: false,
	};
}

function aliasFromLogin(login: string): string {
	const cleaned = login.replace(/[^a-zA-Z0-9]/g, '');
	if (cleaned.length >= 2) {
		return cleaned.slice(0, 2).toUpperCase();
	}
	return (cleaned || login || '?').slice(0, 1).toUpperCase();
}

registerSingleton(ISingularityBillingService, SingularityBillingService, InstantiationType.Eager);
