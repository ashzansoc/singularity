/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import { dirname, join } from '../../../../base/common/path.js';

const LAUNCHER_BASENAME = process.platform === 'win32' ? 'singularity-cli-host.cmd' : 'singularity-cli-host';

const UNIX_LAUNCHER = `#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="\${SINGULARITY_CLI_NODE:-$(command -v node)}"
exec "$NODE" "$DIR/index.js" "$@"
`;

const WIN_LAUNCHER = `@echo off\r\nsetlocal\r\nset "DIR=%~dp0"\r\nif defined SINGULARITY_CLI_NODE (\r\n  "%SINGULARITY_CLI_NODE%" "%DIR%index.js" %*\r\n) else (\r\n  node "%DIR%index.js" %*\r\n)\r\n`;

/**
 * The Copilot SDK spawns `.js` entrypoints with `process.execPath`. Under
 * Electron that is the app binary, which makes `index.js --headless --stdio`
 * fail with "too many arguments". A extensionless launcher lets the SDK spawn
 * the script directly so it can exec a real Node binary.
 */
export async function resolveSingularityCliSpawnPath(indexJsPath: string): Promise<string> {
	const launcherPath = join(dirname(indexJsPath), LAUNCHER_BASENAME);
	const launcherContents = process.platform === 'win32' ? WIN_LAUNCHER : UNIX_LAUNCHER;
	try {
		const existing = await fs.readFile(launcherPath, 'utf8');
		if (existing === launcherContents) {
			return launcherPath;
		}
	} catch {
		// (re)write below
	}
	await fs.writeFile(launcherPath, launcherContents, { mode: 0o755 });
	return launcherPath;
}
