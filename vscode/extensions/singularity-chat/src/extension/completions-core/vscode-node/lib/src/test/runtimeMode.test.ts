/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	RuntimeMode
} from '../util/runtimeMode';

suite('RuntimeMode', function () {
	suite('environment variable precedence', function () {
		test('looks for a GH_SINGULARITY_ variable', function () {
			const runtime = RuntimeMode.fromEnvironment(false, [], { GH_SINGULARITY_DEBUG: '1' });
			assert.strictEqual(runtime.flags.debug, true);
		});

		test('looks for a GITHUB_SINGULARITY_ variable', function () {
			const runtime = RuntimeMode.fromEnvironment(false, [], { GITHUB_SINGULARITY_DEBUG: '1' });
			assert.strictEqual(runtime.flags.debug, true);
		});

		test('gives precedence to GH_SINGULARITY_ variable if both are set', function () {
			const runtime = RuntimeMode.fromEnvironment(false, [], {
				GH_SINGULARITY_DEBUG: '0',
				GITHUB_SINGULARITY_DEBUG: '1',
			});

			assert.strictEqual(runtime.flags.debug, false);
		});
	});

	[true, false].forEach(inTest => {
		test(`isRunningInTest is set to ${inTest}`, function () {
			assert.strictEqual(RuntimeMode.fromEnvironment(inTest).isRunningInTest(), inTest);
		});
	});

	test('shouldFailForDebugPurposes is enabled by isRunningInTest', function () {
		assert.strictEqual(RuntimeMode.fromEnvironment(true).shouldFailForDebugPurposes(), true);
	});

	suite('isVerboseLoggingEnabled', function () {
		[
			'GH_SINGULARITY_DEBUG',
			'GITHUB_SINGULARITY_DEBUG',
			'GH_SINGULARITY_VERBOSE',
			'GITHUB_SINGULARITY_VERBOSE',
			'SINGULARITY_AGENT_VERBOSE',
		].forEach(key => {
			['1', 'true', 'TRUE'].forEach(value => {
				test(`is enabled by ${key}=${value}`, function () {
					assert.strictEqual(RuntimeMode.fromEnvironment(false, [], { [key]: value }).isVerboseLoggingEnabled(), true);
				});
			});
		});

		test('is enabled by --debug flag', function () {
			assert.strictEqual(RuntimeMode.fromEnvironment(false, ['--debug'], {}).isVerboseLoggingEnabled(), true);
		});

		test('is disabled by default', function () {
			assert.strictEqual(RuntimeMode.fromEnvironment(false, [], {}).isVerboseLoggingEnabled(), false);
		});
	});

	suite('isDebugEnabled', function () {
		['GH_SINGULARITY_DEBUG', 'GITHUB_SINGULARITY_DEBUG'].forEach(key => {
			['1', 'true', 'TRUE'].forEach(value => {
				test(`is enabled by ${key}=${value}`, function () {
					assert.strictEqual(RuntimeMode.fromEnvironment(false, [], { [key]: value }).isDebugEnabled(), true);
				});
			});
		});

		test('is enabled by --debug flag', function () {
			assert.strictEqual(RuntimeMode.fromEnvironment(false, ['--debug'], {}).isDebugEnabled(), true);
		});

		test('is disabled by default', function () {
			assert.strictEqual(RuntimeMode.fromEnvironment(false, [], {}).isDebugEnabled(), false);
		});
	});
});
