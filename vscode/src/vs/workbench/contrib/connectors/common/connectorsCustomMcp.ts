/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse as parseJsonc } from '../../../../base/common/jsonc.js';
import { URI } from '../../../../base/common/uri.js';
import { IMcpServerConfiguration, IMcpServerVariable, McpServerType } from '../../../../platform/mcp/common/mcpPlatformTypes.js';

export const CONNECTOR_CUSTOM_ICONS_STORAGE_KEY = 'singularity.connectors.customIcons';

export interface IConnectorCustomIcon {
	readonly dark: string;
	readonly light?: string;
}

export type ConnectorCustomIconMap = Record<string, IConnectorCustomIcon>;

export interface IParsedCustomMcp {
	readonly name?: string;
	readonly config: IMcpServerConfiguration;
	readonly inputs?: IMcpServerVariable[];
	/** Logo URL discovered from the pasted JSON (icons / remotes / packages). */
	readonly logoHint?: string;
}

export interface IParsedCustomMcpError {
	readonly error: string;
}

export function isParsedCustomMcpError(value: IParsedCustomMcp | IParsedCustomMcpError): value is IParsedCustomMcpError {
	return 'error' in value;
}

/**
 * Accepts common paste shapes:
 * - bare server config `{ "type":"http", "url":"…" }` / `{ "command":"npx", … }`
 * - install payload `{ "name", "config"?, …config, "inputs"? }`
 * - VS Code mcp.json `{ "servers": { "id": {…} }, "inputs"? }`
 * - Claude/Cursor `{ "mcpServers": { "id": {…} } }`
 */
export function parseCustomMcpJson(raw: string): IParsedCustomMcp | IParsedCustomMcpError {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { error: 'Paste an MCP server JSON configuration.' };
	}

	let parsed: unknown;
	try {
		parsed = parseJsonc(trimmed);
	} catch {
		return { error: 'Invalid JSON. Check for missing commas or quotes.' };
	}

	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { error: 'JSON must be an object.' };
	}

	const root = parsed as Record<string, unknown>;
	const logoHint = extractLogoHint(root);

	const serversBag = asServerMap(root.servers) ?? asServerMap(root.mcpServers);
	if (serversBag) {
		const entries = Object.entries(serversBag);
		if (!entries.length) {
			return { error: 'The servers object is empty.' };
		}
		if (entries.length > 1) {
			return { error: 'Paste a single server entry, or put one server under "servers".' };
		}
		const [name, configRaw] = entries[0];
		const config = normalizeServerConfig(configRaw);
		if ('error' in config) {
			return config;
		}
		const inputs = Array.isArray(root.inputs) ? root.inputs as IMcpServerVariable[] : undefined;
		return {
			name,
			config,
			inputs,
			logoHint: logoHint ?? extractLogoHint(configRaw),
		};
	}

	if (root.config && typeof root.config === 'object' && !Array.isArray(root.config)) {
		const config = normalizeServerConfig(root.config);
		if ('error' in config) {
			return config;
		}
		const name = typeof root.name === 'string' ? root.name.trim() : undefined;
		const inputs = Array.isArray(root.inputs) ? root.inputs as IMcpServerVariable[] : undefined;
		return {
			name,
			config,
			inputs,
			logoHint: logoHint ?? extractLogoHint(root.config),
		};
	}

	const name = typeof root.name === 'string' ? root.name.trim() : undefined;
	const { name: _ignored, inputs, icons: _icons, ...rest } = root;
	const config = normalizeServerConfig(rest);
	if ('error' in config) {
		return config;
	}
	return {
		name,
		config,
		inputs: Array.isArray(inputs) ? inputs as IMcpServerVariable[] : undefined,
		logoHint,
	};
}

export function suggestConnectorId(displayName: string): string {
	const slug = displayName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || `custom-mcp-${Date.now().toString(36)}`;
}

/**
 * Best-effort logo URL from a remote MCP host, gallery match, or JSON hint.
 * Favicons are used when the config points at an HTTP MCP endpoint (including
 * stdio wrappers like `npx mcp-remote https://…`).
 */
export function resolveCustomMcpLogoUrl(options: {
	readonly name?: string;
	readonly config?: IMcpServerConfiguration;
	readonly logoHint?: string;
	readonly galleryIcon?: { readonly dark?: string; readonly light?: string };
}): IConnectorCustomIcon | undefined {
	if (options.galleryIcon?.dark || options.galleryIcon?.light) {
		const dark = options.galleryIcon.dark ?? options.galleryIcon.light!;
		return { dark, light: options.galleryIcon.light ?? dark };
	}
	if (options.logoHint) {
		return { dark: options.logoHint, light: options.logoHint };
	}
	const remoteUrl = options.config ? extractRemoteUrlFromConfig(options.config) : undefined;
	const fromUrl = faviconFromUrl(remoteUrl);
	if (fromUrl) {
		return fromUrl;
	}
	const fromName = faviconFromName(options.name);
	if (fromName) {
		return fromName;
	}
	return undefined;
}

/** Prefer native HTTP MCP over `npx mcp-remote <url>` so OAuth uses the vault. */
export function preferNativeRemoteConfig(config: IMcpServerConfiguration): IMcpServerConfiguration {
	if (config.type !== McpServerType.LOCAL) {
		return config;
	}
	const remoteUrl = extractRemoteUrlFromConfig(config);
	if (!remoteUrl) {
		return config;
	}
	const command = config.command.trim().toLowerCase();
	const args = (config.args ?? []).map(arg => String(arg).toLowerCase());
	const looksLikeMcpRemote = command === 'npx' || command.endsWith('/npx') || command === 'mcp-remote'
		|| args.some(arg => arg.includes('mcp-remote'));
	if (!looksLikeMcpRemote) {
		return config;
	}
	return {
		type: McpServerType.REMOTE,
		url: remoteUrl,
	};
}

export function extractRemoteUrlFromConfig(config: IMcpServerConfiguration): string | undefined {
	if (config.type === McpServerType.REMOTE) {
		return config.url;
	}
	return extractRemoteUrlFromUnknown(config);
}

function extractRemoteUrlFromUnknown(value: unknown): string | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const obj = value as Record<string, unknown>;
	if (typeof obj.url === 'string' && /^https?:\/\//i.test(obj.url)) {
		return obj.url;
	}
	if (Array.isArray(obj.args)) {
		for (const arg of obj.args) {
			if (typeof arg === 'string' && /^https?:\/\//i.test(arg)) {
				return arg;
			}
		}
	}
	return undefined;
}

function faviconFromUrl(remoteUrl: string | undefined): IConnectorCustomIcon | undefined {
	if (!remoteUrl) {
		return undefined;
	}
	try {
		const host = URI.parse(remoteUrl).authority.replace(/^www\./, '');
		if (!host) {
			return undefined;
		}
		// Prefer the product host (mcp.canva.com → canva.com) for clearer brand icons.
		const parts = host.split('.');
		const brandHost = parts.length >= 2 ? parts.slice(-2).join('.') : host;
		const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(brandHost)}&sz=128`;
		return { dark: favicon, light: favicon };
	} catch {
		return undefined;
	}
}

function faviconFromName(name: string | undefined): IConnectorCustomIcon | undefined {
	if (!name) {
		return undefined;
	}
	const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
	if (!slug || slug.length < 2) {
		return undefined;
	}
	const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(`${slug}.com`)}&sz=128`;
	return { dark: favicon, light: favicon };
}

function asServerMap(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	return value as Record<string, unknown>;
}

function normalizeServerConfig(raw: unknown): IMcpServerConfiguration | IParsedCustomMcpError {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { error: 'Server config must be an object.' };
	}
	const config = { ...(raw as Record<string, unknown>) };
	let type = config.type;
	if (type === 'sse') {
		type = McpServerType.REMOTE;
	}
	if (type === undefined) {
		type = typeof config.command === 'string' && config.command
			? McpServerType.LOCAL
			: typeof config.url === 'string' && config.url
				? McpServerType.REMOTE
				: undefined;
	}
	if (type !== McpServerType.LOCAL && type !== McpServerType.REMOTE) {
		return { error: 'Config needs "type": "stdio" with a command, or "type": "http" with a url.' };
	}
	config.type = type;

	if (type === McpServerType.LOCAL) {
		if (typeof config.command !== 'string' || !config.command.trim()) {
			return { error: 'Stdio MCP configs require a "command".' };
		}
		const local = config as unknown as IMcpServerConfiguration;
		return preferNativeRemoteConfig(local);
	}

	if (typeof config.url !== 'string' || !config.url.trim()) {
		return { error: 'HTTP MCP configs require a "url".' };
	}
	return config as unknown as IMcpServerConfiguration;
}

function extractLogoHint(value: unknown): string | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const obj = value as Record<string, unknown>;
	if (typeof obj.icon === 'string' && /^https?:\/\//i.test(obj.icon)) {
		return obj.icon;
	}
	if (obj.icon && typeof obj.icon === 'object' && !Array.isArray(obj.icon)) {
		const icon = obj.icon as Record<string, unknown>;
		if (typeof icon.dark === 'string') {
			return icon.dark;
		}
		if (typeof icon.light === 'string') {
			return icon.light;
		}
	}
	if (Array.isArray(obj.icons)) {
		for (const entry of obj.icons) {
			if (!entry || typeof entry !== 'object') {
				continue;
			}
			const icon = entry as Record<string, unknown>;
			const src = typeof icon.src === 'string' ? icon.src
				: typeof icon.url === 'string' ? icon.url
					: undefined;
			if (src && /^https?:\/\//i.test(src)) {
				return src;
			}
		}
	}
	return undefined;
}
