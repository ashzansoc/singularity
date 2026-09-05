/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { join } from '../../../../base/common/path.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getSingularityHomePath, getSingularityRootPaths } from '../../common/singularityHome.js';

suite('singularityHome', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('resolves the configured or default Singularity home', () => {
		assert.deepStrictEqual([
			getSingularityHomePath('user-home', {}),
			getSingularityHomePath('user-home', { SINGULARITY_HOME: 'custom-singularity' }),
			getSingularityHomePath('user-home', { XDG_STATE_HOME: 'legacy-state-home' }),
		], [
			join('user-home', '.singularity'),
			'custom-singularity',
			join('user-home', '.singularity'),
		]);
	});

	test('resolves all Singularity roots', () => {
		assert.deepStrictEqual([
			getSingularityRootPaths('user-home', {}),
			getSingularityRootPaths('user-home', { SINGULARITY_HOME: 'custom-singularity' }),
		], [
			[join('user-home', '.singularity')],
			['custom-singularity', join('user-home', '.singularity')],
		]);
	});
});
