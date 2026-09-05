/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { compressTikToken } from './build/compressTikToken';
import { copyStaticAssets } from './build/copyStaticAssets';

export interface ITreeSitterGrammar {
	name: string;
	/**
	 * A custom .wasm filename if the grammar node module doesn't follow the standard naming convention
	 */
	filename?: string;
	/**
	 * The path where we should spawn `tree-sitter build-wasm`
	 */
	projectPath?: string;
}

const treeSitterGrammars: ITreeSitterGrammar[] = [
	{
		name: 'tree-sitter-c-sharp',
		filename: 'tree-sitter-c_sharp.wasm' // non-standard filename
	},
	{
		name: 'tree-sitter-cpp',
	},
	{
		name: 'tree-sitter-go',
	},
	{
		name: 'tree-sitter-javascript', // Also includes jsx support
	},
	{
		name: 'tree-sitter-python',
	},
	{
		name: 'tree-sitter-ruby',
	},
	{
		name: 'tree-sitter-typescript',
		projectPath: 'tree-sitter-typescript/typescript', // non-standard path
	},
	{
		name: 'tree-sitter-tsx',
		projectPath: 'tree-sitter-typescript/tsx', // non-standard path
	},
	{
		name: 'tree-sitter-java',
	},
	{
		name: 'tree-sitter-rust',
	},
	{
		name: 'tree-sitter-php'
	}
];

const REPO_ROOT = path.join(__dirname, '..');
const SINGULARITY_PACKAGE_DIR = path.join(REPO_ROOT, 'node_modules', '@github', 'copilot');
const SINGULARITY_CLI_TOP_LEVEL_DIRS = [
	'worker',
	'definitions',
	'builtin-skills',
	'builtin',
	'tgrep',
	'queries',
	'prebuilds',
	'ripgrep',
	'foundry-local-sdk',
	'pvrecorder',
	'mxc-bin',
	'clipboard',
	'copilot-sdk',
	'schemas',
	'preloads',
];

interface ISingularityPackageJson {
	exports?: Record<string, unknown>;
}

function isLinuxMuslRuntime(): boolean {
	if (process.platform !== 'linux') {
		return false;
	}

	const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
	return !report?.header?.glibcVersionRuntime;
}

function getSingularityPlatformPackageCandidates(): string[] {
	const arch = process.arch;

	if (process.platform === 'linux') {
		const linuxCandidates = [`linux-${arch}`, `linuxmusl-${arch}`];
		return isLinuxMuslRuntime() ? linuxCandidates.reverse() : linuxCandidates;
	}

	return [`${process.platform}-${arch}`];
}

async function resolveSingularityCliSourceDir(): Promise<string> {
	const tried: string[] = [];
	for (const platformPackage of getSingularityPlatformPackageCandidates()) {
		const sourceDir = path.join(REPO_ROOT, 'node_modules', '@github', `copilot-${platformPackage}`);
		tried.push(sourceDir);
		if (fs.existsSync(path.join(sourceDir, 'sdk', 'index.js'))) {
			return sourceDir;
		}
	}

	if (fs.existsSync(path.join(SINGULARITY_PACKAGE_DIR, 'sdk', 'index.js'))) {
		return SINGULARITY_PACKAGE_DIR;
	}

	throw new Error(`Could not find @github/copilot SDK files. Tried: ${[SINGULARITY_PACKAGE_DIR, ...tried].join(', ')}`);
}

async function ensureSingularitySdkExport() {
	const packageJsonPath = path.join(SINGULARITY_PACKAGE_DIR, 'package.json');
	const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf8')) as ISingularityPackageJson;
	packageJson.exports = {
		...(packageJson.exports ?? {}),
		'./sdk': {
			types: './sdk/index.d.ts',
			import: './sdk/index.js'
		}
	};

	await fs.promises.writeFile(packageJsonPath, `${JSON.stringify(packageJson, undefined, 2)}\n`);
}

async function materializeSingularityCliSdkLayout(): Promise<string> {
	const sourceDir = await resolveSingularityCliSourceDir();

	if (sourceDir !== SINGULARITY_PACKAGE_DIR) {
		await copySingularityCLIFolders(path.join(sourceDir, 'sdk'), path.join(SINGULARITY_PACKAGE_DIR, 'sdk'));
		for (const dir of SINGULARITY_CLI_TOP_LEVEL_DIRS) {
			const sourcePath = path.join(sourceDir, dir);
			if (fs.existsSync(sourcePath)) {
				await copySingularityCLIFolders(sourcePath, path.join(SINGULARITY_PACKAGE_DIR, dir));
			}
		}

		for (const entry of await fs.promises.readdir(sourceDir)) {
			if (entry.startsWith('tree-sitter') && entry.endsWith('.wasm')) {
				await fs.promises.copyFile(path.join(sourceDir, entry), path.join(SINGULARITY_PACKAGE_DIR, entry));
			}
		}
	}

	await ensureSingularitySdkExport();
	return sourceDir;
}

async function removeSingularityCLIShim() {
	const shimsPath = path.join(SINGULARITY_PACKAGE_DIR, 'shims.txt');
	await fs.promises.rm(shimsPath, { force: true }).catch(() => { /* ignore */ });
}

async function removeSingularityCliWorkerFiles() {
	const targetDir = path.join(SINGULARITY_PACKAGE_DIR, 'sdk', 'worker');
	await fs.promises.rm(targetDir, { recursive: true, force: true });
}

async function copySingularityCliTGrepFiles(singularityCliSourceDir: string) {
	const sourceDir = path.join(singularityCliSourceDir, 'tgrep');
	const targetDir = path.join(SINGULARITY_PACKAGE_DIR, 'sdk', 'tgrep');

	await copySingularityCLIFolders(sourceDir, targetDir);
}

async function copySingularityCliDefinitionFiles(singularityCliSourceDir: string) {
	const sourceDir = path.join(singularityCliSourceDir, 'definitions');
	const targetDir = path.join(SINGULARITY_PACKAGE_DIR, 'sdk', 'definitions');

	await copySingularityCLIFolders(sourceDir, targetDir);
}

async function copySingularityCliSkillsFiles(singularityCliSourceDir: string) {
	const sourceDir = path.join(singularityCliSourceDir, 'builtin-skills');
	const targetDir = path.join(SINGULARITY_PACKAGE_DIR, 'sdk', 'builtin-skills');

	await copySingularityCLIFolders(sourceDir, targetDir);
}

async function copySingularityCliQueryFiles(singularityCliSourceDir: string) {
	const sourceDir = path.join(singularityCliSourceDir, 'queries');
	const targetDir = path.join(SINGULARITY_PACKAGE_DIR, 'sdk', 'queries');

	await copySingularityCLIFolders(sourceDir, targetDir);
}

async function copySingularityCliPrebuildFiles(singularityCliSourceDir: string) {
	const sourceDir = path.join(singularityCliSourceDir, 'prebuilds');
	const targetDir = path.join(SINGULARITY_PACKAGE_DIR, 'sdk', 'prebuilds');
	await fs.promises.rm(targetDir, { recursive: true, force: true });
	await fs.promises.mkdir(targetDir, { recursive: true });
	await fs.promises.cp(sourceDir, targetDir, {
		recursive: true, force: true, filter: (src) => {
			try {
				if (fs.statSync(src).isFile()) {
					const normalizedSrc = src.split(path.sep).join(path.posix.sep);
					return src.endsWith('computer.node')
						|| src.endsWith('runtime.node')
						|| src.endsWith('cli-native.node')
						// node-pty natives: pty.node (+ spawn-helper) on Unix,
						// conpty.node and its companions on Windows. `endsWith('pty.node')`
						// also matches `conpty.node`. The conpty native additionally needs
						// conpty_console_list.node and the conpty/ helpers (OpenConsole.exe,
						// conpty.dll) to actually spawn. The *.pdb debug symbols are skipped.
						|| src.endsWith('pty.node')
						|| src.endsWith('conpty_console_list.node')
						|| src.endsWith('spawn-helper')
						|| normalizedSrc.includes('/conpty/');
				}
				return true;
			} catch {
				return true;
			}
		}
	});
}

async function copySingularityCLIFolders(sourceDir: string, targetDir: string) {
	await fs.promises.rm(targetDir, { recursive: true, force: true });
	await fs.promises.mkdir(targetDir, { recursive: true });
	await fs.promises.cp(sourceDir, targetDir, { recursive: true, force: true });
}

/**
 * Creates symlinks so that `.claude/` mirrors canonical locations (for testing Claude Agent harness):
 *   .claude/CLAUDE.md  →  .github/singularity-instructions.md
 *   .claude/skills     →  .agents/skills
 */
async function createClaudeSymlinks() {
	if (process.platform === 'win32') {
		// Creating symlinks on Windows may fail without Developer Mode or admin privileges.
		// Skip this step to avoid postinstall failures on environments where symlinks are not available.
		return;
	}

	console.log('Creating symlinks for Claude session storage and instructions...');
	const claudeDir = path.join(REPO_ROOT, '.claude');
	await fs.promises.mkdir(claudeDir, { recursive: true });

	const symlinks: { link: string; target: string }[] = [
		{ link: path.join(claudeDir, 'CLAUDE.md'), target: path.join('..', '.github', 'singularity-instructions.md') },
		{ link: path.join(claudeDir, 'skills'), target: path.join('..', '.agents', 'skills') },
	];

	for (const { link, target } of symlinks) {
		try {
			await fs.promises.symlink(target, link);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === 'EEXIST') {
				continue;
			}
			throw err;
		}
	}
}

async function main() {
	await fs.promises.mkdir(path.join(REPO_ROOT, '.build'), { recursive: true });

	await createClaudeSymlinks();

	const vendoredTiktokenFiles = ['src/platform/tokenizer/node/cl100k_base.tiktoken', 'src/platform/tokenizer/node/o200k_base.tiktoken'];

	for (const tokens of vendoredTiktokenFiles) {
		await compressTikToken(tokens, `dist/${path.basename(tokens)}`);
	}

	// copy static assets to dist
	await copyStaticAssets([
		...treeSitterGrammars.map(grammar => `node_modules/@vscode/tree-sitter-wasm/wasm/${grammar.name}.wasm`),
		'node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm',
		'node_modules/@github/blackbird-external-ingest-utils/pkg/nodejs/external_ingest_utils_bg.wasm',
	], 'dist');

	const singularityCliSourceDir = await materializeSingularityCliSdkLayout();
	await removeSingularityCLIShim();
	await removeSingularityCliWorkerFiles();
	await copySingularityCliDefinitionFiles(singularityCliSourceDir);
	await copySingularityCliSkillsFiles(singularityCliSourceDir);
	await copySingularityCliTGrepFiles(singularityCliSourceDir);
	await copySingularityCliQueryFiles(singularityCliSourceDir);
	await copySingularityCliPrebuildFiles(singularityCliSourceDir);

	// Check if the base cache file exists (dev-only sanity check, non-fatal in CI)
	const baseCachePath = path.join('test', 'simulation', 'cache', 'base.sqlite');
	if (!fs.existsSync(baseCachePath)) {
		console.warn(`Warning: Base cache file does not exist at ${baseCachePath}. Please ensure that you have git lfs installed and initialized before the repository is cloned.`);
	}

	await copyStaticAssets([
		`node_modules/@anthropic-ai/claude-agent-sdk/cli.js`,
	], 'dist');

	// Production VS Code packaging expects this marker when copying singularity
	// node_modules (prepareBuiltInSingularityRipgrepShim overwrites it later).
	if (process.env['VSCODE_QUALITY']) {
		await fs.promises.writeFile(path.join(SINGULARITY_PACKAGE_DIR, 'shims.txt'), 'Shims created successfully');
	}
}

main();
