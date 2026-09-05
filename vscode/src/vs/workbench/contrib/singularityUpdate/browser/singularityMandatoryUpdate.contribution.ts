/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import severity from '../../../../base/common/severity.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { arch } from '../../../../base/common/process.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { asJson, IRequestService } from '../../../../platform/request/common/request.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IUpdateService, StateType } from '../../../../platform/update/common/update.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { URI } from '../../../../base/common/uri.js';
import { tryParseVersion } from '../../update/common/updateUtils.js';

interface ISingularityReleaseManifest {
	readonly latestVersion: string;
	readonly minSupportedVersion: string;
	readonly commit: string;
	readonly mandatory?: boolean;
	readonly releaseNotesUrl?: string;
	readonly platforms?: Readonly<Record<string, { readonly zip?: string; readonly dmg?: string }>>;
}

export const SingularityUpdateBlockedContext = 'singularityUpdateBlocked';

function compareVersions(a: string, b: string): number {
	const va = tryParseVersion(a);
	const vb = tryParseVersion(b);
	if (!va || !vb) {
		return a.localeCompare(b);
	}
	if (va.major !== vb.major) {
		return va.major - vb.major;
	}
	if (va.minor !== vb.minor) {
		return va.minor - vb.minor;
	}
	return va.patch - vb.patch;
}

function resolvePlatformKey(): string {
	if (!isMacintosh) {
		return `linux-${arch}`;
	}
	return arch === 'arm64' ? 'darwin-arm64' : 'darwin';
}

export class SingularityMandatoryUpdateContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.singularityMandatoryUpdate';

	constructor(
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService,
		@IDialogService private readonly dialogService: IDialogService,
		@IUpdateService private readonly updateService: IUpdateService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IHostService private readonly hostService: IHostService,
	) {
		super();

		if (this.environmentService.isExtensionDevelopment) {
			return;
		}

		const manifestUrl = this.productService.singularityUpdateManifestUrl;
		if (!manifestUrl) {
			return;
		}

		this.enforceMandatoryUpdate(manifestUrl).catch(err => {
			this.logService.error('[singularityUpdate] mandatory update check failed', err);
		});
	}

	private async enforceMandatoryUpdate(manifestUrl: string): Promise<void> {
		const manifest = await this.fetchManifest(manifestUrl);
		if (!manifest) {
			return;
		}

		const currentVersion = this.productService.version;
		if (compareVersions(currentVersion, manifest.minSupportedVersion) >= 0) {
			return;
		}

		this.logService.warn(`[singularityUpdate] version ${currentVersion} is below minimum ${manifest.minSupportedVersion}`);

		// Block until the user installs an update or quits.
		for (;;) {
			const updateState = this.updateService.state;
			if (updateState.type === StateType.Ready) {
				const restart = await this.dialogService.confirm({
					type: severity.Info,
					message: localize('singularityUpdate.ready', "Update ready"),
					detail: localize('singularityUpdate.readyDetail', "Singularity {0} has been downloaded. Restart now to continue.", manifest.latestVersion),
					primaryButton: localize('singularityUpdate.restartNow', "Restart now"),
				});
				if (restart.confirmed) {
					await this.updateService.quitAndInstall();
				}
				continue;
			}

			const platform = resolvePlatformKey();
			const platformAssets = manifest.platforms?.[platform] ?? manifest.platforms?.['darwin-arm64'] ?? manifest.platforms?.['darwin'];
			const manualUrl = platformAssets?.dmg ?? platformAssets?.zip;

			const detail = updateState.type === StateType.Downloading
				? localize('singularityUpdate.downloadingDetail', "Your version ({0}) is no longer supported. Minimum required: {1}. Downloading update…", currentVersion, manifest.minSupportedVersion)
				: localize('singularityUpdate.blockedDetail', "Your version ({0}) is no longer supported. Minimum required: {1}. Install the latest update to continue using Singularity.", currentVersion, manifest.minSupportedVersion);

			const buttons: { label: string; run: () => 'download' | 'manual' }[] = [
				{
					label: localize('singularityUpdate.download', "Download update"),
					run: () => 'download' as const,
				},
			];
			if (manualUrl) {
				buttons.push({
					label: localize('singularityUpdate.openDmg', "Open download page"),
					run: () => 'manual' as const,
				});
			}

			const { result } = await this.dialogService.prompt({
				type: severity.Warning,
				message: localize('singularityUpdate.required', "Update required"),
				detail,
				buttons,
				cancelButton: {
					label: localize('singularityUpdate.quit', "Quit"),
					run: () => 'quit' as const,
				},
			});

			if (result === 'download') {
				try {
					await this.updateService.checkForUpdates(true);
					if (this.updateService.state.type === StateType.AvailableForDownload) {
						await this.updateService.downloadUpdate(true);
					}
				} catch (err) {
					this.logService.warn('[singularityUpdate] in-app download failed', err);
				}
				continue;
			}

			if (result === 'manual' && manualUrl) {
				await this.openerService.open(URI.parse(manualUrl));
				continue;
			}

			if (result === 'quit') {
				await this.hostService.shutdown();
				return;
			}
		}
	}

	private async fetchManifest(url: string): Promise<ISingularityReleaseManifest | undefined> {
		try {
			const context = await this.requestService.request({
				type: 'GET',
				url,
				disableCache: true,
				timeout: 15000,
				callSite: 'singularityMandatoryUpdate.fetchManifest',
			}, CancellationToken.None);

			if (context.res.statusCode !== 200) {
				this.logService.warn(`[singularityUpdate] manifest HTTP ${context.res.statusCode}`);
				return undefined;
			}

			const manifest = await asJson<ISingularityReleaseManifest>(context);
			if (!manifest?.minSupportedVersion || !manifest.latestVersion) {
				return undefined;
			}
			return manifest;
		} catch (err) {
			this.logService.warn('[singularityUpdate] failed to fetch manifest', err);
			return undefined;
		}
	}
}

registerWorkbenchContribution2(SingularityMandatoryUpdateContribution.ID, SingularityMandatoryUpdateContribution, WorkbenchPhase.BlockStartup);
