/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { GITHUB_SINGULARITY_PROTECTED_RESOURCE } from '../../../../../../platform/agentHost/common/agentService.js';
import type { AgentInfo } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import type { ProtectedResourceMetadata } from '../../../../../../platform/agentHost/common/state/protocol/state.js';
import { resolveAgentAuthRequirement } from '../../browser/baseAgentHostSessionsProvider.js';
import { SessionTypeAuthRequirement } from '../../../../../services/sessions/common/session.js';

function agent(protectedResources: ProtectedResourceMetadata[] | undefined, modelCount: number): AgentInfo {
	return {
		provider: 'claude',
		displayName: 'Claude',
		description: '',
		models: Array.from({ length: modelCount }, (_, i) => ({ id: `m${i}` })),
		protectedResources,
	} as AgentInfo;
}

const singularityRequired = GITHUB_SINGULARITY_PROTECTED_RESOURCE;
const singularityOptional: ProtectedResourceMetadata = { ...GITHUB_SINGULARITY_PROTECTED_RESOURCE, required: false };

suite('Agent Host - session type auth requirement', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('an agent is only usable without GitHub when it drops the requirement AND has models', () => {
		// Independent source of truth. The `unusable` row is the one that matters:
		// Claude pinned to native by an explicit `claudeUseSingularityProxy: false`
		// with no credentials still advertises the Singularity resource as
		// `required: false`, so the requirement alone would wrongly read as
		// "usable without GitHub". Its empty model catalog is what distinguishes
		// it. See the amendment in docs/adr/0001-conditional-agent-window-auth.md.
		const cases = [
			{ name: 'unresolved (no resources yet)', agent: agent(undefined, 4) },
			{ name: 'proxy: Singularity required', agent: agent([singularityRequired], 4) },
			{ name: 'proxy: required, no models', agent: agent([singularityRequired], 0) },
			{ name: 'native with credentials', agent: agent([singularityOptional], 4) },
			{ name: 'native WITHOUT credentials', agent: agent([singularityOptional], 0) },
		];

		assert.deepStrictEqual(
			cases.map(c => `${c.name}: ${resolveAgentAuthRequirement(c.agent)}`),
			[
				'unresolved (no resources yet): github',
				'proxy: Singularity required: github',
				'proxy: required, no models: github',
				'native with credentials: none',
				'native WITHOUT credentials: unusable',
			],
		);
	});

	test('only `none` counts as usable without GitHub', () => {
		// The window gate counts `none` only, so `unusable` never holds the
		// window open and never triggers the discovered-config nudge.
		const usable = [
			SessionTypeAuthRequirement.None,
			SessionTypeAuthRequirement.GitHub,
			SessionTypeAuthRequirement.Unusable,
		].map(r => r === SessionTypeAuthRequirement.None);

		assert.deepStrictEqual(usable, [true, false, false]);
	});
});
