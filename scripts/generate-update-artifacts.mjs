#!/usr/bin/env node
/**
 * Build file manifests and incremental patch zips for Singularity OTA updates.
 *
 * Usage:
 *   node scripts/generate-update-artifacts.mjs \
 *     --app /path/to/VSCode-darwin-arm64/Singularity.app \
 *     --version 1.134.3 \
 *     --arch arm64 \
 *     --out release/out
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const key = argv[i];
		if (!key.startsWith('--')) {
			continue;
		}
		const name = key.slice(2);
		const value = argv[i + 1];
		if (!value || value.startsWith('--')) {
			args[name] = true;
		} else {
			args[name] = value;
			i++;
		}
	}
	return args;
}

async function hashFile(filePath) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(filePath);
		stream.on('data', chunk => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
		stream.on('error', reject);
	});
}

async function walkApp(appPath) {
	const appName = path.basename(appPath);
	const files = /** @type {Record<string, { sha256: string; size: number }>} */ ({});

	async function walk(dir, relBase) {
		for (const name of fs.readdirSync(dir)) {
			const full = path.join(dir, name);
			const rel = relBase ? `${relBase}/${name}` : name;
			const stat = fs.statSync(full);
			if (stat.isDirectory()) {
				await walk(full, rel);
			} else if (stat.isFile()) {
				files[rel] = {
					sha256: await hashFile(full),
					size: stat.size,
				};
			}
		}
	}

	await walk(appPath, appName);
	return files;
}

function compareManifests(prev, next) {
	const changed = [];
	const added = [];
	const removed = [];

	for (const [rel, meta] of Object.entries(next)) {
		if (!prev[rel]) {
			added.push(rel);
		} else if (prev[rel].sha256 !== meta.sha256) {
			changed.push(rel);
		}
	}

	for (const rel of Object.keys(prev)) {
		if (!next[rel]) {
			removed.push(rel);
		}
	}

	return { changed, added, removed, patchPaths: [...changed, ...added] };
}

function createPatchZip(appParent, appName, patchPaths, patchZipPath) {
	if (patchPaths.length === 0) {
		return false;
	}

	fs.mkdirSync(path.dirname(patchZipPath), { recursive: true });
	if (fs.existsSync(patchZipPath)) {
		fs.unlinkSync(patchZipPath);
	}

	const args = ['-Xry', patchZipPath, ...patchPaths];
	const result = spawnSync('zip', args, { cwd: appParent, stdio: 'inherit' });
	if (result.status !== 0) {
		throw new Error(`zip failed with exit code ${result.status}`);
	}
	return true;
}

async function main() {
	const args = parseArgs(process.argv);
	const appPath = args.app;
	const version = args.version;
	const arch = args.arch ?? 'arm64';
	const outDir = args.out ?? 'release/out';

	if (!appPath || !version) {
		console.error('Usage: generate-update-artifacts.mjs --app <path/to/Singularity.app> --version <semver> [--arch arm64] [--out release/out]');
		process.exit(1);
	}

	if (!fs.existsSync(appPath)) {
		console.error(`App not found: ${appPath}`);
		process.exit(1);
	}

	const appName = path.basename(appPath);
	const appParent = path.dirname(appPath);
	const manifestDir = path.join(outDir, 'manifests');
	fs.mkdirSync(manifestDir, { recursive: true });

	console.log(`==> Hashing ${appPath}`);
	const files = await walkApp(appPath);
	const manifestPath = path.join(manifestDir, `${version}.json`);
	const manifest = {
		version,
		arch,
		appName,
		generatedAt: new Date().toISOString(),
		fileCount: Object.keys(files).length,
		files,
	};
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
	console.log(`    manifest: ${manifestPath} (${manifest.fileCount} files)`);

	const prevManifestPath = path.join(manifestDir, 'latest.json');
	let patchInfo = undefined;

	if (fs.existsSync(prevManifestPath)) {
		const prev = JSON.parse(fs.readFileSync(prevManifestPath, 'utf8'));
		if (prev.version !== version) {
			const { patchPaths, removed } = compareManifests(prev.files ?? {}, files);
			const patchName = `Singularity-patch-${prev.version}-to-${version}-darwin-${arch}.zip`;
			const patchZipPath = path.join(outDir, patchName);

			if (removed.length > 0) {
				console.log(`    ${removed.length} removed file(s) — patch zip will not include deletions (full zip still published)`);
			}

			if (patchPaths.length > 0) {
				console.log(`==> Creating patch zip (${patchPaths.length} changed/new files)`);
				createPatchZip(appParent, appName, patchPaths, patchZipPath);
				const patchStat = fs.statSync(patchZipPath);
				patchInfo = {
					fromVersion: prev.version,
					file: patchName,
					path: patchZipPath,
					size: patchStat.size,
					sha256: await hashFile(patchZipPath),
					fileCount: patchPaths.length,
				};
				console.log(`    patch: ${patchZipPath} (${(patchStat.size / 1024 / 1024).toFixed(2)} MB)`);
			} else {
				console.log('    No file changes vs previous manifest — skipping patch zip');
			}
		}
	} else {
		console.log('    No previous manifest — first release, patch zip skipped');
	}

	fs.writeFileSync(prevManifestPath, JSON.stringify(manifest, null, 2));

	const patchMetaPath = path.join(outDir, 'patch-info.json');
	if (patchInfo) {
		fs.writeFileSync(patchMetaPath, JSON.stringify(patchInfo, null, 2));
	} else if (fs.existsSync(patchMetaPath)) {
		fs.unlinkSync(patchMetaPath);
	}

	console.log('Done.');
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
