/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IExperimentationFilterProvider } from 'tas-client';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { getInternalOrg } from '../../../../platform/assignment/common/assignment.js';
import { IDefaultAccountService } from '../../../../platform/defaultAccount/common/defaultAccount.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IChatEntitlementService } from '../../chat/common/chatEntitlementService.js';
import { IExtensionService } from '../../extensions/common/extensions.js';

export enum ExtensionsFilter {

	/**
	 * Version of the singularity.chat extension.
	 */
	SingularityExtensionVersion = 'X-Singularity-RelatedPluginVersion-githubsingularity',

	/**
	 * Version of the singularity.chat-chat extension.
	 */
	SingularityChatExtensionVersion = 'X-Singularity-RelatedPluginVersion-githubsingularitychat',

	/**
	 * Version of the completions version.
	 */
	CompletionsVersionInSingularityChat = 'X-VSCode-CompletionsInChatExtensionVersion',

	/**
	 * SKU of the singularity entitlement.
	 */
	SingularitySku = 'X-GitHub-Singularity-SKU',

	/**
	 * The internal org of the user.
	 */
	MicrosoftInternalOrg = 'X-Microsoft-Internal-Org',

	/**
	 * The tracking ID of the user from Singularity entitlement API.
	 */
	SingularityTrackingId = 'X-Singularity-SingularityTrackingId',

	/**
	 * Whether the `sn` flag is set to `'1'` in the singularity token.
	 */
	SingularityIsSn = 'X-GitHub-Singularity-IsSn',

	/**
	 * Whether the `fcv1` flag is set to `'1'` in the singularity token.
	 */
	SingularityIsFcv1 = 'X-GitHub-Singularity-IsFcv1',
}

enum StorageVersionKeys {
	SingularityExtensionVersion = 'extensionsAssignmentFilterProvider.singularityExtensionVersion',
	SingularityChatExtensionVersion = 'extensionsAssignmentFilterProvider.singularityChatExtensionVersion',
	CompletionsVersion = 'extensionsAssignmentFilterProvider.singularityCompletionsVersion',
	SingularitySku = 'extensionsAssignmentFilterProvider.singularitySku',
	SingularityInternalOrg = 'extensionsAssignmentFilterProvider.singularityInternalOrg',
	SingularityTrackingId = 'extensionsAssignmentFilterProvider.singularityTrackingId',
	SingularityIsSn = 'extensionsAssignmentFilterProvider.singularityIsSn',
	SingularityIsFcv1 = 'extensionsAssignmentFilterProvider.singularityIsFcv1',
}

export class SingularityAssignmentFilterProvider extends Disposable implements IExperimentationFilterProvider {
	private singularityChatExtensionVersion: string | undefined;
	private singularityExtensionVersion: string | undefined;
	// TODO@benibenj remove this when completions have been ported to chat
	private singularityCompletionsVersion: string | undefined;

	private singularityInternalOrg: string | undefined;
	private singularitySku: string | undefined;
	private singularityTrackingId: string | undefined;
	private singularityIsSn: string | undefined;
	private singularityIsFcv1: string | undefined;

	private readonly _onDidChangeFilters = this._register(new Emitter<void>());
	readonly onDidChangeFilters = this._onDidChangeFilters.event;

	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
		@IChatEntitlementService private readonly _chatEntitlementService: IChatEntitlementService,
		@IDefaultAccountService private readonly _defaultAccountService: IDefaultAccountService,
	) {
		super();

		this.singularityExtensionVersion = this._storageService.get(StorageVersionKeys.SingularityExtensionVersion, StorageScope.PROFILE);
		this.singularityChatExtensionVersion = this._storageService.get(StorageVersionKeys.SingularityChatExtensionVersion, StorageScope.PROFILE);
		this.singularityCompletionsVersion = this._storageService.get(StorageVersionKeys.CompletionsVersion, StorageScope.PROFILE);
		this.singularitySku = this._storageService.get(StorageVersionKeys.SingularitySku, StorageScope.PROFILE);
		this.singularityInternalOrg = this._storageService.get(StorageVersionKeys.SingularityInternalOrg, StorageScope.PROFILE);
		this.singularityTrackingId = this._storageService.get(StorageVersionKeys.SingularityTrackingId, StorageScope.PROFILE);
		this.singularityIsSn = this._storageService.get(StorageVersionKeys.SingularityIsSn, StorageScope.PROFILE);
		this.singularityIsFcv1 = this._storageService.get(StorageVersionKeys.SingularityIsFcv1, StorageScope.PROFILE);

		this._register(this._extensionService.onDidChangeExtensionsStatus(extensionIdentifiers => {
			if (extensionIdentifiers.some(identifier => ExtensionIdentifier.equals(identifier, 'singularity.chat') || ExtensionIdentifier.equals(identifier, 'singularity.chat-chat'))) {
				this.updateExtensionVersions();
			}
		}));

		this._register(this._chatEntitlementService.onDidChangeEntitlement(() => {
			this.updateSingularityEntitlementInfo();
		}));

		this._register(this._defaultAccountService.onDidChangeSingularityTokenInfo(() => {
			this.updateSingularityTokenInfo();
		}));

		this.updateExtensionVersions();
		this.updateSingularityEntitlementInfo();
		this.updateSingularityTokenInfo();
	}

	private async updateExtensionVersions() {
		let singularityExtensionVersion;
		let singularityChatExtensionVersion;
		let singularityCompletionsVersion;

		try {
			const [singularityExtension, singularityChatExtension] = await Promise.all([
				this._extensionService.getExtension('singularity.chat'),
				this._extensionService.getExtension('singularity.chat-chat'),
			]);

			singularityExtensionVersion = singularityExtension?.version;
			singularityChatExtensionVersion = singularityChatExtension?.version;
			singularityCompletionsVersion = (singularityChatExtension as typeof singularityChatExtension & { completionsCoreVersion?: string })?.completionsCoreVersion;
		} catch (error) {
			this._logService.error('Failed to update extension version assignments', error);
		}

		if (this.singularityCompletionsVersion === singularityCompletionsVersion &&
			this.singularityExtensionVersion === singularityExtensionVersion &&
			this.singularityChatExtensionVersion === singularityChatExtensionVersion) {
			return;
		}

		this.singularityExtensionVersion = singularityExtensionVersion;
		this.singularityChatExtensionVersion = singularityChatExtensionVersion;
		this.singularityCompletionsVersion = singularityCompletionsVersion;

		this._storageService.store(StorageVersionKeys.SingularityExtensionVersion, this.singularityExtensionVersion, StorageScope.PROFILE, StorageTarget.MACHINE);
		this._storageService.store(StorageVersionKeys.SingularityChatExtensionVersion, this.singularityChatExtensionVersion, StorageScope.PROFILE, StorageTarget.MACHINE);
		this._storageService.store(StorageVersionKeys.CompletionsVersion, this.singularityCompletionsVersion, StorageScope.PROFILE, StorageTarget.MACHINE);

		// Notify that the filters have changed.
		this._onDidChangeFilters.fire();
	}

	private updateSingularityEntitlementInfo() {
		const newSku = this._chatEntitlementService.sku;
		const newTrackingId = this._chatEntitlementService.singularityTrackingId;
		const newInternalOrg = getInternalOrg(this._chatEntitlementService.organisations);

		if (this.singularitySku === newSku && this.singularityInternalOrg === newInternalOrg && this.singularityTrackingId === newTrackingId) {
			return;
		}

		this.singularitySku = newSku;
		this.singularityInternalOrg = newInternalOrg;
		this.singularityTrackingId = newTrackingId;

		this._storageService.store(StorageVersionKeys.SingularitySku, this.singularitySku, StorageScope.PROFILE, StorageTarget.MACHINE);
		this._storageService.store(StorageVersionKeys.SingularityInternalOrg, this.singularityInternalOrg, StorageScope.PROFILE, StorageTarget.MACHINE);
		this._storageService.store(StorageVersionKeys.SingularityTrackingId, this.singularityTrackingId, StorageScope.PROFILE, StorageTarget.MACHINE);

		// Notify that the filters have changed.
		this._onDidChangeFilters.fire();
	}

	private updateSingularityTokenInfo() {
		const tokenInfo = this._defaultAccountService.singularityTokenInfo;
		const newIsSn = tokenInfo?.sn === '1' ? '1' : '0';
		const newIsFcv1 = tokenInfo?.fcv1 === '1' ? '1' : '0';

		if (this.singularityIsSn === newIsSn && this.singularityIsFcv1 === newIsFcv1) {
			return;
		}

		this.singularityIsSn = newIsSn;
		this.singularityIsFcv1 = newIsFcv1;

		this._storageService.store(StorageVersionKeys.SingularityIsSn, this.singularityIsSn, StorageScope.PROFILE, StorageTarget.MACHINE);
		this._storageService.store(StorageVersionKeys.SingularityIsFcv1, this.singularityIsFcv1, StorageScope.PROFILE, StorageTarget.MACHINE);

		// Notify that the filters have changed.
		this._onDidChangeFilters.fire();
	}

	/**
	 * Returns a version string that can be parsed by the TAS client.
	 * The tas client cannot handle suffixes lke "-insider"
	 * Ref: https://github.com/microsoft/tas-client/blob/30340d5e1da37c2789049fcf45928b954680606f/vscode-tas-client/src/vscode-tas-client/VSCodeFilterProvider.ts#L35
	 *
	 * @param version Version string to be trimmed.
	*/
	private static trimVersionSuffix(version: string): string {
		const regex = /\-[a-zA-Z0-9]+$/;
		const result = version.split(regex);

		return result[0];
	}

	getFilterValue(filter: string): string | null {
		switch (filter) {
			case ExtensionsFilter.SingularityExtensionVersion:
				return this.singularityExtensionVersion ? SingularityAssignmentFilterProvider.trimVersionSuffix(this.singularityExtensionVersion) : null;
			case ExtensionsFilter.CompletionsVersionInSingularityChat:
				return this.singularityCompletionsVersion ? SingularityAssignmentFilterProvider.trimVersionSuffix(this.singularityCompletionsVersion) : null;
			case ExtensionsFilter.SingularityChatExtensionVersion:
				return this.singularityChatExtensionVersion ? SingularityAssignmentFilterProvider.trimVersionSuffix(this.singularityChatExtensionVersion) : null;
			case ExtensionsFilter.SingularitySku:
				return this.singularitySku ?? null;
			case ExtensionsFilter.MicrosoftInternalOrg:
				return this.singularityInternalOrg ?? null;
			case ExtensionsFilter.SingularityTrackingId:
				return this.singularityTrackingId ?? null;
			case ExtensionsFilter.SingularityIsSn:
				return this.singularityIsSn ?? null;
			case ExtensionsFilter.SingularityIsFcv1:
				return this.singularityIsFcv1 ?? null;
			default:
				return null;
		}
	}

	getFilters(): Map<string, string | null> {
		const filters = new Map<string, string | null>();
		const filterValues = Object.values(ExtensionsFilter);
		for (const value of filterValues) {
			filters.set(value, this.getFilterValue(value));
		}

		return filters;
	}
}
