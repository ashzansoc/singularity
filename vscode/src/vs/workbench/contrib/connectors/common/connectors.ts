/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IWorkbenchMcpServer, McpServerInstallState } from '../../mcp/common/mcpTypes.js';
import { McpServerType } from '../../../../platform/mcp/common/mcpPlatformTypes.js';
import { RegistryType, TransportType } from '../../../../platform/mcp/common/mcpManagement.js';

export const CONNECTORS_VIEW_CONTAINER_ID = 'workbench.view.connectors';
export const CONNECTORS_VIEW_ID = 'workbench.views.connectors';
export const OPEN_CONNECTORS_HUB_COMMAND_ID = 'singularity.connectors.openHub';
export const ADD_CONNECTOR_COMMAND_ID = 'singularity.connectors.add';
export const LIST_CONNECTORS_TOOL_ID = 'singularity_list_connectors';
export const CONNECTOR_REQUESTS_STORAGE_KEY = 'singularity.connectors.requests';

export const CONNECTORS_HUB_SIZE_RATIO = 2 / 3;

export type ConnectorCategoryId =
	| 'all'
	| 'development'
	| 'communication'
	| 'project-management'
	| 'productivity'
	| 'databases'
	| 'cloud'
	| 'devops'
	| 'observability'
	| 'security'
	| 'design'
	| 'analytics'
	| 'crm'
	| 'storage'
	| 'search'
	| 'ai'
	| 'infrastructure';

export interface IConnectorCategory {
	readonly id: ConnectorCategoryId;
	readonly label: string;
}

export const CONNECTOR_CATEGORIES: readonly IConnectorCategory[] = [
	{ id: 'all', label: localize('connectors.category.all', "All") },
	{ id: 'development', label: localize('connectors.category.development', "Development") },
	{ id: 'communication', label: localize('connectors.category.communication', "Communication") },
	{ id: 'project-management', label: localize('connectors.category.projectManagement', "Project Management") },
	{ id: 'productivity', label: localize('connectors.category.productivity', "Productivity") },
	{ id: 'databases', label: localize('connectors.category.databases', "Databases") },
	{ id: 'cloud', label: localize('connectors.category.cloud', "Cloud") },
	{ id: 'devops', label: localize('connectors.category.devops', "DevOps") },
	{ id: 'observability', label: localize('connectors.category.observability', "Observability") },
	{ id: 'security', label: localize('connectors.category.security', "Security") },
	{ id: 'design', label: localize('connectors.category.design', "Design") },
	{ id: 'analytics', label: localize('connectors.category.analytics', "Analytics") },
	{ id: 'crm', label: localize('connectors.category.crm', "CRM") },
	{ id: 'storage', label: localize('connectors.category.storage', "Storage") },
	{ id: 'search', label: localize('connectors.category.search', "Search") },
	{ id: 'ai', label: localize('connectors.category.ai', "AI") },
	{ id: 'infrastructure', label: localize('connectors.category.infrastructure', "Infrastructure") },
];

/**
 * Curated gallery slugs used for the Featured row when present in the registry.
 * These are identifiers, not connector implementations.
 */
export const FEATURED_CONNECTOR_SLUGS: readonly string[] = [
	'github',
	'slack',
	'jira',
	'notion',
	'linear',
	'sentry',
	'gitlab',
	'figma',
	'postgres',
	'postgresql',
	'vercel',
	'cloudflare',
	'docker',
	'kubernetes',
	'datadog',
	'grafana',
	'confluence',
	'google-drive',
	'microsoft-teams',
	'discord',
	'aws',
];

const CATEGORY_KEYWORDS: ReadonlyArray<readonly [ConnectorCategoryId, readonly string[]]> = [
	['development', ['git', 'github', 'gitlab', 'bitbucket', 'code', 'developer', 'repo', 'pull request', 'ide']],
	['communication', ['slack', 'discord', 'teams', 'chat', 'email', 'mail', 'message']],
	['project-management', ['jira', 'linear', 'asana', 'trello', 'clickup', 'issue', 'ticket', 'project']],
	['productivity', ['notion', 'confluence', 'docs', 'wiki', 'notes', 'todo']],
	['databases', ['postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'sqlite', 'sql', 'database']],
	['cloud', ['aws', 'gcp', 'azure', 'cloudflare', 'vercel', 'netlify', 'cloud']],
	['devops', ['docker', 'kubernetes', 'k8s', 'ci', 'cd', 'terraform', 'helm', 'github actions']],
	['observability', ['sentry', 'datadog', 'grafana', 'prometheus', 'new relic', 'log', 'monitor', 'error']],
	['security', ['security', 'auth', 'oauth', 'sso', 'vault', 'secret']],
	['design', ['figma', 'canva', 'sketch', 'design', 'penpot']],
	['analytics', ['analytics', 'amplitude', 'mixpanel', 'segment']],
	['crm', ['salesforce', 'hubspot', 'crm']],
	['storage', ['s3', 'drive', 'dropbox', 'gcs', 'blob', 'storage', 'file']],
	['search', ['elasticsearch', 'algolia', 'search']],
	['ai', ['openai', 'anthropic', 'llm', 'model', 'ai']],
	['infrastructure', ['infra', 'network', 'dns', 'load balancer']],
];

export type ConnectorAuthMethod = 'oauth' | 'token' | 'none' | 'stdio';

export interface IConnectorDefinition {
	readonly id: string;
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly publisher?: string;
	readonly category: ConnectorCategoryId;
	readonly verified: boolean;
	readonly stars: number;
	readonly addedAt?: number;
	readonly connected: boolean;
	readonly connecting: boolean;
	readonly version?: string;
	readonly authMethod: ConnectorAuthMethod;
	readonly icon?: { readonly dark: string; readonly light: string };
	readonly topics: readonly string[];
	readonly server: IWorkbenchMcpServer;
}

export interface IConnectorRequest {
	readonly name: string;
	readonly website?: string;
	readonly useCase?: string;
	readonly requestedAt: number;
}

export interface IConnectorCatalogQuery {
	readonly text?: string;
	readonly category?: ConnectorCategoryId;
}

export function categorizeConnector(name: string, description: string, topics: readonly string[] = []): ConnectorCategoryId {
	const haystack = [name, description, ...topics].join(' ').toLowerCase();
	for (const [category, keywords] of CATEGORY_KEYWORDS) {
		if (keywords.some(keyword => haystack.includes(keyword))) {
			return category;
		}
	}
	return 'development';
}

export function inferAuthMethod(server: IWorkbenchMcpServer): ConnectorAuthMethod {
	const config = server.config;
	if (config?.type === McpServerType.REMOTE) {
		if (config.oauth) {
			return 'oauth';
		}
		if (config.headers && Object.keys(config.headers).length) {
			return 'token';
		}
		return 'none';
	}
	const remotes = server.gallery?.configuration.remotes;
	if (remotes?.length) {
		const hasHeaders = remotes.some(remote => !!remote.headers?.length);
		return hasHeaders ? 'token' : 'oauth';
	}
	const packages = server.gallery?.configuration.packages;
	if (packages?.some(pkg => pkg.registryType === RegistryType.REMOTE || pkg.transport.type === TransportType.STREAMABLE_HTTP || pkg.transport.type === TransportType.SSE)) {
		return 'oauth';
	}
	return 'stdio';
}

export function toConnectorDefinition(server: IWorkbenchMcpServer): IConnectorDefinition {
	const topics = server.gallery?.topics ?? [];
	return {
		id: server.id,
		name: server.name,
		label: server.label || server.name,
		description: server.description,
		publisher: server.publisherDisplayName,
		category: categorizeConnector(server.label || server.name, server.description, topics),
		verified: !!server.gallery?.publisherDomain?.verified,
		stars: server.starsCount ?? 0,
		addedAt: server.gallery?.publishDate ?? server.gallery?.lastUpdated,
		connected: server.installState === McpServerInstallState.Installed,
		connecting: server.installState === McpServerInstallState.Installing,
		version: server.gallery?.version,
		authMethod: inferAuthMethod(server),
		icon: server.icon,
		topics,
		server,
	};
}

export function formatAddedLabel(timestamp: number | undefined, now = Date.now()): string | undefined {
	if (!timestamp) {
		return undefined;
	}
	const delta = Math.max(0, now - timestamp);
	const minutes = Math.floor(delta / 60_000);
	if (minutes < 1) {
		return localize('connectors.added.justNow', "Added just now");
	}
	if (minutes < 60) {
		return localize('connectors.added.minutes', "Added {0} minutes ago", minutes);
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return localize('connectors.added.hours', "Added {0} hours ago", hours);
	}
	const days = Math.floor(hours / 24);
	if (days < 30) {
		return localize('connectors.added.days', "Added {0} days ago", days);
	}
	const months = Math.floor(days / 30);
	return localize('connectors.added.months', "Added {0} months ago", months);
}

export function matchesSearch(connector: IConnectorDefinition, text: string): boolean {
	const query = text.trim().toLowerCase();
	if (!query) {
		return true;
	}
	const haystack = [
		connector.label,
		connector.name,
		connector.description,
		connector.publisher ?? '',
		connector.category,
		...connector.topics,
	].join(' ').toLowerCase();
	return query.split(/\s+/).every(token => haystack.includes(token));
}

export function filterConnectors(connectors: readonly IConnectorDefinition[], query: IConnectorCatalogQuery): IConnectorDefinition[] {
	return connectors.filter(connector => {
		if (query.category && query.category !== 'all' && connector.category !== query.category) {
			return false;
		}
		return matchesSearch(connector, query.text ?? '');
	});
}

export function pickFeatured(connectors: readonly IConnectorDefinition[], limit = 8): IConnectorDefinition[] {
	const bySlug = new Map(connectors.map(connector => [connector.name.toLowerCase(), connector]));
	const featured: IConnectorDefinition[] = [];
	for (const slug of FEATURED_CONNECTOR_SLUGS) {
		const match = bySlug.get(slug) ?? connectors.find(connector => connector.name.toLowerCase().includes(slug) || connector.label.toLowerCase().includes(slug));
		if (match && !featured.includes(match)) {
			featured.push(match);
		}
		if (featured.length >= limit) {
			return featured;
		}
	}
	for (const connector of [...connectors].sort((a, b) => b.stars - a.stars)) {
		if (!featured.includes(connector)) {
			featured.push(connector);
		}
		if (featured.length >= limit) {
			break;
		}
	}
	return featured;
}

export function formatConnectedConnectorsPrompt(items: readonly { label: string; tools: readonly string[] }[]): string | undefined {
	if (!items.length) {
		return undefined;
	}
	const lines = [
		'You already have these Singularity connectors. Call their tools directly. Do not search mcp.json, and do not say you lack access.',
	];
	for (const item of items) {
		lines.push(`- ${item.label}: ${item.tools.length ? item.tools.join(', ') : 'connected (tools still loading — call list_connectors)'}`);
	}
	lines.push('If asked whether you can access a connector, use those tools or call list_connectors. Do not stop after announcing that you will check.');
	return lines.join('\n');
}

export function pickPopular(connectors: readonly IConnectorDefinition[], limit = 8): IConnectorDefinition[] {
	return [...connectors].sort((a, b) => b.stars - a.stars || a.label.localeCompare(b.label)).slice(0, limit);
}

export function pickRecentlyAdded(connectors: readonly IConnectorDefinition[], limit = 8): IConnectorDefinition[] {
	return [...connectors]
		.filter(connector => !!connector.addedAt)
		.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
		.slice(0, limit);
}

export interface IConnectorsActivityDecision {
	readonly lastNonConnectorsId: string | undefined;
	readonly restoreId?: string;
	readonly openHub: boolean;
}

export function decideConnectorsActivity(
	openedId: string,
	lastNonConnectorsId: string | undefined,
	connectorsId = CONNECTORS_VIEW_CONTAINER_ID,
	explorerId = 'workbench.view.explorer',
): IConnectorsActivityDecision {
	if (openedId !== connectorsId) {
		return { lastNonConnectorsId: openedId, openHub: false };
	}
	return {
		lastNonConnectorsId,
		restoreId: lastNonConnectorsId && lastNonConnectorsId !== connectorsId ? lastNonConnectorsId : explorerId,
		openHub: true,
	};
}
