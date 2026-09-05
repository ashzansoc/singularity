/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { EditorInputCapabilities } from '../../../../common/editor.js';
import { CONNECTORS_HUB_SIZE_RATIO } from '../../common/connectors.js';
import { ConnectorsHubEditorInput } from '../../browser/connectorsHubEditorInput.js';

suite('ConnectorsHubEditorInput', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('opens as a blurred two-thirds modal', () => {
		const input = store.add(new ConnectorsHubEditorInput());
		assert.ok(input.hasCapability(EditorInputCapabilities.RequiresModal));
		assert.ok(input.hasCapability(EditorInputCapabilities.Singleton));
		const options = input.getModalEditorOptions();
		assert.strictEqual(options?.backdropBlur, true);
		assert.strictEqual(options?.sizeRatio, CONNECTORS_HUB_SIZE_RATIO);
		assert.strictEqual(options?.compactHeader, true);
	});
});
