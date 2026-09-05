/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { resolveSingularityConfigSlashSubmit } from '../../../browser/agentSessions/agentHost/singularityConfigSlashSubmitHandler.js';

suite('SingularityConfigSlashSubmitHandler', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('resolves typed config slash commands', () => {
		assert.deepStrictEqual({
			yoloOn: resolveSingularityConfigSlashSubmit('/yolo on'),
			yoloOff: resolveSingularityConfigSlashSubmit('/yolo off'),
			yoloInvalid: resolveSingularityConfigSlashSubmit('/yolo onxxxcva'),
			planPrompt: resolveSingularityConfigSlashSubmit('/plan implement this'),
			unknown: resolveSingularityConfigSlashSubmit('/not-a-config-command'),
		}, {
			yoloOn: { applyConfig: { autoApprove: 'autoApprove' }, strippedPrompt: '' },
			yoloOff: { applyConfig: { autoApprove: 'default' }, strippedPrompt: '' },
			yoloInvalid: undefined,
			planPrompt: { applyConfig: { mode: 'plan' }, strippedPrompt: 'implement this' },
			unknown: undefined,
		});
	});
});
