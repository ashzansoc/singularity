/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getMcpServerMatchKeywords, mcpServerMatchesUserMessage } from '../../common/mcpKeywordFilter.js';
import { IMcpServer } from '../../common/mcpTypes.js';

function mockServer(label: string, id: string): IMcpServer {
	return {
		definition: { id, label },
	} as IMcpServer;
}

suite('mcpKeywordFilter', () => {

	test('figma server matches only when message mentions figma', () => {
		const figma = mockServer('Figma', 'user-figma-mcp');
		assert.strictEqual(mcpServerMatchesUserMessage(figma, 'Hello'), false);
		assert.strictEqual(mcpServerMatchesUserMessage(figma, 'pull assets from figma'), true);
		assert.strictEqual(mcpServerMatchesUserMessage(figma, 'open my Figma file'), true);
	});

	test('slack server does not match hello', () => {
		const slack = mockServer('Slack', 'user-slack');
		assert.strictEqual(mcpServerMatchesUserMessage(slack, 'Hello'), false);
		assert.strictEqual(mcpServerMatchesUserMessage(slack, 'post this to slack'), true);
	});

	test('getMcpServerMatchKeywords includes known connector slugs from identity', () => {
		const keywords = getMcpServerMatchKeywords(mockServer('GitHub', 'github-mcp-server'));
		assert.ok(keywords.includes('github'));
	});

	test('custom server matches on label token', () => {
		const custom = mockServer('Acme Widgets', 'workspace-acme-widgets');
		assert.strictEqual(mcpServerMatchesUserMessage(custom, 'use acme widgets api'), true);
		assert.strictEqual(mcpServerMatchesUserMessage(custom, 'hello'), false);
	});
});
