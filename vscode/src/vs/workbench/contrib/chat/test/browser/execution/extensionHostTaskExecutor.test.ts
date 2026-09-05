/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ExtensionHostTaskExecutor } from '../../../browser/execution/extensionHostTaskExecutor.js';
import { RunSubagentTool } from '../../../common/tools/builtinTools/runSubagentTool.js';
import { MockLanguageModelToolsService } from '../../common/tools/mockLanguageModelToolsService.js';
import type { IToolInvocation, IToolResult } from '../../../common/tools/languageModelToolsService.js';

suite('ExtensionHostTaskExecutor', () => {
	const testDisposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('dispatches parallel tasks with distinct subagent IDs', async () => {
		const mockToolsService = testDisposables.add(new MockLanguageModelToolsService());
		const invokeCalls: string[] = [];
		const mockTool = {
			invoke: async (invocation: IToolInvocation): Promise<IToolResult> => {
				invokeCalls.push(invocation.chatStreamToolCallId ?? invocation.callId);
				await new Promise(resolve => setTimeout(resolve, 25));
				return {
					content: [{ kind: 'text', value: `done ${invocation.callId}` }],
				};
			},
		};

		const instantiationService = testDisposables.add(new TestInstantiationService());
		instantiationService.stubInstance(RunSubagentTool, mockTool);

		const executor = new ExtensionHostTaskExecutor({
			logService: new NullLogService(),
			instantiationService,
			languageModelToolsService: mockToolsService,
			maxConcurrency: 4,
		});

		const baseCtx = {
			executionId: 'exec-1',
			workspaceRoot: '/tmp',
			parentSessionResource: URI.parse('vscode-chat-session://local/test').toString(),
			parentRequestId: 'req-parent',
		};

		const [r1, r2] = await Promise.all([
			executor.executeTask({
				...baseCtx,
				task: {
					id: 'TASK-002',
					title: 'Backend',
					expectedOutput: 'backend',
					ownedPaths: ['backend'],
				},
			}),
			executor.executeTask({
				...baseCtx,
				task: {
					id: 'TASK-003',
					title: 'Frontend',
					expectedOutput: 'frontend',
					ownedPaths: ['frontend'],
				},
			}),
		]);

		assert.strictEqual(r1.ok, true);
		assert.strictEqual(r2.ok, true);
		assert.strictEqual(invokeCalls.length, 2);
		assert.notStrictEqual(invokeCalls[0], invokeCalls[1]);
		assert.ok(invokeCalls[0].includes('TASK-002'));
		assert.ok(invokeCalls[1].includes('TASK-003'));
	});
});
