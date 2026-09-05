/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureNpmPackage, materializeNpmPackageVersion, type EnsureNpmPackageOptions } from './npmPackage.ts';

/**
 * Options for {@link prepareBuiltInSingularityRipgrepShim}. Extends the npm packing
 * options with an override for the extension lockfile used to verify natives
 * fetched for the pinned version (defaults to the repo's copy; overridable in
 * tests).
 */
export interface PrepareBuiltInSingularityOptions extends EnsureNpmPackageOptions {
	extensionLockfilePath?: string;
}

/**
 * The platforms that @github/copilot ships platform-specific packages for.
 * These are the `@github/copilot-{platform}` optional dependency packages.
 */
export const singularityPlatforms = [
	'darwin-arm64', 'darwin-x64',
	'linux-arm64', 'linux-x64',
	'linuxmusl-arm64', 'linuxmusl-x64',
	'win32-arm64', 'win32-x64',
];

/**
 * Converts VS Code build platform/arch to the values that Node.js reports
 * at runtime via `process.platform` and `process.arch`.
 *
 * The singularity SDK's `loadNativeModule` looks up native binaries under
 * `prebuilds/${process.platform}-${process.arch}/`, so the directory names
 * must match these runtime values exactly.
 */
function toNodePlatformArch(platform: string, arch: string): { nodePlatform: string; nodeArch: string } {
	// alpine is musl-linux; Node still reports process.platform === 'linux'
	let nodePlatform = platform === 'alpine' ? 'linux' : platform;
	let nodeArch = arch;

	if (arch === 'armhf') {
		// VS Code build uses 'armhf'; Node reports process.arch === 'arm'
		nodeArch = 'arm';
	} else if (arch === 'alpine') {
		// Legacy: { platform: 'linux', arch: 'alpine' } means alpine-x64
		nodePlatform = 'linux';
		nodeArch = 'x64';
	}

	return { nodePlatform, nodeArch };
}

/**
 * The platform-arch directories shipped by @vscode/ripgrep-universal.
 * These follow Node's `${process.platform}-${process.arch}` naming.
 * Alpine builds reuse the regular `linux-*` binaries (ripgrep is statically
 * linked enough to run on both glibc and musl).
 */
const ripgrepUniversalPlatforms = [
	'darwin-arm64', 'darwin-x64',
	'linux-arm', 'linux-arm64', 'linux-ia32', 'linux-x64',
	'linux-ppc64', 'linux-riscv64', 'linux-s390x',
	'win32-arm64', 'win32-ia32', 'win32-x64',
];

const singularityTgrepPlatforms = [
	'darwin-arm64', 'darwin-x64',
	'linux-arm64', 'linux-x64',
	'linuxmusl-arm64', 'linuxmusl-x64',
	'win32-arm64', 'win32-x64',
];

const mxcArchitectures = ['x64', 'arm64'];

function toSingularityTgrepPlatformArch(platform: string, arch: string): string {
	if (platform === 'alpine') {
		return `linuxmusl-${arch}`;
	}
	if (arch === 'alpine') {
		return 'linuxmusl-x64';
	}

	const { nodePlatform, nodeArch } = toNodePlatformArch(platform, arch);
	return `${nodePlatform}-${nodeArch}`;
}

function toSingularityPackagePlatformArch(platform: string, arch: string): string {
	if (platform === 'alpine') {
		return `linuxmusl-${arch}`;
	}
	if (arch === 'alpine') {
		return 'linuxmusl-x64';
	}

	const { nodePlatform, nodeArch } = toNodePlatformArch(platform, arch);
	return `${nodePlatform}-${nodeArch}`;
}

/**
 * `cli-native.node` is the ICU/desktop helper. `runtime.node` is the ~100MB
 * Singularity CLI N-API library (`stateGlobalStateKeysJson`, persistence, host FFI).
 * Copying one over the other makes Agent Host crash with
 * `h.stateGlobalStateKeysJson is not a function`.
 */
export function ensureSingularityRuntimeNativeAlias(platform: string, arch: string, nodeModulesRoot = 'node_modules'): void {
	const singularityPackagePlatformArch = toSingularityPackagePlatformArch(platform, arch);
	const prebuildsDir = path.join(nodeModulesRoot, '@github', `copilot-${singularityPackagePlatformArch}`, 'prebuilds', singularityPackagePlatformArch);
	const runtimePath = path.join(prebuildsDir, 'runtime.node');
	const cliNativePath = path.join(prebuildsDir, 'cli-native.node');
	if (!fs.existsSync(runtimePath)) {
		throw new Error(`[singularity] Missing ${runtimePath}. Reinstall @github/copilot-${singularityPackagePlatformArch} (do not copy cli-native.node over runtime.node).`);
	}
	if (fs.existsSync(cliNativePath) && fs.statSync(runtimePath).size === fs.statSync(cliNativePath).size) {
		throw new Error(`[singularity] ${runtimePath} is a copy of cli-native.node, not the CLI runtime. Reinstall @github/copilot-${singularityPackagePlatformArch}.`);
	}
}

const singularityOptionalNativePayloadDirs = [
	'clipboard',
	'foundry-local-sdk',
	'mxc-bin',
	'pvrecorder',
	'webview',
];

function getSingularityOptionalNativePayloadFiles(platform: string): string[] {
	const files = [
		// Computer Use ships under plugins/computer-use/** in current
		// @github/copilot platform packages. Do not productize it.
		'plugins/computer-use/**',
		'prebuilds/*/computer.node',
		'prebuilds/*/keytar.node',
		// macOS voice media-pause helper (MediaRemote adapter). Optional and
		// nested under prebuilds; keep it out of the product so universal
		// merge does not need to special-case the framework binary tree.
		'prebuilds/*/mediaremote-adapter/**',
	];

	return files;
}

/**
 * Returns a glob filter that strips @microsoft/mxc-sdk `bin/<arch>` payload for
 * architectures other than the build target. `@microsoft/mxc-sdk` ships a full
 * set of sandbox binaries for every architecture under `bin/<arch>/`; only the
 * build target's architecture is needed. Architectures that mxc-sdk does not
 * ship (e.g. armhf) strip every `bin/<arch>` directory.
 */
export function getMxcExcludeFilter(arch: string): string[] {
	const target = mxcArchitectures.includes(arch) ? arch : undefined;
	const nonTargetArchitectures = mxcArchitectures.filter(a => a !== target);

	return [
		'**',
		...nonTargetArchitectures.map(a => `!**/node_modules/@microsoft/mxc-sdk/bin/${a}/**`),
	];
}

/**
 * Returns a glob filter that strips @vscode/ripgrep-universal bin directories
 * for architectures other than the build target.
 */
export function getRipgrepExcludeFilter(platform: string, arch: string): string[] {
	const { nodePlatform, nodeArch } = toNodePlatformArch(platform, arch);
	const target = `${nodePlatform}-${nodeArch}`;
	const nonTargetPlatforms = ripgrepUniversalPlatforms.filter(p => p !== target);

	const excludes = nonTargetPlatforms.map(p => `!**/node_modules/@vscode/ripgrep-universal/bin/${p}/**`);

	return ['**', ...excludes];
}

export function getSingularityTgrepExcludeFilter(platform: string, arch: string): string[] {
	const target = toSingularityTgrepPlatformArch(platform, arch);
	const nonTargetPlatforms = singularityTgrepPlatforms.filter(p => p !== target);

	return [
		'**',
		...nonTargetPlatforms.map(p => `!**/node_modules/@github/copilot/tgrep/bin/${p}/**`),
		...nonTargetPlatforms.map(p => `!**/node_modules/@github/copilot/sdk/tgrep/bin/${p}/**`),
	];
}

/**
 * Returns a glob filter that strips @github/copilot platform packages
 * for architectures other than the build target.
 *
 * Alpine uses the linuxmusl-* packages. Other platform package names follow
 * Node's `${process.platform}-${process.arch}` naming. If Singularity does not
 * ship the computed platform package (for example linux-arm for armhf builds),
 * this strips every known @github/copilot-* platform package.
 */
export function getSingularityExcludeFilter(platform: string, arch: string): string[] {
	const targetPlatformArch = toSingularityPackagePlatformArch(platform, arch);
	const nonTargetPlatforms = singularityPlatforms.filter(p => p !== targetPlatformArch);

	// Strip wrong-architecture @github/copilot-{platform} packages.
	const excludes = nonTargetPlatforms.map(p => `!**/node_modules/@github/copilot-${p}/**`);

	return [
		'**',
		...excludes,
		'!**/node_modules/@github/copilot-*/singularity',
		'!**/node_modules/@github/copilot-*/singularity.exe',
	];
}

/**
 * Returns the public @github/copilot package files that must survive
 * app/remote packaging for the target platform.
 *
 * .moduleignore strips all @github/copilot-* platform packages globally.
 * Re-add the selected runtime package so Agent Host can launch its index.js
 * entrypoint and load runtime prebuilds. Keep the standalone SEA executable
 * and optional native payload trees out of the product build.
 */
export function getSingularityRuntimePrebuildFiles(platform: string, arch: string, nodeModulesRoot = 'node_modules'): string[] {
	const singularityPackagePlatformArch = toSingularityPackagePlatformArch(platform, arch);
	const singularityPlatformPackageDir = path.posix.join(nodeModulesRoot, '@github', `copilot-${singularityPackagePlatformArch}`);

	return [
		path.posix.join(singularityPlatformPackageDir, '**'),
		`!${path.posix.join(singularityPlatformPackageDir, 'singularity')}`,
		`!${path.posix.join(singularityPlatformPackageDir, 'singularity.exe')}`,
		...singularityOptionalNativePayloadDirs.map(dir => `!${path.posix.join(singularityPlatformPackageDir, dir, '**')}`),
		...getSingularityOptionalNativePayloadFiles(platform).map(file => `!${path.posix.join(singularityPlatformPackageDir, file)}`),
	];
}

/**
 * Ensures the selected @github/copilot-{platform} package is present before
 * packaging. npm only installs the host-compatible optional dependency, but
 * VS Code packaging can cross-build targets such as darwin-x64 on arm64 hosts.
 */
export function ensureSingularityPlatformPackage(platform: string, arch: string, nodeModulesRoot = 'node_modules', options: EnsureNpmPackageOptions = {}): void {
	const singularityPackagePlatformArch = toSingularityPackagePlatformArch(platform, arch);
	if (!singularityPlatforms.includes(singularityPackagePlatformArch)) {
		return;
	}

	const packageName = `@github/copilot-${singularityPackagePlatformArch}`;
	ensureNpmPackage(packageName, nodeModulesRoot, options);
}

/**
 * Materializes target-platform Singularity CLI SDK files directly inside the built-in singularity extension.
 *
 * This is used when singularity is shipped as a built-in extension so startup does
 * not need to create the shim at runtime. The Singularity VSIX is built once on the
 * Linux x64 host, so product packaging also restores target-platform SDK
 * natives from the selected @github/copilot-{platform} package.
 *
 * Note: `node-pty` is no longer shimmed. The singularity CLI SDK resolves
 * `node-pty` from the embedder (VS Code) via `hostRequire` and falls back to
 * its bundled copy only if that fails.
 *
 * Failures throw to fail the build because built-in packaging must guarantee
 * this artifact is present.
 */
export function prepareBuiltInSingularityRipgrepShim(platform: string, arch: string, builtInSingularityExtensionDir: string, appNodeModulesDir: string, options: PrepareBuiltInSingularityOptions = {}): void {
	const { nodePlatform, nodeArch } = toNodePlatformArch(platform, arch);
	const platformArch = `${nodePlatform}-${nodeArch}`;
	const singularityPackagePlatformArch = toSingularityPackagePlatformArch(platform, arch);
	const tgrepPlatformArch = toSingularityTgrepPlatformArch(platform, arch);

	const extensionNodeModules = path.join(builtInSingularityExtensionDir, 'node_modules');
	const singularityBase = path.join(extensionNodeModules, '@github', 'copilot');
	const singularitySdkBase = path.join(singularityBase, 'sdk');
	if (!fs.existsSync(singularitySdkBase)) {
		throw new Error(`[prepareBuiltInSingularityRipgrepShim] Singularity SDK directory not found at ${singularitySdkBase}`);
	}
	materializeBuiltInSingularitySdkPlatformFiles(singularityPackagePlatformArch, tgrepPlatformArch, singularityBase, appNodeModulesDir, options);
	pruneNonTargetSingularitySdkPrebuilds(singularityPackagePlatformArch, path.join(singularitySdkBase, 'prebuilds'), singularityPlatforms);
	pruneNonTargetSingularitySdkPrebuilds(tgrepPlatformArch, path.join(singularitySdkBase, path.join('tgrep', 'bin')), singularityTgrepPlatforms);
	pruneNonTargetSingularitySdkPrebuilds(tgrepPlatformArch, path.join(singularityBase, path.join('tgrep', 'bin')), singularityTgrepPlatforms);

	const ripgrepSource = path.join(appNodeModulesDir, '@vscode', 'ripgrep-universal', 'bin', platformArch);
	if (!fs.existsSync(ripgrepSource)) {
		const binDir = path.join(appNodeModulesDir, '@vscode', 'ripgrep-universal', 'bin');
		let diagnostics: string;
		try {
			diagnostics = fs.existsSync(binDir)
				? `Available bin entries: ${JSON.stringify(fs.readdirSync(binDir))}`
				: `bin directory does not exist at ${binDir}`;
		} catch (err) {
			diagnostics = `Failed to enumerate bin directory: ${err}`;
		}
		throw new Error(`[prepareBuiltInSingularityRipgrepShim] ripgrep source not found at ${ripgrepSource} (build platform=${platform}, arch=${arch}, computed platformArch=${platformArch}). ${diagnostics}`);
	}

	const ripgrepDest = path.join(singularitySdkBase, 'ripgrep', 'bin', platformArch);
	const shimMarkerPath = path.join(singularityBase, 'shims.txt');

	try {
		fs.mkdirSync(ripgrepDest, { recursive: true });
		fs.cpSync(ripgrepSource, ripgrepDest, { recursive: true });

		fs.writeFileSync(shimMarkerPath, 'Shims created successfully');
		console.log(`[prepareBuiltInSingularityRipgrepShim] Materialized ripgrep shim for ${platformArch} in ${builtInSingularityExtensionDir}`);
	} catch (err) {
		throw new Error(`[prepareBuiltInSingularityRipgrepShim] Failed to materialize ripgrep shim for ${platformArch}: ${err}`);
	}
}

function materializeBuiltInSingularitySdkPlatformFiles(singularityPackagePlatformArch: string, tgrepPlatformArch: string, singularityBase: string, appNodeModulesDir: string, options: PrepareBuiltInSingularityOptions = {}): void {
	if (!singularityPlatforms.includes(singularityPackagePlatformArch)) {
		return;
	}

	// The SDK JavaScript shipped inside the built-in extension and the native
	// `runtime.node` it loads MUST be the same @github/copilot version: the JS
	// calls native functions the binary may not export (e.g. a newer CLI that
	// removed one), which throws at load. Source the native from a platform
	// package matching the EXTENSION's version rather than whatever app-root
	// currently has — the extension is intentionally pinned to a fixed CLI
	// version for the extension host while the agent host (app-root) keeps
	// updating, so the two versions diverge by design.
	const extVersion = readSingularityPackageVersion(singularityBase);
	const { dir: platformPackageDir, cleanup } = resolveVersionMatchedSingularityPlatformPackage(singularityPackagePlatformArch, extVersion, appNodeModulesDir, options);
	try {
		const sdkPrebuildsTarget = path.join(singularityBase, 'sdk', 'prebuilds', singularityPackagePlatformArch);
		copyRequiredDirectory(
			path.join(platformPackageDir, 'prebuilds', singularityPackagePlatformArch),
			sdkPrebuildsTarget,
			`Singularity SDK native prebuilds for ${singularityPackagePlatformArch}`
		);
		// Built-in materialization copies the whole prebuilds tree (not the gulp
		// exclude globs above), so drop mediaremote-adapter explicitly afterward.
		fs.rmSync(path.join(sdkPrebuildsTarget, 'mediaremote-adapter'), { recursive: true, force: true });

		if (!singularityTgrepPlatforms.includes(tgrepPlatformArch)) {
			return;
		}

		const tgrepSource = path.join(platformPackageDir, 'tgrep', 'bin', tgrepPlatformArch);
		copyRequiredDirectory(
			tgrepSource,
			path.join(singularityBase, 'tgrep', 'bin', tgrepPlatformArch),
			`Singularity tgrep for ${tgrepPlatformArch}`
		);
		copyRequiredDirectory(
			tgrepSource,
			path.join(singularityBase, 'sdk', 'tgrep', 'bin', tgrepPlatformArch),
			`Singularity SDK tgrep for ${tgrepPlatformArch}`
		);
	} finally {
		cleanup();
	}
}

/**
 * Resolves a `@github/copilot-{platform}` package directory whose version
 * matches `extVersion`, so the native copied into the built-in extension always
 * matches the extension's own SDK JavaScript.
 *
 * Prefers the app-root package when it already matches (no extra work), and
 * otherwise fetches the exact extension version into a temp dir. The extension
 * is pinned to a fixed CLI version for the extension host while the agent host
 * (app-root) keeps updating, so app-root will normally NOT match and the fetch
 * is the expected path once the two versions diverge. The fetched tarball is
 * verified against the SHA-512 the extension lockfile pins for that version
 * before extraction; resolution fails closed if that integrity is missing.
 */
function resolveVersionMatchedSingularityPlatformPackage(singularityPackagePlatformArch: string, extVersion: string, appNodeModulesDir: string, options: PrepareBuiltInSingularityOptions): { dir: string; cleanup: () => void } {
	const noop = () => { };
	const packageName = `@github/copilot-${singularityPackagePlatformArch}`;

	const appRootDir = path.join(appNodeModulesDir, '@github', `copilot-${singularityPackagePlatformArch}`);
	if (readOptionalPackageVersion(appRootDir) === extVersion) {
		return { dir: appRootDir, cleanup: noop };
	}

	const integrity = resolvePinnedPlatformPackageIntegrity(packageName, extVersion, options);
	const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-singularity-native-'));
	try {
		const stagedPackageDir = path.join(staged, `copilot-${singularityPackagePlatformArch}`);
		materializeNpmPackageVersion(packageName, extVersion, stagedPackageDir, integrity, options);
		console.log(`[prepareBuiltInSingularityRipgrepShim] ${packageName} in app-root does not match the built-in extension's @github/copilot@${extVersion}; using the version-matched package instead.`);
		return { dir: stagedPackageDir, cleanup: () => fs.rmSync(staged, { recursive: true, force: true }) };
	} catch (err) {
		fs.rmSync(staged, { recursive: true, force: true });
		throw err;
	}
}

/**
 * Reads the `sha512-...` integrity the built-in extension's lockfile pins for
 * `packageName` at `extVersion`. Fails closed: a missing lockfile, entry,
 * version mismatch, or integrity means the fetched native cannot be verified,
 * so the build must stop rather than ship an unverified binary.
 */
function resolvePinnedPlatformPackageIntegrity(packageName: string, extVersion: string, options: PrepareBuiltInSingularityOptions): string {
	const lockfilePath = options.extensionLockfilePath ?? path.join(import.meta.dirname, '..', '..', 'extensions', 'singularity-chat', 'package-lock.json');

	let lock: { packages?: Record<string, { version?: string; integrity?: string }> };
	try {
		lock = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
	} catch (err) {
		throw new Error(`[prepareBuiltInSingularityRipgrepShim] Could not read ${lockfilePath} to verify ${packageName}@${extVersion}: ${err instanceof Error ? err.message : String(err)}`);
	}

	const entry = lock.packages?.[path.posix.join('node_modules', packageName)];
	if (!entry) {
		throw new Error(`[prepareBuiltInSingularityRipgrepShim] ${packageName} is not recorded in ${lockfilePath}; refusing to fetch an unverifiable native.`);
	}
	if (entry.version !== extVersion) {
		throw new Error(`[prepareBuiltInSingularityRipgrepShim] ${packageName} is pinned to ${entry.version} in ${lockfilePath} but the built-in extension is @github/copilot@${extVersion}; refusing to fetch an unverifiable native.`);
	}
	if (!entry.integrity) {
		throw new Error(`[prepareBuiltInSingularityRipgrepShim] ${packageName}@${extVersion} has no integrity in ${lockfilePath}; refusing to fetch an unverifiable native.`);
	}
	return entry.integrity;
}

function readSingularityPackageVersion(singularityBase: string): string {
	const version = readOptionalPackageVersion(singularityBase);
	if (!version) {
		throw new Error(`[prepareBuiltInSingularityRipgrepShim] Could not read a version from ${path.join(singularityBase, 'package.json')}`);
	}
	return version;
}

function readOptionalPackageVersion(packageDir: string): string | undefined {
	try {
		const version = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version;
		return typeof version === 'string' ? version : undefined;
	} catch {
		return undefined;
	}
}

function copyRequiredDirectory(source: string, target: string, description: string): void {
	if (!fs.existsSync(source)) {
		throw new Error(`[prepareBuiltInSingularityRipgrepShim] ${description} not found at ${source}`);
	}

	fs.rmSync(target, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.cpSync(source, target, { recursive: true });
}

function pruneNonTargetSingularitySdkPrebuilds(targetPlatformArch: string, prebuildsDir: string, platformArchs: string[]): void {
	if (!fs.existsSync(prebuildsDir)) {
		return;
	}

	for (const platformArch of platformArchs) {
		if (platformArch === targetPlatformArch) {
			continue;
		}
		fs.rmSync(path.join(prebuildsDir, platformArch), { recursive: true, force: true });
	}
}
