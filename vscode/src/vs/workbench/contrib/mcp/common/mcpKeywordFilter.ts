/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FEATURED_CONNECTOR_SLUGS } from '../../connectors/common/connectors.js';
import { IMcpServer } from './mcpTypes.js';

/** Specific connector / MCP product names — not broad category words like "design" or "cloud". */
const KNOWN_CONNECTOR_KEYWORDS: readonly string[] = [
	...FEATURED_CONNECTOR_SLUGS,
	'bitbucket', 'discord', 'asana', 'trello', 'clickup', 'canva', 'sketch', 'penpot',
	'salesforce', 'hubspot', 'dropbox', 'algolia', 'elasticsearch', 'shadcn', 'godui',
	'stripe', 'terraform', 'prometheus', 'confluence', 'google-drive', 'microsoft-teams',
];

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWholeWord(text: string, word: string): boolean {
	if (!word) {
		return false;
	}
	return new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i').test(text);
}

/**
 * Keywords that identify a specific MCP server (label tokens + known connector slugs
 * present in the server's label or id).
 */
export function getMcpServerMatchKeywords(server: IMcpServer): readonly string[] {
	const identity = `${server.definition.label} ${server.definition.id}`.toLowerCase();
	const keywords = new Set<string>();

	for (const kw of KNOWN_CONNECTOR_KEYWORDS) {
		if (identity.includes(kw)) {
			keywords.add(kw);
		}
	}

	for (const token of server.definition.label.toLowerCase().split(/[\s\-_]+/)) {
		if (token.length >= 3) {
			keywords.add(token);
		}
	}

	for (const token of server.definition.id.toLowerCase().split(/[.\-_:+/\\]+/)) {
		if (token.length >= 3 && !/^(mcp|user|workspace|local|remote|server|stdio|http)$/.test(token)) {
			keywords.add(token);
		}
	}

	return [...keywords];
}

/** True when the user message mentions this MCP server by name. */
export function mcpServerMatchesUserMessage(server: IMcpServer, message: string): boolean {
	const trimmed = message.trim();
	if (!trimmed) {
		return false;
	}
	return getMcpServerMatchKeywords(server).some(kw => containsWholeWord(trimmed, kw));
}
