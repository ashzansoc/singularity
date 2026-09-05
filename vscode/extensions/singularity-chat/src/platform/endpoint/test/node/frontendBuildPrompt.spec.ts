/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { promptLooksLikeFrontendBuild } from '../../node/frontendBuildPrompt';

describe('promptLooksLikeFrontendBuild', () => {
	it('detects html games and canvas UI builds', () => {
		expect(promptLooksLikeFrontendBuild('Create a snake game in HTML')).toBe(true);
		expect(promptLooksLikeFrontendBuild('make a snake game in HTML')).toBe(true);
		expect(promptLooksLikeFrontendBuild('write a tetris game with canvas')).toBe(true);
	});

	it('detects product UI work', () => {
		expect(promptLooksLikeFrontendBuild('build a landing page for my SaaS')).toBe(true);
		expect(promptLooksLikeFrontendBuild('create a react dashboard')).toBe(true);
	});

	it('skips non-frontend work', () => {
		expect(promptLooksLikeFrontendBuild('fix the postgres migration')).toBe(false);
		expect(promptLooksLikeFrontendBuild('add a REST endpoint for users')).toBe(false);
	});
});
