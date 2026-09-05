/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { IEndpointProvider } from '../../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../../platform/log/common/logService';
import { IChatEndpoint } from '../../../../platform/networking/common/networking';
import { formatPricingLabel, getModelCapabilitiesDescription, getReasoningEffortDescription } from '../../../conversation/common/languageModelAccess';
import { createServiceIdentifier } from '../../../../util/common/services';
import { Emitter } from '../../../../util/vs/base/common/event';
import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import type { ParsedClaudeModelId } from '../common/claudeModelId';
import { tryParseClaudeModelId } from './claudeModelId';
import type { EffortLevel } from '@anthropic-ai/claude-agent-sdk';

export const CLAUDE_REASONING_EFFORT_PROPERTY = 'reasoningEffort';

export interface IClaudeCodeModels {
	readonly _serviceBrand: undefined;
	/**
	 * Resolves a Claude endpoint for the given requested model ID.
	 * Falls back to the fallback model ID if the requested model doesn't match,
	 * then to the newest Sonnet, newest Haiku, or any Claude endpoint.
	 * Returns `undefined` if no Claude endpoint can be found.
	 */
	resolveEndpoint(requestedModel: ParsedClaudeModelId | string | undefined, fallbackModelId: ParsedClaudeModelId | undefined): Promise<IChatEndpoint | undefined>;

	/**
	 * Resolves the reasoning effort level for the given requested model ID and requested reasoning effort.
	 */
	resolveReasoningEffort(requestedModel: ParsedClaudeModelId | string | undefined, requestedReasoningEffort: string | undefined): Promise<EffortLevel | undefined>;

	/**
	 * Registers a LanguageModelChatProvider so that Claude models appear in
	 * VS Code's built-in model picker for the claude-code session type.
	 */
	registerLanguageModelChatProvider(lm: typeof vscode['lm']): void;
}

export const IClaudeCodeModels = createServiceIdentifier<IClaudeCodeModels>('IClaudeCodeModels');

export class ClaudeCodeModels extends Disposable implements IClaudeCodeModels {
	declare _serviceBrand: undefined;
	private _cachedEndpoints: Promise<IChatEndpoint[]> | undefined;
	private readonly _onDidChange = this._register(new Emitter<void>());

	constructor(
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register(this.endpointProvider.onDidModelsRefresh(() => {
			this._cachedEndpoints = undefined;
			this._onDidChange.fire();
		}));
	}

	public registerLanguageModelChatProvider(lm: typeof vscode['lm']): void {
		const provider: vscode.LanguageModelChatProvider = {
			onDidChangeLanguageModelChatInformation: this._onDidChange.event,
			provideLanguageModelChatInformation: async (_options, _token) => {
				return this._provideLanguageModelChatInfo();
			},
			provideLanguageModelChatResponse: async (_model, _messages, _options, _progress, _token) => {
				// Implemented via chat participants.
			},
			provideTokenCount: async (_model, _text, _token) => {
				// Token counting is not currently supported for the claude provider.
				return 0;
			}
		};
		this._register(lm.registerLanguageModelChatProvider('claude-code', provider));

		void this._getEndpoints().then(() => this._onDidChange.fire());
	}

	private _getEndpoints(): Promise<IChatEndpoint[]> {
		if (!this._cachedEndpoints) {
			this._cachedEndpoints = this._fetchAvailableEndpoints();
		}
		return this._cachedEndpoints;
	}

	private async _provideLanguageModelChatInfo(): Promise<vscode.LanguageModelChatInformation[]> {
		const endpoints = await this._getEndpoints();
		return endpoints.map(endpoint => {
			const multiplier = endpoint.multiplier === undefined ? undefined : `${endpoint.multiplier}x`;
			const tooltip: string | undefined = getModelCapabilitiesDescription(endpoint);
			return {
				id: endpoint.model,
				name: endpoint.name,
				family: endpoint.family,
				version: endpoint.version,
				maxInputTokens: endpoint.modelMaxPromptTokens,
				maxOutputTokens: endpoint.maxOutputTokens,
				pricing: multiplier ?? (endpoint.tokenPricing ? formatPricingLabel(endpoint.tokenPricing) : undefined),
				inputCost: endpoint.tokenPricing?.default.inputPrice,
				outputCost: endpoint.tokenPricing?.default.outputPrice,
				cacheCost: endpoint.tokenPricing?.default.cacheReadTokenPrice,
				cacheWriteCost: endpoint.tokenPricing?.default.cacheWriteTokenPrice,
				longContextInputCost: endpoint.tokenPricing?.longContext?.inputPrice,
				longContextOutputCost: endpoint.tokenPricing?.longContext?.outputPrice,
				longContextCacheCost: endpoint.tokenPricing?.longContext?.cacheReadTokenPrice,
				longContextCacheWriteCost: endpoint.tokenPricing?.longContext?.cacheWriteTokenPrice,
				multiplierNumeric: endpoint.multiplier,
				priceCategory: endpoint.priceCategory,
				promo: endpoint.promo,
				tooltip,
				isUserSelectable: true,
				configurationSchema: buildConfigurationSchema(endpoint),
				capabilities: {
					imageInput: endpoint.supportsVision,
					toolCalling: endpoint.supportsToolCalls,
					editTools: endpoint.supportedEditTools ? [...endpoint.supportedEditTools] : undefined,
				},
				targetChatSessionType: 'claude-code'
			};
		});
	}

	public async resolveReasoningEffort(requestedModel: ParsedClaudeModelId | string | undefined, requestedReasoningEffort: string | undefined): Promise<EffortLevel | undefined> {
		const endpoint = await this.resolveEndpoint(requestedModel, undefined);
		return pickReasoningEffort(endpoint, requestedReasoningEffort);
	}

	public async resolveEndpoint(requestedModel: ParsedClaudeModelId | string | undefined, fallbackModelId: ParsedClaudeModelId | undefined): Promise<IChatEndpoint | undefined> {
		// FORCE DEEPSEEK: Always route to deepseek/deepseek-v4-flash-0731 via OpenRouter
		const endpoints = await this.endpointProvider.getAllChatEndpoints();
		
		// Try to find deepseek in available endpoints
		let deepseekEndpoint = endpoints.find(e => e.model === 'deepseek/deepseek-v4-flash-0731');
		if (deepseekEndpoint) {
			this.logService.debug('[ClaudeCodeModels] Found deepseek/deepseek-v4-flash-0731 in endpoints');
			return deepseekEndpoint;
		}

		// If not found, try to find it by partial name match
		deepseekEndpoint = endpoints.find(e => e.model?.includes('deepseek'));
		if (deepseekEndpoint) {
			this.logService.warn(`[ClaudeCodeModels] Using ${deepseekEndpoint.model} instead of exact match`);
			return deepseekEndpoint;
		}

		// Log what's available for debugging
		const availableModels = endpoints.map(e => e.model).join(', ');
		this.logService.error(`[ClaudeCodeModels] DeepSeek model not found. Available: ${availableModels || '(none)'}`);
		
		// Return error - no fallback to Claude
		return undefined;
	}

	private async _fetchAvailableEndpoints(): Promise<IChatEndpoint[]> {
		try {
			const endpoints = await this.endpointProvider.getAllChatEndpoints();

			// FORCE DEEPSEEK: Filter for deepseek/deepseek-v4-flash-0731 only
			const deepseekEndpoints = endpoints.filter(e =>
				e.model === 'deepseek/deepseek-v4-flash-0731'
			);

			if (deepseekEndpoints.length === 0) {
				this.logService.error('[ClaudeCodeModels] DeepSeek v4 Flash 0731 model not found. Ensure OPENROUTER_API_KEY is configured and deepseek is available.');
				return [];
			}

			return deepseekEndpoints;
		} catch (ex) {
			this.logService.error(`[ClaudeCodeModels] Failed to fetch models`, ex);
			return [];
		}
	}
}

const SUPPORTED_EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high'];

export function isEffortLevel(value: string): value is EffortLevel {
	return SUPPORTED_EFFORT_LEVELS.includes(value as EffortLevel);
}

/**
 * Picks the reasoning effort to use for an endpoint given a requested level.
 */
export function pickReasoningEffort(endpoint: IChatEndpoint | undefined, requestedReasoningEffort: string | undefined): EffortLevel | undefined {
	if (!endpoint || !endpoint.supportsReasoningEffort || endpoint.supportsReasoningEffort.length === 0) {
		return undefined;
	}
	if (requestedReasoningEffort && isEffortLevel(requestedReasoningEffort) && endpoint.supportsReasoningEffort.includes(requestedReasoningEffort)) {
		return requestedReasoningEffort;
	}
	if (endpoint.supportsReasoningEffort.length === 1 && isEffortLevel(endpoint.supportsReasoningEffort[0])) {
		return endpoint.supportsReasoningEffort[0];
	}
	return undefined;
}

function buildConfigurationSchema(endpoint: IChatEndpoint): vscode.LanguageModelConfigurationSchema | undefined {
	const effortLevels = endpoint.supportsReasoningEffort?.filter(
		(level): level is typeof SUPPORTED_EFFORT_LEVELS[number] =>
			(SUPPORTED_EFFORT_LEVELS as readonly string[]).includes(level)
	);
	if (!effortLevels) {
		return;
	}

	const defaultEffort = effortLevels.includes('high') ? 'high' : undefined;

	return {
		properties: {
			[CLAUDE_REASONING_EFFORT_PROPERTY]: {
				type: 'string',
				title: l10n.t('Thinking Effort'),
				enum: effortLevels,
				enumItemLabels: effortLevels.map(level => level.charAt(0).toUpperCase() + level.slice(1)),
				enumDescriptions: effortLevels.map(getReasoningEffortDescription),
				default: defaultEffort,
				group: 'navigation',
			}
		}
	};
}
