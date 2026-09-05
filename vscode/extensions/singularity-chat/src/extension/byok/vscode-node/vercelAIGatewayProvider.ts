/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, PrepareLanguageModelChatModelOptions } from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IEndpointBody } from '../../../platform/networking/common/networking';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKModelCapabilities } from '../common/byokProvider';
import { OpenAIEndpoint } from '../node/openAIEndpoint';
import { AbstractOpenAICompatibleLMProvider, LanguageModelChatConfiguration, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';
import { ensureFreshTokenRouterApiKey, getTokenRouterApiKey, getTokenRouterBaseUrl, isUsingBetaProxy } from '../../../platform/env/node/singularityBundledEnv';

export const VERCEL_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

interface VercelGatewayModelData {
	id: string;
	name?: string;
	object?: string;
	owned_by?: string;
	context_window?: number;
	max_tokens?: number;
	architecture?: {
		input_modalities?: string[];
		output_modalities?: string[];
	};
	supported_parameters?: string[];
}

/** Curated fallbacks when /models is empty or unreachable. */
const FALLBACK_MODELS: Record<string, BYOKModelCapabilities> = {
	'anthropic/claude-sonnet-4': {
		name: 'Claude Sonnet 4',
		toolCalling: true,
		vision: true,
		maxInputTokens: 180_000,
		maxOutputTokens: 16_000,
	},
	'anthropic/claude-haiku-4.5': {
		name: 'Claude Haiku 4.5',
		toolCalling: true,
		vision: true,
		maxInputTokens: 180_000,
		maxOutputTokens: 8_000,
	},
	'openai/gpt-4.1': {
		name: 'GPT-4.1',
		toolCalling: true,
		vision: true,
		maxInputTokens: 900_000,
		maxOutputTokens: 32_000,
	},
	'openai/gpt-4.1-mini': {
		name: 'GPT-4.1 Mini',
		toolCalling: true,
		vision: true,
		maxInputTokens: 900_000,
		maxOutputTokens: 16_000,
	},
	'openai/gpt-4o': {
		name: 'GPT-4o',
		toolCalling: true,
		vision: true,
		maxInputTokens: 120_000,
		maxOutputTokens: 16_000,
	},
	'google/gemini-2.5-pro': {
		name: 'Gemini 2.5 Pro',
		toolCalling: true,
		vision: true,
		maxInputTokens: 900_000,
		maxOutputTokens: 32_000,
	},
	'google/gemini-2.5-flash': {
		name: 'Gemini 2.5 Flash',
		toolCalling: true,
		vision: true,
		maxInputTokens: 900_000,
		maxOutputTokens: 16_000,
	},
	'deepseek/deepseek-r1': {
		name: 'DeepSeek R1',
		toolCalling: true,
		vision: false,
		maxInputTokens: 120_000,
		maxOutputTokens: 16_000,
	},
};

/**
 * Vercel AI Gateway — one API key, OpenAI-compatible `/v1`, many upstream models.
 * @see https://vercel.com/docs/ai-gateway
 */
export class VercelAIGatewayLMProvider extends AbstractOpenAICompatibleLMProvider {

	public static readonly providerName = 'Vercel AI Gateway';
	public static readonly providerId = 'vercel';

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			VercelAIGatewayLMProvider.providerId,
			VercelAIGatewayLMProvider.providerName,
			{ ...FALLBACK_MODELS },
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	/** Prefer configured BYOK key; fall back to bundled Singularity gateway key. */
	private resolveApiKey(configured?: string): string | undefined {
		const fresh = getTokenRouterApiKey();
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
			this._logService.warn('[VercelAIGateway] No AI_GATEWAY_API_KEY / BYOK api key; models unavailable.');
			return [];
		}

		const models = await this.getAllModels(silent, apiKey, configuration as LanguageModelChatConfiguration | undefined);
		const configWithKey: LanguageModelChatConfiguration = {
			...(configuration as LanguageModelChatConfiguration | undefined),
			apiKey,
		};
		return models.map(model => ({
			...model,
			isBYOK: true,
			apiKey,
			configuration: configWithKey,
		}));
	}

	protected override getModelsBaseUrl(): string | undefined {
		return getTokenRouterBaseUrl();
	}

	protected override getModelsDiscoveryUrl(modelsBaseUrl: string): string {
		return `${modelsBaseUrl}/models`;
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		const data = modelData as VercelGatewayModelData;
		if (!data?.id || typeof data.id !== 'string') {
			return undefined;
		}
		const known = FALLBACK_MODELS[data.id];
		const derivedWindow = (known?.maxInputTokens ?? 0) + (known?.maxOutputTokens ?? 0);
		const contextWindow = data.context_window ?? (derivedWindow > 0 ? derivedWindow : 128_000);
		// Gateway `max_tokens` is the model's max output; never let output exceed half the window
		// (DeepInfra rejects max_tokens that don't leave room in max_model_len).
		const declaredOut = data.max_tokens ?? known?.maxOutputTokens ?? 16_000;
		const maxOutputTokens = Math.max(16, Math.min(declaredOut, Math.floor(contextWindow / 2), 16_384));
		const modalities = data.architecture?.input_modalities ?? [];
		const supported = data.supported_parameters ?? [];
		return {
			name: data.name ?? known?.name ?? data.id,
			toolCalling: known?.toolCalling ?? (supported.length === 0 || supported.includes('tools') || supported.includes('tool_choice')),
			vision: known?.vision ?? (modalities.includes('image') || modalities.includes('file')),
			contextWindow,
			maxInputTokens: Math.max(1, contextWindow - maxOutputTokens),
			maxOutputTokens,
		};
	}

	protected override async createOpenAIEndPoint(model: OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>): Promise<OpenAIEndpoint> {
		const modelInfo = this.getModelInfo(model.id, model.url);
		// Force Chat Completions (not Responses API) and disable SSE streaming.
		// Streaming through Singularity's CAPI-oriented SSE parser maps Vercel free-tier
		// / provider failures to opaque "Server error. Stream terminated". Non-stream
		// returns proper HTTP 429/403 bodies we can surface to the user.
		modelInfo.supported_endpoints = [ModelSupportedEndpoint.ChatCompletions];
		modelInfo.capabilities = {
			...modelInfo.capabilities,
			supports: {
				...modelInfo.capabilities.supports,
				streaming: true,
			},
		};
		// Prefer limits from the registered LM info when present.
		const maxOut = model.maxOutputTokens || modelInfo.capabilities.limits?.max_output_tokens || 8192;
		const maxIn = model.maxInputTokens || modelInfo.capabilities.limits?.max_prompt_tokens || 32_000;
		modelInfo.capabilities.limits = {
			max_prompt_tokens: maxIn,
			max_output_tokens: maxOut,
			max_context_window_tokens: maxIn + maxOut,
		};
		const url = `${model.url.replace(/\/$/, '')}/chat/completions`;
		const apiKey = this.resolveApiKey(model.configuration?.apiKey);
		if (!apiKey) {
			throw new Error(
				'Vercel AI Gateway API key missing. Set AI_GATEWAY_API_KEY in the Singularity .env and restart.',
			);
		}
		return this._instantiationService.createInstance(
			VercelOpenAIEndpoint,
			modelInfo,
			apiKey,
			url,
		);
	}
}

/**
 * OpenAIEndpoint deletes `max_tokens` for BYOK chat-completions so the provider
 * picks its default. DeepInfra/Vercel then default to 65536, which exceeds many
 * models' context windows (e.g. qwen-3-14b = 40960). Always send a clamped value.
 */
class VercelOpenAIEndpoint extends OpenAIEndpoint {
	override interceptBody(body: IEndpointBody | undefined): void {
		super.interceptBody(body);
		if (!body) {
			return;
		}
		const contextWindow = this.modelMetadata.capabilities.limits?.max_context_window_tokens ?? 128_000;
		const declaredMax = this.modelMetadata.capabilities.limits?.max_output_tokens ?? this.maxOutputTokens;
		body.max_tokens = Math.max(16, Math.min(declaredMax, Math.floor(contextWindow / 2), 16_384));
		delete body.max_completion_tokens;
	}
}
