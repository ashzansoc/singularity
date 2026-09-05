/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { McpServerInstallState, IWorkbenchMcpServer } from '../../../mcp/common/mcpTypes.js';
import { McpServerType } from '../../../../../platform/mcp/common/mcpPlatformTypes.js';
import { GalleryMcpServerStatus, RegistryType, TransportType } from '../../../../../platform/mcp/common/mcpManagement.js';
import {
	CONNECTORS_VIEW_CONTAINER_ID,
	categorizeConnector,
	decideConnectorsActivity,
	filterConnectors,
	formatAddedLabel,
	inferAuthMethod,
	matchesSearch,
	pickFeatured,
	pickPopular,
	pickRecentlyAdded,
	toConnectorDefinition,
	formatConnectedConnectorsPrompt,
	IConnectorDefinition,
} from '../../common/connectors.js';

function galleryServer(overrides: Partial<IWorkbenchMcpServer> & { name: string; label?: string; description?: string }): IWorkbenchMcpServer {
	return {
		id: overrides.id ?? overrides.name,
		name: overrides.name,
		label: overrides.label ?? overrides.name,
		description: overrides.description ?? '',
		installState: overrides.installState ?? McpServerInstallState.Uninstalled,
		starsCount: overrides.starsCount ?? 0,
		publisherDisplayName: overrides.publisherDisplayName,
		icon: overrides.icon,
		gallery: overrides.gallery ?? {
			name: overrides.name,
			displayName: overrides.label ?? overrides.name,
			description: overrides.description ?? '',
			version: '1.0.0',
			isLatest: true,
			status: GalleryMcpServerStatus.Active,
			publisher: 'acme',
			configuration: {},
		},
		local: undefined,
		installable: undefined,
		runtimeStatus: undefined,
		config: overrides.config,
		getReadme: async () => '',
		getManifest: async () => ({}),
	};
}

function def(server: IWorkbenchMcpServer): IConnectorDefinition {
	return toConnectorDefinition(server);
}

suite('Connectors catalog', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('categorizes by name and description', () => {
		assert.strictEqual(categorizeConnector('GitHub', 'Manage repositories'), 'development');
		assert.strictEqual(categorizeConnector('Sentry', 'production error monitoring'), 'observability');
		assert.strictEqual(categorizeConnector('Slack', 'team chat'), 'communication');
		assert.strictEqual(categorizeConnector('Postgres', 'SQL database'), 'databases');
	});

	test('semantic search matches description not just name', () => {
		const sentry = def(galleryServer({ name: 'sentry', description: 'Monitor production errors' }));
		assert.ok(matchesSearch(sentry, 'production errors'));
		assert.ok(matchesSearch(sentry, 'Sentry'));
		assert.ok(!matchesSearch(sentry, 'figma design'));
	});

	test('category filter keeps matching connectors', () => {
		const items = [
			def(galleryServer({ name: 'github', description: 'git repos' })),
			def(galleryServer({ name: 'sentry', description: 'error monitor' })),
		];
		const filtered = filterConnectors(items, { category: 'observability' });
		assert.strictEqual(filtered.length, 1);
		assert.strictEqual(filtered[0].name, 'sentry');
	});

	test('featured prefers curated slugs when present', () => {
		const items = [
			def(galleryServer({ name: 'obscure-tool', starsCount: 9000 })),
			def(galleryServer({ name: 'github', starsCount: 10 })),
			def(galleryServer({ name: 'slack', starsCount: 5 })),
		];
		const featured = pickFeatured(items, 2);
		assert.deepStrictEqual(featured.map(item => item.name), ['github', 'slack']);
	});

	test('popular sorts by stars', () => {
		const items = [
			def(galleryServer({ name: 'a', starsCount: 2 })),
			def(galleryServer({ name: 'b', starsCount: 40 })),
		];
		assert.strictEqual(pickPopular(items, 1)[0].name, 'b');
	});

	test('recently added sorts by timestamp', () => {
		const older = def(galleryServer({
			name: 'old',
			gallery: {
				name: 'old', displayName: 'old', description: '', version: '1', isLatest: true,
				status: GalleryMcpServerStatus.Active, publisher: 'x', configuration: {}, publishDate: 1,
			},
		}));
		const newer = def(galleryServer({
			name: 'new',
			gallery: {
				name: 'new', displayName: 'new', description: '', version: '1', isLatest: true,
				status: GalleryMcpServerStatus.Active, publisher: 'x', configuration: {}, publishDate: 50,
			},
		}));
		assert.strictEqual(pickRecentlyAdded([older, newer], 1)[0].name, 'new');
	});

	test('formatAddedLabel uses relative days', () => {
		const now = Date.parse('2026-08-16T00:00:00Z');
		const elevenDays = now - 11 * 24 * 60 * 60 * 1000;
		assert.ok(formatAddedLabel(elevenDays, now)?.includes('11'));
	});

	test('infers oauth vs stdio auth', () => {
		const remote = galleryServer({
			name: 'linear',
			config: { type: McpServerType.REMOTE, url: 'https://mcp.linear.app', oauth: {} },
		});
		assert.strictEqual(inferAuthMethod(remote), 'oauth');
		const local = galleryServer({
			name: 'local-db',
			config: { type: McpServerType.LOCAL, command: 'npx' },
		});
		assert.strictEqual(inferAuthMethod(local), 'stdio');
		const packaged = galleryServer({
			name: 'http-pkg',
			gallery: {
				name: 'http-pkg', displayName: 'http-pkg', description: '', version: '1', isLatest: true,
				status: GalleryMcpServerStatus.Active, publisher: 'x',
				configuration: { packages: [{ registryType: RegistryType.REMOTE, identifier: 'x', transport: { type: TransportType.STREAMABLE_HTTP, url: 'https://example.com/mcp' } }] },
			},
		});
		assert.strictEqual(inferAuthMethod(packaged), 'oauth');
	});

	test('connected state comes from install state', () => {
		const connected = def(galleryServer({ name: 'github', installState: McpServerInstallState.Installed }));
		assert.strictEqual(connected.connected, true);
	});

	test('activity bar click opens hub and restores previous sidebar', () => {
		const first = decideConnectorsActivity('workbench.view.explorer', undefined);
		assert.strictEqual(first.openHub, false);
		assert.strictEqual(first.lastNonConnectorsId, 'workbench.view.explorer');

		const click = decideConnectorsActivity(CONNECTORS_VIEW_CONTAINER_ID, first.lastNonConnectorsId);
		assert.strictEqual(click.openHub, true);
		assert.strictEqual(click.restoreId, 'workbench.view.explorer');
	});

	test('connectors as first click restores explorer', () => {
		const click = decideConnectorsActivity(CONNECTORS_VIEW_CONTAINER_ID, undefined);
		assert.strictEqual(click.restoreId, 'workbench.view.explorer');
		assert.ok(click.openHub);
	});

	test('connector chat prompt tells the model to use live tools', () => {
		const prompt = formatConnectedConnectorsPrompt([
			{ label: 'Notion', tools: ['notion-search', 'notion-fetch'] },
		]);
		assert.ok(prompt?.includes('Notion'));
		assert.ok(prompt?.includes('notion-search'));
		assert.ok(prompt?.includes('Do not search mcp.json'));
		assert.strictEqual(formatConnectedConnectorsPrompt([]), undefined);
	});
});
