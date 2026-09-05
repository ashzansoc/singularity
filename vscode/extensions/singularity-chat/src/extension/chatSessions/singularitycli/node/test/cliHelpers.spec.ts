/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { homedir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	getSingularityCliStateDir,
	getSingularityCLISessionStateDir,
	getSingularityHome,
} from '../cliHelpers';

const originalSingularityHome = process.env.SINGULARITY_HOME;
const originalXdgStateHome = process.env.XDG_STATE_HOME;

function setEnv(
	name: 'SINGULARITY_HOME' | 'XDG_STATE_HOME',
	value: string | undefined,
): void {
	if (value === undefined) {
		delete process.env[name];
	} else {
		process.env[name] = value;
	}
}

afterEach(() => {
	setEnv('SINGULARITY_HOME', originalSingularityHome);
	setEnv('XDG_STATE_HOME', originalXdgStateHome);
});

describe('Singularity CLI state directories', () => {
	it('uses SINGULARITY_HOME', () => {
		setEnv('SINGULARITY_HOME', '/tmp/singularity-home');
		setEnv('XDG_STATE_HOME', '/tmp/xdg-state');

		expect(getSingularityHome()).toBe('/tmp/singularity-home');
		expect(getSingularityCliStateDir()).toBe(join('/tmp/singularity-home', 'ide'));
		expect(getSingularityCLISessionStateDir()).toBe(
			join('/tmp/singularity-home', 'session-state'),
		);
	});

	it('does not use the legacy XDG_STATE_HOME location', () => {
		setEnv('SINGULARITY_HOME', undefined);
		setEnv('XDG_STATE_HOME', '/tmp/xdg-state');

		expect(getSingularityHome()).toBe(join(homedir(), '.singularity'));
		expect(getSingularityCliStateDir()).toBe(
			join(homedir(), '.singularity', 'ide'),
		);
		expect(getSingularityCLISessionStateDir()).toBe(
			join(homedir(), '.singularity', 'session-state'),
		);
	});

	it('falls back to the user home directory', () => {
		setEnv('SINGULARITY_HOME', undefined);
		setEnv('XDG_STATE_HOME', undefined);

		expect(getSingularityHome()).toBe(join(homedir(), '.singularity'));
		expect(getSingularityCliStateDir()).toBe(
			join(homedir(), '.singularity', 'ide'),
		);
		expect(getSingularityCLISessionStateDir()).toBe(
			join(homedir(), '.singularity', 'session-state'),
		);
	});
});
