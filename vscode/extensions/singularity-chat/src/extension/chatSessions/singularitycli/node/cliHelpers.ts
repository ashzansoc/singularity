/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { homedir } from 'os';
import { join } from 'path';

const SINGULARITY_HOME_DIRECTORY = '.singularity';

export function getSingularityHome(): string {
	return process.env.SINGULARITY_HOME || join(homedir(), SINGULARITY_HOME_DIRECTORY);
}

export function getSingularityCliStateDir(): string {
	return join(getSingularityHome(), 'ide');
}

export function getSingularityCLISessionStateDir(): string {
	return join(getSingularityHome(), 'session-state');
}

export function getSingularityCLISessionDir(sessionId: string): string {
	return join(getSingularityCLISessionStateDir(), sessionId);
}

export function getSingularityCLISessionEventsFile(sessionId: string) {
	return join(getSingularityCLISessionDir(sessionId), 'events.jsonl');
}

export function getSingularityCLIWorkspaceFile(sessionId: string) {
	return join(getSingularityCLISessionDir(sessionId), 'workspace.yaml');
}

/**
 * Path of the shared bulk metadata cache file. This file is shared by all VS Code
 * installs (Stable, Insiders, OSS, Exploration) and the Agents application.
 */
export function getSingularityBulkMetadataFile(): string {
	return join(getSingularityHome(), 'vscode.session.metadata.cache.json');
}
