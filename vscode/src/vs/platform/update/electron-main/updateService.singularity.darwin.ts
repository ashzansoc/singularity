/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { app } from 'electron';
import { chmodSync, mkdirSync, writeFileSync } from 'fs';
import { mkdir, unlink as unlinkAsync } from 'fs/promises';
import { dirname, join } from 'path';
import { arch } from 'process';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService, IRelaunchHandler, IRelaunchOptions } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { StorageScope, StorageTarget } from '../../storage/common/storage.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { AbstractUpdateService, IUpdateURLOptions } from './abstractUpdateService.js';

interface ISingularityReleaseManifest {
	readonly latestVersion: string;
	readonly minSupportedVersion: string;
	readonly commit?: string;
	readonly platforms?: Readonly<Record<string, {
		readonly zip?: string;
		readonly dmg?: string;
		readonly patch?: ISingularityPatchAsset;
	}>>;
}

interface ISingularityPatchAsset {
	readonly fromVersion: string;
	readonly url: string;
	readonly size?: number;
	readonly sha256?: string;
	readonly fileCount?: number;
}

const PENDING_ZIP_STORAGE_KEY = 'singularityUpdate/pendingZip';
const PENDING_VERSION_STORAGE_KEY = 'singularityUpdate/pendingVersion';
const PENDING_UPDATE_MODE_KEY = 'singularityUpdate/pendingMode';

function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(part => parseInt(part, 10) || 0);
	const pb = b.split('.').map(part => parseInt(part, 10) || 0);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const da = pa[i] ?? 0;
		const db = pb[i] ?? 0;
		if (da !== db) {
			return da - db;
		}
	}
	return 0;
}

function resolvePlatformKey(): string {
	if (!isMacintosh) {
		return `linux-${arch}`;
	}
	return arch === 'arm64' ? 'darwin-arm64' : 'darwin';
}

function getMacAppBundlePath(): string {
	let current = dirname(app.getPath('exe'));
	while (current && !current.endsWith('.app')) {
		const parent = dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	if (!current.endsWith('.app')) {
		throw new Error(`Could not resolve .app bundle from ${app.getPath('exe')}`);
	}
	return current;
}

/**
 * In-app updater for Singularity macOS builds that are ad-hoc signed.
 * Electron's autoUpdater requires a Developer ID; this service downloads the
 * release zip from the OTA manifest and applies it on restart (including
 * stripping the quarantine xattr).
 */
export class SingularityDarwinUpdateService extends AbstractUpdateService implements IRelaunchHandler {

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, false);
		lifecycleMainService.setRelaunchHandler(this);
	}

	handleRelaunch(options?: IRelaunchOptions): boolean {
		if (options?.addArgs || options?.removeArgs) {
			return false;
		}
		if (this.state.type !== StateType.Ready) {
			return false;
		}
		this.doQuitAndInstall();
		return true;
	}

	protected override buildUpdateFeedUrl(_quality: string, _commit: string, _options?: IUpdateURLOptions): string | undefined {
		return this.productService.singularityUpdateManifestUrl;
	}

	protected override doCheckForUpdates(explicit: boolean, _pendingCommit?: string): void {
		if (!this.quality) {
			return;
		}
		this.setState(State.CheckingForUpdates(explicit));
		void this.checkAndDownload(explicit);
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		await this.downloadAndStage(state.update, true);
	}

	protected override doQuitAndInstall(): void {
		const zipPath = this.applicationStorageMainService.get(PENDING_ZIP_STORAGE_KEY, StorageScope.APPLICATION) as string | undefined;
		if (!zipPath) {
			this.logService.error('[singularityUpdate] quitAndInstall: no pending zip');
			return;
		}

		let appPath: string;
		try {
			appPath = getMacAppBundlePath();
		} catch (err) {
			this.logService.error('[singularityUpdate] quitAndInstall: could not resolve app bundle', err);
			return;
		}

		const updateMode = this.applicationStorageMainService.get(PENDING_UPDATE_MODE_KEY, StorageScope.APPLICATION) as string | undefined ?? 'full';
		const logPath = join(this.environmentMainService.userDataPath, 'logs', 'singularity-update-apply.log');
		const scriptPath = join(this.environmentMainService.userDataPath, 'CachedData', 'singularity-apply-update.sh');
		const script = updateMode === 'patch' ? `#!/bin/bash
set -euo pipefail
APP="$1"
ZIP="$2"
LOG="$3"
TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Applying incremental patch from $ZIP to $APP" >> "$LOG"
ditto -x -k "$ZIP" "$TMP" 2>>"$LOG" || unzip -q -o "$ZIP" -d "$TMP" 2>>"$LOG"
PATCH_ROOT=$(find "$TMP" -name "*.app" -maxdepth 2 | head -1)
if [[ -z "$PATCH_ROOT" ]]; then
  echo "No .app bundle found inside patch zip" >> "$LOG"
  exit 1
fi
xattr -cr "$PATCH_ROOT" 2>>"$LOG" || true
ditto "$PATCH_ROOT" "$APP" 2>>"$LOG"
xattr -cr "$APP" 2>>"$LOG" || true
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Patch applied, reopening" >> "$LOG"
open "$APP"
` : `#!/bin/bash
set -euo pipefail
APP="$1"
ZIP="$2"
LOG="$3"
TMP=$(mktemp -d)
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Applying full update from $ZIP to $APP" >> "$LOG"
ditto -x -k "$ZIP" "$TMP" 2>>"$LOG" || unzip -q -o "$ZIP" -d "$TMP" 2>>"$LOG"
NEW_APP=$(find "$TMP" -name "*.app" -maxdepth 2 | head -1)
if [[ -z "$NEW_APP" ]]; then
  echo "No .app bundle found inside update zip" >> "$LOG"
  exit 1
fi
xattr -cr "$NEW_APP" 2>>"$LOG" || true
ditto "$NEW_APP" "$APP" 2>>"$LOG"
xattr -cr "$APP" 2>>"$LOG" || true
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Update applied, reopening" >> "$LOG"
open "$APP"
`;

		try {
			mkdirSync(dirname(scriptPath), { recursive: true });
			writeFileSync(scriptPath, script, { mode: 0o755 });
			chmodSync(scriptPath, 0o755);
		} catch (err) {
			this.logService.error('[singularityUpdate] failed to write apply script', err);
			return;
		}

		const child = spawn('/bin/bash', [scriptPath, appPath, zipPath, logPath], {
			detached: true,
			stdio: 'ignore',
		});
		child.unref();
		this.logService.info(`[singularityUpdate] spawned apply script (app=${appPath}, zip=${zipPath})`);
	}

	protected override async postInitialize(): Promise<void> {
		const zipPath = this.applicationStorageMainService.get(PENDING_ZIP_STORAGE_KEY, StorageScope.APPLICATION) as string | undefined;
		const pendingVersion = this.applicationStorageMainService.get(PENDING_VERSION_STORAGE_KEY, StorageScope.APPLICATION) as string | undefined;
		if (zipPath && pendingVersion && compareVersions(pendingVersion, this.productService.version) > 0) {
			const update: IUpdate = { version: pendingVersion, productVersion: pendingVersion, url: zipPath };
			this.setState(State.Ready(update, false, false));
		}
	}

	protected override async cancelPendingUpdate(): Promise<void> {
		const zipPath = this.applicationStorageMainService.get(PENDING_ZIP_STORAGE_KEY, StorageScope.APPLICATION) as string | undefined;
		if (zipPath) {
			await unlinkAsync(zipPath).catch(() => undefined);
		}
		this.applicationStorageMainService.remove(PENDING_ZIP_STORAGE_KEY, StorageScope.APPLICATION);
		this.applicationStorageMainService.remove(PENDING_VERSION_STORAGE_KEY, StorageScope.APPLICATION);
		this.applicationStorageMainService.remove(PENDING_UPDATE_MODE_KEY, StorageScope.APPLICATION);
	}

	private resolveUpdateAsset(manifest: ISingularityReleaseManifest): { url: string; mode: 'patch' | 'full'; fileCount?: number } | undefined {
		const platform = resolvePlatformKey();
		const assets = manifest.platforms?.[platform] ?? manifest.platforms?.['darwin-arm64'] ?? manifest.platforms?.['darwin'];
		if (!assets) {
			return undefined;
		}

		const patch = assets.patch;
		if (patch?.url && patch.fromVersion && compareVersions(this.productService.version, patch.fromVersion) === 0) {
			this.logService.info(`[singularityUpdate] using incremental patch ${patch.fromVersion} → ${manifest.latestVersion} (${patch.fileCount ?? '?'} files)`);
			return { url: patch.url, mode: 'patch', fileCount: patch.fileCount };
		}

		if (assets.zip) {
			if (patch?.url) {
				this.logService.info(`[singularityUpdate] no applicable patch (installed ${this.productService.version}, patch from ${patch.fromVersion}) — using full zip`);
			}
			return { url: assets.zip, mode: 'full' };
		}

		return undefined;
	}

	private async checkAndDownload(explicit: boolean): Promise<void> {
		try {
			const manifest = await this.fetchManifest();
			if (!manifest) {
				this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
				return;
			}

			if (compareVersions(manifest.latestVersion, this.productService.version) <= 0) {
				this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
				return;
			}

			const asset = this.resolveUpdateAsset(manifest);
			if (!asset) {
				this.setState(State.Idle(UpdateType.Archive, 'Update package is not available for this platform.'));
				return;
			}

			const update: IUpdate = {
				version: manifest.latestVersion,
				productVersion: manifest.latestVersion,
				url: asset.url,
			};

			if (!explicit && this.meteredConnectionService.isConnectionMetered) {
				this.setState(State.AvailableForDownload(update, true));
				return;
			}

			await this.downloadAndStage(update, explicit, asset.mode);
		} catch (err) {
			this.logService.error('[singularityUpdate] check failed', err);
			this.setState(State.Idle(UpdateType.Archive, String(err)));
		}
	}

	private async downloadAndStage(update: IUpdate, explicit: boolean, mode: 'patch' | 'full' = 'full'): Promise<void> {
		if (!update.url) {
			return;
		}

		this.setState(State.Downloading(update, explicit, false, 0, undefined, Date.now()));

		const updatesDir = join(this.environmentMainService.userDataPath, 'CachedData', 'updates');
		await mkdir(updatesDir, { recursive: true });
		const suffix = mode === 'patch' ? '-patch' : '';
		const zipPath = join(updatesDir, `Singularity-${update.productVersion ?? update.version}${suffix}.zip`);

		try {
			await this.downloadFile(update.url, zipPath);
			this.applicationStorageMainService.store(PENDING_ZIP_STORAGE_KEY, zipPath, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this.applicationStorageMainService.store(PENDING_VERSION_STORAGE_KEY, update.productVersion ?? update.version, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this.applicationStorageMainService.store(PENDING_UPDATE_MODE_KEY, mode, StorageScope.APPLICATION, StorageTarget.MACHINE);
			this.setState(State.Downloaded(update, explicit, false));
			this.setState(State.Ready(update, explicit, false));
			this.logService.info(`[singularityUpdate] staged ${mode} update ${update.productVersion} at ${zipPath}`);
		} catch (err) {
			this.logService.error('[singularityUpdate] download failed', err);
			await unlinkAsync(zipPath).catch(() => undefined);
			this.setState(State.Idle(UpdateType.Archive, String(err)));
		}
	}

	private downloadFile(url: string, dest: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const curl = spawn('curl', ['-fL', '--retry', '3', '-o', dest, url], { stdio: 'ignore' });
			curl.on('error', reject);
			curl.on('close', code => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Download failed (curl exit ${code})`));
				}
			});
		});
	}

	private async fetchManifest(): Promise<ISingularityReleaseManifest | undefined> {
		const url = this.productService.singularityUpdateManifestUrl;
		if (!url) {
			return undefined;
		}
		const context = await this.requestService.request({
			type: 'GET',
			url,
			disableCache: true,
			timeout: 30000,
			callSite: 'SingularityDarwinUpdateService.fetchManifest',
		}, CancellationToken.None);

		if (context.res.statusCode !== 200) {
			this.logService.warn(`[singularityUpdate] manifest HTTP ${context.res.statusCode}`);
			return undefined;
		}

		const manifest = await asJson<ISingularityReleaseManifest>(context);
		if (!manifest?.latestVersion) {
			return undefined;
		}
		return manifest;
	}
}
