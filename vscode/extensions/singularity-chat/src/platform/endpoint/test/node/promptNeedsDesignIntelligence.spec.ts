/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { promptNeedsDesignIntelligence } from '../../node/designIntelligence';

describe('promptNeedsDesignIntelligence', () => {
	it('detects html games and canvas UI builds', () => {
		expect(promptNeedsDesignIntelligence('make a snake game in HTML')).toBe(true);
		expect(promptNeedsDesignIntelligence('write a tetris game with canvas')).toBe(true);
		expect(promptNeedsDesignIntelligence('build a pong game in html css js')).toBe(true);
	});

	it('detects product UI and landing work', () => {
		expect(promptNeedsDesignIntelligence('build a landing page for my SaaS')).toBe(true);
		expect(promptNeedsDesignIntelligence('create a react dashboard')).toBe(true);
		expect(promptNeedsDesignIntelligence('polish the hero section')).toBe(true);
	});

	it('skips non-frontend work', () => {
		expect(promptNeedsDesignIntelligence('fix the postgres migration')).toBe(false);
		expect(promptNeedsDesignIntelligence('explain this function')).toBe(false);
		expect(promptNeedsDesignIntelligence('add a REST endpoint for users')).toBe(false);
	});
});
