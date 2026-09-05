/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IIterativePage } from '../../../../base/common/paging.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IMcpWorkbenchService, IWorkbenchMcpServer } from '../../mcp/common/mcpTypes.js';
import { CONNECTOR_REQUESTS_STORAGE_KEY, IConnectorCatalogQuery, IConnectorDefinition, IConnectorRequest, filterConnectors, toConnectorDefinition } from './connectors.js';
import { CONNECTOR_CUSTOM_ICONS_STORAGE_KEY, ConnectorCustomIconMap, IConnectorCustomIcon } from './connectorsCustomMcp.js';

export const IConnectorCatalogService = createDecorator<IConnectorCatalogService>('connectorCatalogService');

/** Aggregator-style cache: scrape infrequently, serve locally. See MCP Registry aggregator docs. */
const BROWSE_CATALOG_TTL_MS = 60 * 60 * 1000;
const SEARCH_QUERY_TTL_MS = 5 * 60 * 1000;
export const CONNECTOR_BROWSE_SYNC_STORAGE_KEY = 'singularity.connectors.browseSyncMeta';

export interface IConnectorCatalogPage {
	readonly items: readonly IConnectorDefinition[];
	readonly hasMore: boolean;
	getNextPage(token?: CancellationToken): Promise<IConnectorCatalogPage>;
}

export interface IConnectorCatalogService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	query(options?: IConnectorCatalogQuery, token?: CancellationToken): Promise<IConnectorCatalogPage>;
	getInstalled(): IConnectorDefinition[];
	getById(id: string): IConnectorDefinition | undefined;
	listRequests(): IConnectorRequest[];
	addRequest(request: Omit<IConnectorRequest, 'requestedAt'>): IConnectorRequest;
	getCustomIcon(serverName: string): IConnectorCustomIcon | undefined;
	setCustomIcon(serverName: string, icon: IConnectorCustomIcon): void;
}

interface ICachedSearchQuery {
	readonly key: string;
	readonly fetchedAt: number;
	readonly page: IConnectorCatalogPage;
}

export class ConnectorCatalogService extends Disposable implements IConnectorCatalogService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private cache: IConnectorDefinition[] = [];
	/** Full official-registry browse catalog (latest versions only). */
	private browseCatalog: IConnectorDefinition[] = [];
	private browseComplete = false;
	private browseSyncedAt = 0;
	private browseSync: Promise<void> | undefined;
	private searchCache: ICachedSearchQuery | undefined;
	private inFlightSearch: { readonly key: string; readonly promise: Promise<IConnectorCatalogPage> } | undefined;

	constructor(
		@IMcpWorkbenchService private readonly mcpWorkbenchService: IMcpWorkbenchService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this._register(this.mcpWorkbenchService.onChange(() => {
			this.cache = this.refreshInstalledState(this.cache);
			this.browseCatalog = this.refreshInstalledState(this.browseCatalog);
			if (this.searchCache) {
				this.searchCache = {
					...this.searchCache,
					page: {
						...this.searchCache.page,
						items: this.refreshInstalledState(this.searchCache.page.items),
					},
				};
			}
			this._onDidChange.fire();
		}));
		this._register(this.mcpWorkbenchService.onReset(() => {
			this.browseCatalog = [];
			this.browseComplete = false;
			this.browseSyncedAt = 0;
			this.browseSync = undefined;
			this.searchCache = undefined;
			this.inFlightSearch = undefined;
			this._onDidChange.fire();
		}));
	}

	getInstalled(): IConnectorDefinition[] {
		return this.mcpWorkbenchService.local.map(server => this.withCustomIcon(toConnectorDefinition(server)));
	}

	getById(id: string): IConnectorDefinition | undefined {
		return this.cache.find(item => item.id === id)
			?? this.browseCatalog.find(item => item.id === id)
			?? this.getInstalled().find(item => item.id === id);
	}

	async query(options: IConnectorCatalogQuery = {}, token?: CancellationToken): Promise<IConnectorCatalogPage> {
		const text = options.text?.trim();
		if (text) {
			return this.querySearch(options, text, token);
		}
		return this.queryBrowse(options, token);
	}

	private async queryBrowse(options: IConnectorCatalogQuery, token?: CancellationToken): Promise<IConnectorCatalogPage> {
		const fresh = this.browseComplete && Date.now() - this.browseSyncedAt < BROWSE_CATALOG_TTL_MS;
		if (!fresh) {
			void this.ensureBrowseSync(token);
		}
		if (!this.browseCatalog.length) {
			await this.waitForFirstBrowsePage(token);
		}
		return this.asLocalPage(filterConnectors(this.browseCatalog, { category: options.category }), !this.browseComplete);
	}

	private async querySearch(options: IConnectorCatalogQuery, text: string, token?: CancellationToken): Promise<IConnectorCatalogPage> {
		// Prefer the local full catalog once synced — avoids another registry search round-trip.
		if (this.browseComplete && Date.now() - this.browseSyncedAt < BROWSE_CATALOG_TTL_MS) {
			return this.asLocalPage(filterConnectors(this.browseCatalog, { text, category: options.category }), false);
		}

		const key = this.cacheKey(options);
		const cached = this.searchCache;
		if (cached && cached.key === key && Date.now() - cached.fetchedAt < SEARCH_QUERY_TTL_MS) {
			return cached.page;
		}
		if (this.inFlightSearch?.key === key) {
			return this.inFlightSearch.promise;
		}

		const promise = this.fetchSearch(options, token).finally(() => {
			if (this.inFlightSearch?.promise === promise) {
				this.inFlightSearch = undefined;
			}
		});
		this.inFlightSearch = { key, promise };
		void this.ensureBrowseSync(token);
		return promise;
	}

	private async fetchSearch(options: IConnectorCatalogQuery, token?: CancellationToken): Promise<IConnectorCatalogPage> {
		const pager = await this.mcpWorkbenchService.queryGallery({ text: options.text }, token);
		const wrap = (page: IIterativePage<IWorkbenchMcpServer>): IConnectorCatalogPage => {
			const mapped = page.items.map(toConnectorDefinition);
			this.mergeCache(mapped);
			return {
				items: filterConnectors(this.dedupe(mapped), { category: options.category }),
				hasMore: page.hasMore,
				getNextPage: async (nextToken?: CancellationToken) => wrap(await pager.getNextPage(nextToken ?? CancellationToken.None)),
			};
		};
		const result = wrap(pager.firstPage);
		this.searchCache = {
			key: this.cacheKey(options),
			fetchedAt: Date.now(),
			page: result,
		};
		return result;
	}

	private ensureBrowseSync(token?: CancellationToken): Promise<void> {
		if (this.browseComplete && Date.now() - this.browseSyncedAt < BROWSE_CATALOG_TTL_MS) {
			return Promise.resolve();
		}
		if (this.browseSync) {
			return this.browseSync;
		}
		this.browseSync = this.syncBrowseCatalog(token).finally(() => {
			this.browseSync = undefined;
		});
		return this.browseSync;
	}

	private async waitForFirstBrowsePage(token?: CancellationToken): Promise<void> {
		void this.ensureBrowseSync(token);
		if (this.browseCatalog.length || this.browseComplete) {
			return;
		}
		await new Promise<void>(resolve => {
			const listener = this.onDidChange(() => {
				if (this.browseCatalog.length || this.browseComplete) {
					listener.dispose();
					resolve();
				}
			});
			if (this.browseCatalog.length || this.browseComplete) {
				listener.dispose();
				resolve();
			}
		});
	}

	private async syncBrowseCatalog(token?: CancellationToken): Promise<void> {
		const pager = await this.mcpWorkbenchService.queryGallery({}, token);
		const collected: IConnectorDefinition[] = [];
		let page: IIterativePage<IWorkbenchMcpServer> = pager.firstPage;
		for (; ;) {
			if (token?.isCancellationRequested) {
				return;
			}
			const mapped = page.items.map(toConnectorDefinition);
			collected.push(...mapped);
			this.mergeCache(mapped);
			this.browseCatalog = this.dedupe(collected);
			this.browseComplete = false;
			this._onDidChange.fire();
			if (!page.hasMore) {
				break;
			}
			page = await pager.getNextPage(token ?? CancellationToken.None);
		}
		this.browseCatalog = this.dedupe(collected);
		this.browseComplete = true;
		this.browseSyncedAt = Date.now();
		this.storageService.store(CONNECTOR_BROWSE_SYNC_STORAGE_KEY, JSON.stringify({
			syncedAt: this.browseSyncedAt,
			count: this.browseCatalog.length,
			source: 'https://registry.modelcontextprotocol.io',
		}), StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	private asLocalPage(items: readonly IConnectorDefinition[], hasMore: boolean): IConnectorCatalogPage {
		return {
			items,
			hasMore,
			getNextPage: async () => {
				if (!hasMore) {
					return this.asLocalPage(items, false);
				}
				await this.waitForBrowseGrowth(items.length);
				return this.asLocalPage(this.browseCatalog, !this.browseComplete);
			},
		};
	}

	private async waitForBrowseGrowth(previousLength: number): Promise<void> {
		if (this.browseComplete || this.browseCatalog.length > previousLength) {
			return;
		}
		await new Promise<void>(resolve => {
			const listener = this.onDidChange(() => {
				if (this.browseComplete || this.browseCatalog.length > previousLength) {
					listener.dispose();
					resolve();
				}
			});
			if (this.browseComplete || this.browseCatalog.length > previousLength) {
				listener.dispose();
				resolve();
			}
		});
	}

	private cacheKey(options: IConnectorCatalogQuery): string {
		return `${options.text?.trim().toLowerCase() ?? ''}|${options.category ?? 'all'}`;
	}

	private refreshInstalledState(items: readonly IConnectorDefinition[]): IConnectorDefinition[] {
		return items.map(item => {
			const updated = this.mcpWorkbenchService.local.find(local => local.id === item.id || local.name === item.name);
			return updated ? toConnectorDefinition(updated) : item;
		});
	}

	private dedupe(items: readonly IConnectorDefinition[]): IConnectorDefinition[] {
		const byId = new Map<string, IConnectorDefinition>();
		for (const item of items) {
			if (!byId.has(item.id)) {
				byId.set(item.id, item);
			}
		}
		return [...byId.values()];
	}

	listRequests(): IConnectorRequest[] {
		try {
			const raw = this.storageService.get(CONNECTOR_REQUESTS_STORAGE_KEY, StorageScope.APPLICATION);
			return raw ? JSON.parse(raw) as IConnectorRequest[] : [];
		} catch {
			return [];
		}
	}

	addRequest(request: Omit<IConnectorRequest, 'requestedAt'>): IConnectorRequest {
		const entry: IConnectorRequest = { ...request, requestedAt: Date.now() };
		const next = [...this.listRequests(), entry];
		this.storageService.store(CONNECTOR_REQUESTS_STORAGE_KEY, JSON.stringify(next), StorageScope.APPLICATION, StorageTarget.MACHINE);
		return entry;
	}

	getCustomIcon(serverName: string): IConnectorCustomIcon | undefined {
		return this.readCustomIcons()[serverName];
	}

	setCustomIcon(serverName: string, icon: IConnectorCustomIcon): void {
		const next = { ...this.readCustomIcons(), [serverName]: icon };
		this.storageService.store(CONNECTOR_CUSTOM_ICONS_STORAGE_KEY, JSON.stringify(next), StorageScope.APPLICATION, StorageTarget.MACHINE);
		this._onDidChange.fire();
	}

	private readCustomIcons(): ConnectorCustomIconMap {
		try {
			const raw = this.storageService.get(CONNECTOR_CUSTOM_ICONS_STORAGE_KEY, StorageScope.APPLICATION);
			return raw ? JSON.parse(raw) as ConnectorCustomIconMap : {};
		} catch {
			return {};
		}
	}

	private withCustomIcon(item: IConnectorDefinition): IConnectorDefinition {
		if (item.icon) {
			return item;
		}
		const custom = this.getCustomIcon(item.name) ?? this.getCustomIcon(item.label);
		return custom ? { ...item, icon: { dark: custom.dark, light: custom.light ?? custom.dark } } : item;
	}

	private mergeCache(items: readonly IConnectorDefinition[]): void {
		const byId = new Map(this.cache.map(item => [item.id, item]));
		for (const item of items) {
			byId.set(item.id, item);
		}
		this.cache = [...byId.values()];
	}
}
