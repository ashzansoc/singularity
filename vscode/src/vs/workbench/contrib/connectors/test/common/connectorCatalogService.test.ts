/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IStorageService, InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { GalleryMcpServerStatus } from '../../../../../platform/mcp/common/mcpManagement.js';
import { IMcpWorkbenchService, IWorkbenchMcpServer, McpServerInstallState } from '../../../mcp/common/mcpTypes.js';
import { ConnectorCatalogService } from '../../common/connectorCatalogService.js';

suite('ConnectorCatalogService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createServer(name: string, installed = false): IWorkbenchMcpServer {
		return {
			id: name,
			name,
			label: name,
			description: `${name} connector`,
			installState: installed ? McpServerInstallState.Installed : McpServerInstallState.Uninstalled,
			starsCount: 3,
			gallery: {
				name, displayName: name, description: `${name} connector`, version: '1.0.0',
				isLatest: true, status: GalleryMcpServerStatus.Active, publisher: 'acme', configuration: {},
				topics: name === 'sentry' ? ['monitor', 'error'] : ['git'],
			},
			local: undefined,
			installable: undefined,
			runtimeStatus: undefined,
			getReadme: async () => '',
			getManifest: async () => ({}),
		} as IWorkbenchMcpServer;
	}

	test('query normalizes gallery servers and getInstalled returns connected connectors', async () => {
		const github = createServer('github');
		const sentry = createServer('sentry', true);
		const onChange = store.add(new Emitter<IWorkbenchMcpServer | undefined>());
		let galleryCalls = 0;
		const mcp = new class extends mock<IMcpWorkbenchService>() {
			override readonly onChange = onChange.event;
			override readonly onReset = Event.None;
			override readonly local = [sentry];
			override async queryGallery() {
				galleryCalls++;
				return {
					firstPage: { items: [github, sentry], hasMore: false },
					getNextPage: async () => ({ items: [], hasMore: false }),
				};
			}
		};
		const instantiation = store.add(new TestInstantiationService());
		instantiation.stub(IMcpWorkbenchService, mcp);
		instantiation.stub(IStorageService, store.add(new InMemoryStorageService()));
		const catalog = store.add(instantiation.createInstance(ConnectorCatalogService));

		const page = await catalog.query();
		assert.strictEqual(page.items.length, 2);
		assert.ok(page.items.every(item => item.label && item.category));
		assert.strictEqual(catalog.getInstalled()[0].connected, true);

		let current = page;
		while (current.hasMore) {
			current = await current.getNextPage();
		}
		assert.strictEqual(current.items.length, 2);
		assert.ok(galleryCalls >= 1);

		catalog.addRequest({ name: 'Acme', website: 'https://acme.example', useCase: 'deploy' });
		assert.strictEqual(catalog.listRequests().length, 1);
		assert.strictEqual(catalog.listRequests()[0].name, 'Acme');
	});

	test('browse sync pages through the full registry', async () => {
		const page1 = [createServer('alpha'), createServer('beta')];
		const page2 = [createServer('gamma')];
		const onChange = store.add(new Emitter<IWorkbenchMcpServer | undefined>());
		const mcp = new class extends mock<IMcpWorkbenchService>() {
			override readonly onChange = onChange.event;
			override readonly onReset = Event.None;
			override readonly local = [];
			override async queryGallery() {
				return {
					firstPage: { items: page1, hasMore: true },
					getNextPage: async () => ({ items: page2, hasMore: false }),
				};
			}
		};
		const instantiation = store.add(new TestInstantiationService());
		instantiation.stub(IMcpWorkbenchService, mcp);
		instantiation.stub(IStorageService, store.add(new InMemoryStorageService()));
		const catalog = store.add(instantiation.createInstance(ConnectorCatalogService));

		const first = await catalog.query();
		assert.ok(first.items.length >= 2);
		let current = first;
		while (current.hasMore) {
			current = await current.getNextPage();
		}
		assert.strictEqual(current.items.length, 3);
		assert.deepStrictEqual(current.items.map(i => i.name).sort(), ['alpha', 'beta', 'gamma']);
	});
});
