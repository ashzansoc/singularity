/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { CountTokensCallback, ILanguageModelToolsService, IPreparedToolInvocation, IToolData, IToolImpl, IToolInvocation, IToolResult, ToolDataSource, ToolProgress } from '../../chat/common/tools/languageModelToolsService.js';
import { IMcpService, McpConnectionState, McpServerTransportType } from '../../mcp/common/mcpTypes.js';
import { mcpServerMatchesUserMessage } from '../../mcp/common/mcpKeywordFilter.js';
import { startServerAndWaitForLiveTools } from '../../mcp/common/mcpTypesUtils.js';
import { IConnectorCatalogService } from '../common/connectorCatalogService.js';
import { LIST_CONNECTORS_TOOL_ID } from '../common/connectors.js';

export const ListConnectorsToolData: IToolData = {
	id: LIST_CONNECTORS_TOOL_ID,
	displayName: localize('connectors.listTool.display', "List Connectors"),
	toolReferenceName: 'list_connectors',
	modelDescription: 'List Singularity connectors that are already connected (Notion, Slack, GitHub, and other MCP servers) and the tool names you must call. Use this immediately when asked whether you can access a connector. Do not search mcp.json. Do not stop after announcing that you will check.',
	userDescription: localize('connectors.listTool.user', "Lists connected connectors and their tools."),
	source: ToolDataSource.Internal,
	icon: Codicon.plug,
	canBeReferencedInPrompt: true,
	inputSchema: {
		type: 'object',
		properties: {},
	},
	tags: ['vscode-tools'],
};

/** Start stopped remote MCP servers. When `userMessage` is set, only servers named in the message are woken. */
export async function wakeRemoteConnectors(mcpService: IMcpService, token: CancellationToken = CancellationToken.None, userMessage?: string): Promise<void> {
	await Promise.all(mcpService.servers.get()
		.filter(server => {
			if (userMessage !== undefined && !mcpServerMatchesUserMessage(server, userMessage)) {
				return false;
			}
			const launch = server.readDefinitions().get().server?.launch;
			return launch?.type === McpServerTransportType.HTTP
				&& server.connectionState.get().state === McpConnectionState.Kind.Stopped;
		})
		.map(server => startServerAndWaitForLiveTools(server, { promptType: 'all-untrusted', errorOnUserInteraction: true }, token)));
}

export class ListConnectorsTool implements IToolImpl {
	constructor(
		@IConnectorCatalogService private readonly catalogService: IConnectorCatalogService,
		@IMcpService private readonly mcpService: IMcpService,
	) { }

	async prepareToolInvocation(): Promise<IPreparedToolInvocation> {
		return {
			invocationMessage: localize('connectors.listTool.invoking', "Checking connected connectors…"),
		};
	}

	async invoke(_invocation: IToolInvocation, _countTokens: CountTokensCallback, _progress: ToolProgress, _token: CancellationToken): Promise<IToolResult> {
		// Report live connection state only — do not start OAuth flows for stopped servers.
		const installed = this.catalogService.getInstalled();
		const servers = this.mcpService.servers.get();
		const payload = installed.map(connector => {
			const server = servers.find(item =>
				item.definition.label === connector.label
				|| item.definition.label === connector.name
				|| item.definition.id.includes(connector.name));
			const tools = server?.tools.get().map(tool => tool.referenceName ?? tool.definition.name) ?? [];
			const state = server ? McpConnectionState.toKindString(server.connectionState.get().state) : 'not-started';
			return { name: connector.label, state, tools };
		});
		const text = payload.length
			? JSON.stringify({ connected: payload }, null, 2)
			: 'No connectors are connected. Open the Connectors hub to connect Notion or another tool.';
		return { content: [{ kind: 'text', value: text }] };
	}
}

export class ConnectorsChatContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.connectorsChat';

	constructor(
		@ILanguageModelToolsService toolsService: ILanguageModelToolsService,
		@IMcpService mcpService: IMcpService,
		@IConnectorCatalogService catalogService: IConnectorCatalogService,
	) {
		super();
		const tool = new ListConnectorsTool(catalogService, mcpService);
		this._register(toolsService.registerTool(ListConnectorsToolData, tool));
		this._register(toolsService.vscodeToolSet.addTool(ListConnectorsToolData));
		// Remote connectors are woken on-demand from chatServiceImpl (keyword-filtered)
		// or when the list_connectors tool is invoked — not on every chat submit.
	}
}
