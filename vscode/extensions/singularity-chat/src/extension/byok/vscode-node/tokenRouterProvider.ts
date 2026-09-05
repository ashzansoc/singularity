/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, PrepareLanguageModelChatModelOptions } from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKModelCapabilities } from '../common/byokProvider';
import { AbstractOpenAICompatibleLMProvider, LanguageModelChatConfiguration, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';
import { DeepSeekDirectOpenAIEndpoint, TokenRouterOpenAIEndpoint } from './tokenRouterEndpoint';
import { ensureFreshTokenRouterApiKey, getDeepSeekDirectConfig, getTokenRouterApiKey, getTokenRouterBaseUrl, getTokenRouterRequestHeaders, isDeepSeekDirectRoutingModel, isUsingBetaProxy } from '../../../platform/env/node/singularityBundledEnv';

export const TOKENROUTER_BASE_URL = 'https://api.tokenrouter.com/v1';

interface TokenRouterModelData {
	id: string;
	name?: string;
	object?: string;
	owned_by?: string;
	tags?: string;
	supported_endpoint_types?: string[];
	context_window?: number;
	max_tokens?: number;
}

/** Curated fallbacks when /models is empty or unreachable. */
const FALLBACK_MODELS: Record<string, BYOKModelCapabilities> = {
	'moonshotai/kimi-k3-free': {
		name: 'Kimi K3 Free',
		toolCalling: true,
		vision: false,
		maxInputTokens: 120_000,
		maxOutputTokens: 8_000,
	},
	'moonshotai/kimi-k3': {
		name: 'Kimi K3',
		toolCalling: true,
		vision: false,
		maxInputTokens: 200_000,
		maxOutputTokens: 16_000,
	},
	'stepfun/step-3.5-flash': {
		name: 'Step 3.5 Flash',
		toolCalling: true,
		vision: false,
		maxInputTokens: 120_000,
		maxOutputTokens: 8_000,
	},
	'qwen3.6-flash': {
		name: 'Qwen 3.6 Flash',
		toolCalling: true,
		vision: false,
		maxInputTokens: 120_000,
		maxOutputTokens: 8_000,
	},
	'qwen/qwen3.7-max': {
		name: 'Qwen 3.7 Max',
		toolCalling: true,
		vision: false,
		maxInputTokens: 200_000,
		maxOutputTokens: 16_000,
	},
	'deepseek/deepseek-v4-pro-0813': {
		name: 'DeepSeek V4 Pro 0813',
		toolCalling: true,
		vision: false,
		maxInputTokens: 120_000,
		maxOutputTokens: 16_000,
	},
	'deepseek/deepseek-v4-pro-0813-free': {
		name: 'DeepSeek V4 Pro 0813 Free',
		toolCalling: true,
		vision: false,
		maxInputTokens: 120_000,
		maxOutputTokens: 16_000,
	},
	'deepseek/deepseek-v4-pro': {
		name: 'DeepSeek V4 Pro',
		toolCalling: true,
		vision: false,
		maxInputTokens: 120_000,
		maxOutputTokens: 16_000,
	},
	'deepseek/deepseek-v4-flash-0731': {
		name: 'DeepSeek V4 Flash-0731',
		toolCalling: true,
		vision: false,
		maxInputTokens: 120_000,
		maxOutputTokens: 16_000,
	},
	'z-ai/glm-5-turbo': {
		name: 'GLM 5 Turbo',
		toolCalling: true,
		vision: false,
		maxInputTokens: 120_000,
		maxOutputTokens: 8_000,
	},
	'openai/gpt-4.1-mini': {
		name: 'GPT-4.1 Mini',
		toolCalling: true,
		vision: true,
		maxInputTokens: 120_000,
		maxOutputTokens: 16_000,
	},
};

/**
 * TokenRouter — OpenAI-compatible `/v1` gateway (https://api.tokenrouter.com/v1).
 */
export class TokenRouterLMProvider extends AbstractOpenAICompatibleLMProvider {

	public static readonly providerName = 'TokenRouter';
	public static readonly providerId = 'tokenrouter';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			TokenRouterLMProvider.providerId,
			TokenRouterLMProvider.providerName,
			{ ...FALLBACK_MODELS },
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	private resolveApiKey(configured?: string): string | undefined {
		const fresh = getTokenRouterApiKey();
		// Beta proxy JWTs expire hourly — never prefer a cached LM config key over the session file.
		if (fresh && isUsingBetaProxy(fresh)) {
			return fresh;
		}
		const fromConfig = configured?.trim();
		if (fromConfig) {
			return fromConfig;
		}
		return fresh;
	}

	override async provideLanguageModelChatInformation(
		{ silent, configuration }: PrepareLanguageModelChatModelOptions,
		token: CancellationToken,
	): Promise<OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>[]> {
		await ensureFreshTokenRouterApiKey();
		let apiKey = this.resolveApiKey((configuration as LanguageModelChatConfiguration | undefined)?.apiKey);
		if (!apiKey) {
			apiKey = await this.configureDefaultGroupWithApiKeyOnly();
			apiKey = this.resolveApiKey(apiKey);
		}
		if (!apiKey) {
			this._logService.warn('[TokenRouter] No TOKENROUTER_API_KEY / BYOK api key; models unavailable.');
			return [];
		}

		const models = await this.getAllModels(silent, apiKey, configuration as LanguageModelChatConfiguration | undefined);
		// Permanent model pin: serve ONLY DeepSeek V4 Flash 0731 via the
		// OpenRouter-backed TokenRouter gateway (your OpenRouter API key). The
		// chat model pool is reduced to this single model, so both the model
		// picker and Auto Mode can only ever resolve to it. No other provider
		// or routing is touched.
		const PINNED_MODEL_ID = 'deepseek/deepseek-v4-flash-0731';
		const modelsToServe =
			models.length > 0
				? models.filter((m) => m.id === PINNED_MODEL_ID || m.id.endsWith('/deepseek-v4-flash-0731'))
				: [];
		// Fall back to the discovered pool only if the pinned model is somehow
		// absent from discovery (e.g. a provider outage) rather than serving nothing.
		const effectiveModels = modelsToServe.length > 0 ? modelsToServe : models;
		const configWithKey: LanguageModelChatConfiguration = {
			...(configuration as LanguageModelChatConfiguration | undefined),
			apiKey,
		};
		return effectiveModels.map(model => ({
			...model,
			isBYOK: true,
			isUserSelectable: false,
			apiKey,
			configuration: configWithKey,
		}));
	}

	protected override getModelsBaseUrl(_configuration?: LanguageModelChatConfiguration): string | undefined {
		return getTokenRouterBaseUrl(getTokenRouterApiKey());
	}

	protected override getDiscoveryExtraHeaders(apiKey: string | undefined): Record<string, string> {
		if (!apiKey) {
			return {};
		}
		const headers = getTokenRouterRequestHeaders(apiKey);
		// getTokenRouterRequestHeaders includes Authorization; discovery sets it separately
		const { Authorization: _auth, ...rest } = headers;
		return rest;
	}

	protected override getModelsDiscoveryUrl(modelsBaseUrl: string): string {
		return `${modelsBaseUrl}/models`;
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		const data = modelData as TokenRouterModelData;
		if (!data?.id || typeof data.id !== 'string') {
			return undefined;
		}
		const tags = String(data.tags ?? '');
		const endpoints = data.supported_endpoint_types ?? [];
		// Skip non-chat modalities in the picker/Auto pool
		if (/Image|Video|Audio|Embed/i.test(tags)) {
			return undefined;
		}
		if (endpoints.length && !endpoints.some(e => /openai|anthropic|gemini/i.test(e))) {
			return undefined;
		}

		const known = FALLBACK_MODELS[data.id];
		const contextWindow = data.context_window ?? ((known?.maxInputTokens ?? 0) + (known?.maxOutputTokens ?? 0) || 128_000);
		const declaredOut = data.max_tokens ?? known?.maxOutputTokens ?? 8_000;
		const maxOutputTokens = Math.max(16, Math.min(declaredOut, Math.floor(contextWindow / 2), 16_384));
		return {
			name: data.name ?? known?.name ?? data.id,
			toolCalling: known?.toolCalling ?? true,
			vision: known?.vision ?? false,
			contextWindow,
			maxInputTokens: Math.max(1, contextWindow - maxOutputTokens),
			maxOutputTokens,
		};
	}

	protected override async createOpenAIEndPoint(model: OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>): Promise<TokenRouterOpenAIEndpoint | DeepSeekDirectOpenAIEndpoint> {
		const modelInfo = this.getModelInfo(model.id, model.url);
		modelInfo.supported_endpoints = [ModelSupportedEndpoint.ChatCompletions];
		modelInfo.capabilities = {
			...modelInfo.capabilities,
			supports: {
				...modelInfo.capabilities.supports,
				streaming: true,
			},
		};
		const maxOut = model.maxOutputTokens || modelInfo.capabilities.limits?.max_output_tokens || 8192;
		const maxIn = model.maxInputTokens || modelInfo.capabilities.limits?.max_prompt_tokens || 32_000;
		modelInfo.capabilities.limits = {
			max_prompt_tokens: maxIn,
			max_output_tokens: maxOut,
			max_context_window_tokens: maxIn + maxOut,
		};
		const deepseek = getDeepSeekDirectConfig();
		if (deepseek && isDeepSeekDirectRoutingModel(model.id)) {
			return this._instantiationService.createInstance(
				DeepSeekDirectOpenAIEndpoint,
				modelInfo,
				deepseek.apiKey,
				`${deepseek.baseUrl}/chat/completions`,
			);
		}
		const url = `${model.url.replace(/\/$/, '')}/chat/completions`;
		const apiKey = this.resolveApiKey(model.configuration?.apiKey);
		if (!apiKey) {
			throw new Error('TokenRouter is unavailable. Restart Singularity and try again.');
		}
		return this._instantiationService.createInstance(
			TokenRouterOpenAIEndpoint,
			modelInfo,
			apiKey,
			url,
		);
	}
}

