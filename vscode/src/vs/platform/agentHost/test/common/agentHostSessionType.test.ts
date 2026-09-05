/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { findRemoteAgentHostSessionTypeAuthority, isRemoteAgentHostSessionType, parseRemoteAgentHostHarness, parseRemoteAgentHostSessionTypeAuthority, remoteAgentHostSessionTypeAuthorityPrefix, remoteAgentHostSessionTypeId } from '../../common/agentHostSessionType.js';

suite('agentHostSessionType', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('remoteAgentHostSessionTypeId pins the wire format', () => {
		assert.deepStrictEqual([
			remoteAgentHostSessionTypeId('foo', 'singularity'),
			remoteAgentHostSessionTypeId('10.0.0.1__8080', 'singularity'),
			remoteAgentHostSessionTypeId('foo', 'openai'),
		], [
			'remote-foo-singularity',
			'remote-10.0.0.1__8080-singularity',
			'remote-foo-openai',
		]);
	});

	test('finds the longest matching authority', () => {
		assert.deepStrictEqual([
			remoteAgentHostSessionTypeAuthorityPrefix('foo-bar'),
			isRemoteAgentHostSessionType('remote-foo-bar-singularity'),
			findRemoteAgentHostSessionTypeAuthority('remote-foo-bar-singularity', ['foo', 'foo-bar']),
			findRemoteAgentHostSessionTypeAuthority('remote-foo-bar-singularity', ['baz']),
			findRemoteAgentHostSessionTypeAuthority('agent-host-singularity', ['foo-bar']),
		], [
			'remote-foo-bar-',
			true,
			'foo-bar',
			undefined,
			undefined,
		]);
	});

	test('parses authority when provider is known', () => {
		assert.deepStrictEqual([
			parseRemoteAgentHostSessionTypeAuthority('remote-foo-bar-singularitycli', 'singularitycli'),
			parseRemoteAgentHostSessionTypeAuthority('remote-foo-bar-singularitycli', 'singularity'),
			parseRemoteAgentHostSessionTypeAuthority('agent-host-singularitycli', 'singularitycli'),
			parseRemoteAgentHostSessionTypeAuthority('remote--singularitycli', 'singularitycli'),
		], [
			'foo-bar',
			undefined,
			undefined,
			undefined,
		]);
	});

	test('parses harness from remote session type', () => {
		assert.deepStrictEqual([
			parseRemoteAgentHostHarness('remote-foo-singularitycli'),
			parseRemoteAgentHostHarness('remote-foo-bar-claude'),
			parseRemoteAgentHostHarness('remote-10.0.0.1__8080-codex'),
			parseRemoteAgentHostHarness('vscodeLocalChatSession'),
			parseRemoteAgentHostHarness('remote-'),
		], [
			'singularitycli',
			'claude',
			'codex',
			undefined,
			undefined,
		]);
	});
});
