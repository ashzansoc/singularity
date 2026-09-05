/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lightweight TokenRouter endpoints — kept separate from tokenRouterProvider so
 * AutomodeService can create them without a circular import that crashes activation
 * ("Class extends value undefined").
 */

import type { CancellationToken } from 'vscode';
import { ChatFetchResponseType, RESPONSE_CONTAINED_NO_CHOICES } from '../../../platform/chat/common/commonTypes';
import { ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import {
	DEEPSEEK_PRO_MODEL_ID,
	ensureFreshTokenRouterApiKey,
	getBetaDeviceId,
	getDeepSeekDirectConfig,
	getSupabaseAnonKey,
	getTokenRouterApiKey,
	getTokenRouterBaseUrl,
	getTokenRouterRequestHeaders,
	isDeepSeekDirectRoutingModel,
	isUsingBetaProxy,
	mapDeepSeekOfficialModelId,
	refreshBetaSessionIfNeeded,
} from '../../../platform/env/node/singularityBundledEnv';
import { IEndpointBody, IMakeChatRequestOptions, type IChatEndpoint } from '../../../platform/networking/common/networking';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKModelCapabilities, resolveModelInfo } from '../common/byokProvider';
import { OpenAIEndpoint } from '../node/openAIEndpoint';
import {
	isSharedAccountRpmLimit,
	shouldSkipAuxiliaryTokenRouterLlm,
	tokenRouterRpmGate,
	TOKENROUTER_AUXILIARY_DEBUG_NAMES,
} from './tokenRouterRpmGate';

const ENDPOINT_FALLBACK_CAPS: Record<string, BYOKModelCapabilities> = {
	'deepseek/deepseek-v4-flash-0731': {
		name: 'DeepSeek V4 Flash-0731',
		toolCalling: true,
		vision: false,
		maxInputTokens: 120_000,
		maxOutputTokens: 16_000,
	},
	[DEEPSEEK_PRO_MODEL_ID]: {
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
	'google/gemini-2.5-flash': {
		name: 'Gemini 2.5 Flash',
		toolCalling: true,
		vision: true,
		maxInputTokens: 120_000,
		maxOutputTokens: 8_000,
	},
	'stepfun/step-3.5-flash': {
		name: 'Step 3.5 Flash',
		toolCalling: true,
		vision: false,
		maxInputTokens: 120_000,
		maxOutputTokens: 8_000,
	},
	'openai/gpt-5.6-luna': {
		name: 'GPT 5.6 Luna',
		toolCalling: true,
		vision: false,
		maxInputTokens: 128_000,
		maxOutputTokens: 16_000,
	},
};

/**
 * DeepSeek Flash → official api.deepseek.com (no TokenRouter RPM gate).
 * Catalog id stays deepseek/deepseek-v4-flash-*; the wire model is rewritten for the official API.
 */
export class DeepSeekDirectOpenAIEndpoint extends OpenAIEndpoint {
	override interceptBody(body: IEndpointBody | undefined): void {
		super.interceptBody(body);
		if (!body) {
			return;
		}
		const official = mapDeepSeekOfficialModelId(this.model);
		body.model = official;
		const contextWindow = this.modelMetadata.capabilities.limits?.max_context_window_tokens ?? 128_000;
		const declaredMax = this.modelMetadata.capabilities.limits?.max_output_tokens ?? this.maxOutputTokens;
		body.max_tokens = Math.max(16, Math.min(declaredMax, Math.floor(contextWindow / 2), 16_384));
		delete body.max_completion_tokens;
	}

	override async makeChatRequest2(options: IMakeChatRequestOptions, token: CancellationToken) {
		this.logService.info(
			`[DeepSeekDirect] ${this.model} → ${mapDeepSeekOfficialModelId(this.model)} @ api.deepseek.com (TokenRouter RPM bypass)`,
		);
		return super.makeChatRequest2(options, token);
	}
}

export class TokenRouterOpenAIEndpoint extends OpenAIEndpoint {
	private _deepSeekDirect() {
		if (!isDeepSeekDirectRoutingModel(this.model)) {
			return undefined;
		}
		return getDeepSeekDirectConfig();
	}

	override get urlOrRequestMetadata(): string {
		const ds = this._deepSeekDirect();
		if (ds) {
			return `${ds.baseUrl}/chat/completions`;
		}
		return super.urlOrRequestMetadata;
	}

	override interceptBody(body: IEndpointBody | undefined): void {
		super.interceptBody(body);
		if (!body) {
			return;
		}
		if (this._deepSeekDirect()) {
			body.model = mapDeepSeekOfficialModelId(this.model);
		}
		const contextWindow = this.modelMetadata.capabilities.limits?.max_context_window_tokens ?? 128_000;
		const declaredMax = this.modelMetadata.capabilities.limits?.max_output_tokens ?? this.maxOutputTokens;
		body.max_tokens = Math.max(16, Math.min(declaredMax, Math.floor(contextWindow / 2), 16_384));
		delete body.max_completion_tokens;

		// TokenRouter /chat/completions rejects gpt-5.6-* when function tools are
		// combined with any reasoning_effort other than 'none' (and may default
		// effort server-side if the field is omitted). Force 'none' for tool calls.
		const modelKey = `${this.model} ${this.family} ${this.modelMetadata.id}`.toLowerCase();
		const isGpt56ChatCompletions = /gpt-5\.6-(luna|sol|terra)/.test(modelKey);
		if (isGpt56ChatCompletions && Array.isArray(body.tools) && body.tools.length > 0) {
			body.reasoning_effort = 'none';
			if (body.reasoning) {
				body.reasoning = { ...body.reasoning, effort: 'none' };
			}
		}
	}

	override getExtraHeaders(): Record<string, string> {
		const ds = this._deepSeekDirect();
		if (ds) {
			return {
				Authorization: `Bearer ${ds.apiKey}`,
				'Content-Type': 'application/json',
			};
		}
		const apiKey = getTokenRouterApiKey() ?? this._apiKey;
		if (isUsingBetaProxy(apiKey)) {
			return getTokenRouterRequestHeaders(apiKey);
		}
		const headers = super.getExtraHeaders();
		headers['apikey'] = getSupabaseAnonKey();
		const deviceId = getBetaDeviceId();
		if (deviceId) {
			headers['X-Singularity-Device-Id'] = deviceId;
		}
		return headers;
	}

	override async makeChatRequest2(options: IMakeChatRequestOptions, token: CancellationToken) {
		const ds = this._deepSeekDirect();
		if (ds) {
			this.logService.info(
				`[DeepSeekDirect] ${this.model} → ${mapDeepSeekOfficialModelId(this.model)} @ api.deepseek.com (TokenRouter RPM/credit bypass)`,
			);
			return OpenAIEndpoint.prototype.makeChatRequest2.call(this, options, token);
		}

		const fresh = await ensureFreshTokenRouterApiKey();
		if (!fresh && isUsingBetaProxy(this._apiKey)) {
			throw new Error(
				'Beta session expired. Sign in again via the Singularity access overlay, then retry.',
			);
		}

		if (
			shouldSkipAuxiliaryTokenRouterLlm()
			&& TOKENROUTER_AUXILIARY_DEBUG_NAMES.has(options.debugName)
		) {
			this.logService.info(
				`[TokenRouter] Skipping auxiliary "${options.debugName}" on beta proxy (1 req/min reserved for agent)`,
			);
			return {
				type: ChatFetchResponseType.Failed,
				reason: 'auxiliary-skipped-beta',
				requestId: '',
				serverRequestId: undefined,
			};
		}

		// Reserve a shared account RPM slot before hitting the wire (prevents 5/min stampedes).
		await tokenRouterRpmGate.acquire(token, this.logService);

		let response = await super.makeChatRequest2(options, token);
		if (
			response.type === ChatFetchResponseType.Failed
			&& isUsingBetaProxy(getTokenRouterApiKey() ?? this._apiKey)
			&& /401|invalid_token|expired|Gateway rejected the request/i.test(response.reason ?? '')
		) {
			const rotated = await refreshBetaSessionIfNeeded(true);
			if (!rotated) {
				throw new Error(
					'Beta session expired. Sign in again via the Singularity access overlay, then retry.',
				);
			}
			await tokenRouterRpmGate.acquire(token, this.logService);
			response = await super.makeChatRequest2(options, token);
		}

		// TokenRouter account RPM is shared across models ("Maximum 5 requests within 1 minutes").
		// Coalesce the cooldown globally, then retry once — do not cascade Flash→Pro→Gemini.
		if (isRateLimitedResponse(response)) {
			const reason = 'reason' in response ? String(response.reason ?? '') : '';
			if (isSharedAccountRpmLimit(reason)) {
				const waited = await this._retryAfterAccountRpm(options, token, reason);
				if (waited) {
					return waited;
				}
			} else {
				const failover = await this._retryWithFailoverModels(options, token);
				if (failover) {
					return failover;
				}
			}
		}
		return response;
	}

	private async _retryAfterAccountRpm(
		options: IMakeChatRequestOptions,
		token: CancellationToken,
		reason: string,
	): Promise<Awaited<ReturnType<OpenAIEndpoint['makeChatRequest2']>> | undefined> {
		const maxAttempts = shouldSkipAuxiliaryTokenRouterLlm() ? 3 : 2;
		let lastReason = reason;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			await tokenRouterRpmGate.noteAccountRpmLimit(lastReason, token, this.logService);
			if (token.isCancellationRequested) {
				return undefined;
			}
			await tokenRouterRpmGate.acquire(token, this.logService);
			const next = await OpenAIEndpoint.prototype.makeChatRequest2.call(this, options, token);
			if (isRateLimitedResponse(next)) {
				lastReason = 'reason' in next ? String(next.reason ?? lastReason) : lastReason;
				this.logService.warn(
					`[TokenRouter] Still rate-limited after wait ${attempt}/${maxAttempts} on ${this.model}`,
				);
				continue;
			}
			if (isEmptyRetryResponse(next)) {
				this.logService.warn(
					`[TokenRouter] Empty response after RPM wait ${attempt}/${maxAttempts} on ${this.model} — retrying`,
				);
				continue;
			}
			this.logService.warn(
				`[TokenRouter] RPM wait retry ${attempt}/${maxAttempts} succeeded on ${this.model}`,
			);
			return next;
		}
		return {
			type: ChatFetchResponseType.RateLimited,
			reason: lastReason || 'TokenRouter rate limit exceeded. Try again in about a minute.',
			requestId: '',
			serverRequestId: undefined,
		};
	}

	private async _retryWithFailoverModels(
		options: IMakeChatRequestOptions,
		token: CancellationToken,
	): Promise<Awaited<ReturnType<OpenAIEndpoint['makeChatRequest2']>> | undefined> {
		const failed = this.model.toLowerCase();
		const tried = new Set<string>([failed]);
		// Only try ONE alternate for model-specific limits — avoid burning shared RPM.
		for (const modelId of TOKENROUTER_RATE_LIMIT_FAILOVER) {
			const key = modelId.toLowerCase();
			if (tried.has(key) || sameTokenRouterModel(failed, key)) {
				continue;
			}
			tried.add(key);
			try {
				this.logService.warn(
					`[TokenRouter] Model-specific rate-limit on ${this.model}; one-shot failover to ${modelId}`,
				);
				const caps = ENDPOINT_FALLBACK_CAPS[modelId] ?? {
					name: modelId,
					toolCalling: true,
					vision: false,
					maxInputTokens: 128_000,
					maxOutputTokens: 8_192,
				};
				const modelInfo = resolveModelInfo(modelId, 'TokenRouter', { [modelId]: caps }, caps);
				modelInfo.supported_endpoints = [ModelSupportedEndpoint.ChatCompletions];
				modelInfo.capabilities = {
					...modelInfo.capabilities,
					supports: {
						...modelInfo.capabilities.supports,
						streaming: true,
					},
				};
				const alt = this.instantiationService.createInstance(
					TokenRouterOpenAIEndpoint,
					modelInfo,
					getTokenRouterApiKey() ?? this._apiKey,
					this._modelUrl,
				);
				await tokenRouterRpmGate.acquire(token, this.logService);
				const next = await OpenAIEndpoint.prototype.makeChatRequest2.call(alt, options, token);
				if (!isRateLimitedResponse(next) && next.type !== ChatFetchResponseType.Failed) {
					this.logService.warn(`[TokenRouter] Failover succeeded on ${modelId}`);
					return next;
				}
				this.logService.warn(
					`[TokenRouter] Failover model ${modelId} failed: ${'reason' in next ? next.reason : next.type}`,
				);
			} catch (e) {
				this.logService.warn(
					`[TokenRouter] Failover to ${modelId} threw: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
			break; // one alternate only
		}
		return undefined;
	}
}

function isRateLimitedResponse(response: { type: string; reason?: string }): boolean {
	if (response.type === ChatFetchResponseType.RateLimited) {
		return true;
	}
	if (response.type === ChatFetchResponseType.Failed) {
		return /rate.?limit|too many requests|\b429\b|free tier requests|request limit/i.test(response.reason ?? '');
	}
	return false;
}

/** Empty stream after a long RPM wait — retry instead of surfacing "no response". */
function isEmptyRetryResponse(response: { type: string; reason?: string }): boolean {
	return response.type === ChatFetchResponseType.Unknown
		&& response.reason === RESPONSE_CONTAINED_NO_CHOICES;
}

function sameTokenRouterModel(a: string, b: string): boolean {
	if (a === b) {
		return true;
	}
	const bare = (id: string) => id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
	return bare(a) === bare(b);
}

/** One alternate only when the limit looks model-specific (not shared account RPM). */
const TOKENROUTER_RATE_LIMIT_FAILOVER = [
	'deepseek/deepseek-v4-flash-0731',
] as const;

/**
 * Build TokenRouter chat endpoints without waiting on vscode.lm.selectChatModels.
 */
export async function createTokenRouterAutoEndpoints(
	instantiationService: IInstantiationService,
	modelIds: readonly string[],
): Promise<IChatEndpoint[]> {
	const apiKey = await ensureFreshTokenRouterApiKey();
	const deepseek = getDeepSeekDirectConfig();
	if (!apiKey && !deepseek) {
		return [];
	}
	const base = apiKey ? getTokenRouterBaseUrl(apiKey).replace(/\/$/, '') : '';
	const url = base ? `${base}/chat/completions` : '';
	const out: IChatEndpoint[] = [];
	const seen = new Set<string>();
	for (const modelId of modelIds) {
		if (!modelId || /deepseek-v4-pro/i.test(modelId) || seen.has(modelId)) {
			continue;
		}
		seen.add(modelId);
		const caps = ENDPOINT_FALLBACK_CAPS[modelId] ?? {
			name: modelId,
			toolCalling: true,
			vision: false,
			maxInputTokens: 128_000,
			maxOutputTokens: 8_192,
		};
		const modelInfo = resolveModelInfo(modelId, 'TokenRouter', { [modelId]: caps }, caps);
		modelInfo.supported_endpoints = [ModelSupportedEndpoint.ChatCompletions];
		modelInfo.capabilities = {
			...modelInfo.capabilities,
			supports: {
				...modelInfo.capabilities.supports,
				streaming: true,
			},
		};
		if (deepseek && isDeepSeekDirectRoutingModel(modelId)) {
			out.push(instantiationService.createInstance(
				DeepSeekDirectOpenAIEndpoint,
				modelInfo,
				deepseek.apiKey,
				`${deepseek.baseUrl}/chat/completions`,
			));
			continue;
		}
		if (!apiKey) {
			continue;
		}
		out.push(instantiationService.createInstance(TokenRouterOpenAIEndpoint, modelInfo, apiKey, url));
	}
	return out;
}
