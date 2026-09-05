/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { McpServerType } from '../../../../../platform/mcp/common/mcpPlatformTypes.js';
import {
	isParsedCustomMcpError,
	parseCustomMcpJson,
	resolveCustomMcpLogoUrl,
	suggestConnectorId,
} from '../../common/connectorsCustomMcp.js';

suite('connectorsCustomMcp', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses bare http config', () => {
		const parsed = parseCustomMcpJson(`{ "type": "http", "url": "https://mcp.notion.com/mcp" }`);
		assert.ok(!isParsedCustomMcpError(parsed));
		if (isParsedCustomMcpError(parsed)) {
			return;
		}
		assert.strictEqual(parsed.config.type, McpServerType.REMOTE);
		assert.strictEqual(parsed.config.type === McpServerType.REMOTE && parsed.config.url, 'https://mcp.notion.com/mcp');
	});

	test('parses stdio from command without type', () => {
		const parsed = parseCustomMcpJson(`{ "command": "npx", "args": ["-y", "server"] }`);
		assert.ok(!isParsedCustomMcpError(parsed));
		if (isParsedCustomMcpError(parsed)) {
			return;
		}
		assert.strictEqual(parsed.config.type, McpServerType.LOCAL);
	});

	test('parses servers map and suggests id', () => {
		const parsed = parseCustomMcpJson(`{
			"servers": {
				"acme": { "type": "stdio", "command": "node", "args": ["server.js"] }
			}
		}`);
		assert.ok(!isParsedCustomMcpError(parsed));
		if (isParsedCustomMcpError(parsed)) {
			return;
		}
		assert.strictEqual(parsed.name, 'acme');
		assert.strictEqual(suggestConnectorId('Acme Deploy'), 'acme-deploy');
	});

	test('rewrites mcp-remote stdio to native http and resolves canva favicon', () => {
		const parsed = parseCustomMcpJson(`{
			"servers": {
				"Canva": {
					"type": "stdio",
					"command": "npx",
					"args": ["-y", "mcp-remote@latest", "https://mcp.canva.com/mcp"]
				}
			}
		}`);
		assert.ok(!isParsedCustomMcpError(parsed));
		if (isParsedCustomMcpError(parsed)) {
			return;
		}
		assert.strictEqual(parsed.config.type, McpServerType.REMOTE);
		assert.ok(parsed.config.type === McpServerType.REMOTE && parsed.config.url === 'https://mcp.canva.com/mcp');
		const logo = resolveCustomMcpLogoUrl({ name: 'Canva', config: parsed.config });
		assert.ok(logo?.dark.includes('canva.com'));
	});

	test('prefers gallery icon over favicon', () => {
		const logo = resolveCustomMcpLogoUrl({
			config: { type: McpServerType.REMOTE, url: 'https://mcp.notion.com/mcp' },
			galleryIcon: { dark: 'https://cdn.example/notion.png' },
		});
		assert.strictEqual(logo?.dark, 'https://cdn.example/notion.png');
	});
});
