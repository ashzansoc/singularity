/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rootDir = path.resolve(import.meta.dirname, '..', '..');

function runProcess(command: string, args: ReadonlyArray<string> = []) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { cwd: rootDir, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
		child.on('exit', err => !err ? resolve() : process.exit(err ?? 1));
		child.on('error', reject);
	});
}

async function exists(subdir: string) {
	try {
		await fs.stat(path.join(rootDir, subdir));
		return true;
	} catch {
		return false;
	}
}

async function ensureNodeModules() {
	if (!(await exists('node_modules'))) {
		await runProcess(npm, ['ci']);
	}
}

async function getElectron() {
	// `npm run electron` deletes and re-downloads `.build/electron` on every
	// invocation. When preLaunch runs repeatedly (e.g. once per integration test
	// section) this is both wasteful and a source of flaky failures on Windows,
	// where the just-exited Electron process can still hold file locks while the
	// directory is being removed and re-extracted. Skip the refresh when the
	// already-present Electron matches the expected version; any detection
	// failure falls back to a (re)download to preserve the previous behavior.
	if (await isExpectedElectronInstalled()) {
		return;
	}
	await runProcess(npm, ['run', 'electron']);
}

async function isExpectedElectronInstalled(): Promise<boolean> {
	try {
		const { getElectronVersion } = await import('./util.ts');
		const { electronVersion } = getElectronVersion();
		const installedVersion = (await fs.readFile(path.join(rootDir, '.build', 'electron', 'version'), 'utf8')).trim().replace(/^v/, '');
		return installedVersion === electronVersion;
	} catch {
		return false;
	}
}

async function ensureCompiled() {
	if (!(await exists('out/main.js'))) {
		await runProcess(npm, ['run', 'compile']);
		return;
	}

	// Partial out/ trees happen when new sources land without a full compile
	// (e.g. platform/browserView CDP). Transpile is fast and catches up.
	if (await needsClientTranspile()) {
		await runProcess('node', ['build/next/index.ts', 'transpile']);
	}
}

/** True when emitted JS is missing or older than its TypeScript source. */
async function needsClientTranspile(): Promise<boolean> {
	const pairs: ReadonlyArray<readonly [string, string]> = [
		['src/vs/platform/browserView/common/cdp/proxy.ts', 'out/vs/platform/browserView/common/cdp/proxy.js'],
		['src/vs/platform/browserView/common/cdp/types.ts', 'out/vs/platform/browserView/common/cdp/types.js'],
	];
	for (const [srcRel, outRel] of pairs) {
		try {
			const srcStat = await fs.stat(path.join(rootDir, srcRel));
			const outStat = await fs.stat(path.join(rootDir, outRel));
			if (srcStat.mtimeMs > outStat.mtimeMs) {
				return true;
			}
		} catch {
			return true;
		}
	}
	return false;
}

async function ensurePackageBuilt(packagesRoot: string, pkg: string): Promise<void> {
	const distJs = path.join(packagesRoot, pkg, 'dist', 'index.js');
	try {
		await fs.stat(distJs);
		return;
	} catch {
		await runProcess(npm, ['--prefix', path.join(packagesRoot, pkg), 'run', 'build']);
	}
}

async function ensureSingularityStack() {
	const repoRoot = path.resolve(rootDir, '..');
	const packagesRoot = path.join(repoRoot, 'packages');
	const aiExtDir = path.join(rootDir, 'extensions', 'singularity-ai');

	try {
		const rootPkg = JSON.parse(
			await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
		) as { name?: string };
		if (rootPkg.name !== 'singularity') {
			return;
		}
	} catch {
		return;
	}

	for (const pkg of [
		'cache',
		'prompt',
		'router',
		'design',
		'context',
		'wiki',
		'runtime',
	]) {
		try {
			await fs.stat(path.join(packagesRoot, pkg, 'package.json'));
		} catch {
			return;
		}
		await ensurePackageBuilt(packagesRoot, pkg);
	}

	try {
		await fs.stat(path.join(aiExtDir, 'package.json'));
	} catch {
		return;
	}

	// Always rebuild when dist is missing OR older than source (status bar / recordUsage drift)
	const distJs = path.join(aiExtDir, 'dist', 'extension.js');
	const srcTs = path.join(aiExtDir, 'src', 'extension.ts');
	let needsBuild = false;
	try {
		const distStat = await fs.stat(distJs);
		const srcStat = await fs.stat(srcTs);
		needsBuild = srcStat.mtimeMs > distStat.mtimeMs;
	} catch {
		needsBuild = true;
	}
	if (needsBuild) {
		try {
			await fs.stat(path.join(aiExtDir, 'node_modules'));
		} catch {
			await runProcess(npm, ['--prefix', aiExtDir, 'install']);
		}
		await runProcess(npm, ['--prefix', aiExtDir, 'run', 'build']);
	}
	// Sync into .build so the running Electron app picks up the latest bundle
	const buildExt = path.join(rootDir, '.build', 'extensions', 'singularity-ai');
	await fs.mkdir(path.join(buildExt, 'dist'), { recursive: true });
	await fs.copyFile(path.join(aiExtDir, 'package.json'), path.join(buildExt, 'package.json'));
	await fs.copyFile(distJs, path.join(buildExt, 'dist', 'extension.js'));
	try {
		await fs.copyFile(
			path.join(aiExtDir, 'dist', 'extension.js.map'),
			path.join(buildExt, 'dist', 'extension.js.map'),
		);
	} catch {
		/* map optional */
	}
}

async function main() {
	await ensureNodeModules();
	await ensureSingularityStack();
	await getElectron();
	await ensureCompiled();

	// Can't require this until after dependencies are installed
	const { getBuiltInExtensions } = await import('./builtInExtensions.ts');
	await getBuiltInExtensions();
}

if (import.meta.main) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
