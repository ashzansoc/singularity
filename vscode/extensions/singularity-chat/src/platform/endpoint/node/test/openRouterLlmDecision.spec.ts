/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { OpenRouterLlmDecisionEngine } from '../../node/openRouterLlmDecision';

process.env.SINGULARITY_NEMOTRON_ROUTER = '0';

suite('OpenRouterLlmDecisionEngine keyword Flash vs Pro', () => {
	test('uses Flash-0731 for first-lead understanding and architecture (Pro disabled)', async () => {
		const engine = new OpenRouterLlmDecisionEngine();
		const understand = await engine.decide({
			prompt: 'Understand this codebase and take the first lead on the architecture',
		}, 'kw-pro-1');
		assert.strictEqual(understand.modelId, 'deepseek/deepseek-v4-flash-0731');

		const arch = await engine.decide({
			prompt: 'Redesign the architecture of the auth module',
			previousModelId: 'deepseek/deepseek-v4-flash-0731',
			turnCount: 4,
		}, 'kw-pro-2');
		assert.strictEqual(arch.modelId, 'deepseek/deepseek-v4-flash-0731');

		const first = await engine.decide({
			prompt: 'Build a React landing page with Syne typography',
		}, 'kw-pro-3');
		assert.strictEqual(first.modelId, 'deepseek/deepseek-v4-flash-0731');
	});

	test('Flash for follow-ups, bugs, and small UI tweaks', async () => {
		const engine = new OpenRouterLlmDecisionEngine();
		const color = await engine.decide({
			prompt: 'change the button color to blue',
			previousModelId: 'deepseek/deepseek-v4-pro-0813',
			turnCount: 3,
		}, 'kw-flash-1');
		assert.strictEqual(color.modelId, 'deepseek/deepseek-v4-flash-0731');

		const bug = await engine.decide({
			prompt: 'find the bug in this function',
			previousModelId: 'deepseek/deepseek-v4-pro-0813',
			turnCount: 2,
		}, 'kw-flash-2');
		assert.strictEqual(bug.modelId, 'deepseek/deepseek-v4-flash-0731');

		const follow = await engine.decide({
			prompt: 'continue implementing the landing page hero',
			previousModelId: 'deepseek/deepseek-v4-pro-0813',
			turnCount: 2,
		}, 'kw-flash-3');
		assert.strictEqual(follow.modelId, 'deepseek/deepseek-v4-flash-0731');
	});

	test('coalesces parallel decide calls for the same conversation+prompt', async () => {
		const logs: string[] = [];
		const engine = new OpenRouterLlmDecisionEngine((m) => logs.push(m));
		const input = {
			prompt: 'Build a React landing page with Syne typography',
			previousModelId: undefined as string | undefined,
		};
		const [a, b, c] = await Promise.all([
			engine.decide(input, 'coalesce-conv'),
			engine.decide(input, 'coalesce-conv'),
			engine.decide(input, 'coalesce-conv'),
		]);
		assert.strictEqual(a.modelId, b.modelId);
		assert.strictEqual(b.modelId, c.modelId);
		assert.ok(
			logs.some((l) => l.includes('coalesce')),
			`expected coalesce log, got: ${logs.join(' | ')}`,
		);
	});
});
