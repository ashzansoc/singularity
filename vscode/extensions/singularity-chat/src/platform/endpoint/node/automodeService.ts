/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from '@vscode/copilot-api';
import type { ChatRequest, LanguageModelChat } from 'vscode';
import { lm } from 'vscode';
import { FetchedValue } from '../../../shared-fetch-utils/common/fetchedValue';
import { createServiceIdentifier } from '../../../util/common/services';
import { Disposable, DisposableMap, MutableDisposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatLocation } from '../../../vscodeTypes';
import { IAuthenticationService } from '../../authentication/common/authentication';
import { ConfigKey, IConfigurationService } from '../../configuration/common/configurationService';
import { IEnvService } from '../../env/common/envService';
import { getDeepSeekDirectConfig, isDeepSeekDirectBaseUrl, isDeepSeekDirectRoutingModel } from '../../env/node/singularityBundledEnv';
import { IVSCodeExtensionContext } from '../../extContext/common/extensionContext';
import { getImageTelemetryEventMeasurements, getImageTelemetryMeasurementsFromReferences, type ImageTelemetryMeasurements } from '../../image/common/imageTelemetry';
import { ILogService } from '../../log/common/logService';
import { createCapiClientFetchedValue } from '../../networking/common/capiClientFetchedValue';
import { isAbortError } from '../../networking/common/fetcherService';
import { resolveModelInfo } from '../../../extension/byok/common/byokProvider';
import { DesignSourcePlannerEngine, setActiveDesignBrief, setActiveDesignPlan, detectReferenceSiteIntent } from './designSourcePlanner';
import {
	hasReusableDesignSpec,
	isFrontendSessionActive,
	mergeBriefWithDesignSpec,
	promptNeedsDesignIntelligence,
	runDesignDirectorForAgent,
	setFrontendSessionActive,
} from './designIntelligence';
import { reportChatTurnStatus, startChatTurnStatusHeartbeat } from './chatTurnStatus';
import { IChatEndpoint } from '../../networking/common/networking';
import { IRequestLogger } from '../../requestLogger/common/requestLogger';
import { IExperimentationService } from '../../telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../telemetry/common/telemetry';
import { ICAPIClientService } from '../common/capiClient';
import { ModelSupportedEndpoint, type IChatModelCapabilities, type IChatModelInformation } from '../common/endpointProvider';
import { ExtensionContributedChatEndpoint } from '../vscode-node/extChatEndpoint';
import { AutoChatEndpoint } from './autoChatEndpoint';
import { AutoV2Error, AutoV2Fetcher, type AutoV2SelectedModel } from './autoV2Fetcher';
import { SingularityChatEndpoint } from './singularityChatEndpoint';
import { RouterDecisionError, RouterDecisionFetcher, RoutingContextSignals } from './routerDecisionFetcher';
import { SingularityAutoRouter } from './singularityRouterBridge';
import { OpenRouterLlmDecisionEngine, appendConversationGist } from './openRouterLlmDecision';
import { isTrivialChatPrompt } from './singularityPromptEngineBridge';
import { expandCatalogPreferences } from './catalogAliases';
import {
	applySwitchToState,
	AUTO_ROUTABLE_MODEL_IDS,
	DEEPSEEK_FLASH_MODEL_ID,
	decideConversationSwitch,
	escalateCandidateIfNeeded,
	escalateFreeTierPreferences,
	estimateTokens,
	freeTierSurrogatePreferences,
	hashContent,
	MIN_ACCEPT_CONFIDENCE,
	parseTier,
	providerOf,
	remapDisabledDeepSeekPro,
	tierIndex,
	updateContextSegments,
	type ConversationTurnState,
	type SegmentedContextState,
	type TurnRouteCandidate,
} from './conversationSwitch';

/** Catalog / TokenRouter id for the frontend-owner model. */
const FRONTEND_OWNER_MODEL_ID = 'deepseek/deepseek-v4-flash-0731';

interface AutoModeAPIResponse {
	available_models: string[];
	expires_at: number;
	discounted_costs?: { [key: string]: number };
	session_token: string;
}

interface AutoV2CacheEntry {
	endpoint: AutoChatEndpoint;
	sessionToken: string;
	/** UNIX seconds at which `sessionToken` expires. */
	expiresAt: number;
	lastRoutedPrompt?: string;
	turnCount: number;
	needsReEval: boolean;
}

interface AutoModelCacheEntry {
	endpoint: AutoChatEndpoint;
	tokenBank: AutoModeTokenBank;
	lastSessionToken?: string;
	lastRoutedPrompt?: string;
	routerFallbackReason?: string;
	turnCount: number;
	needsReEval: boolean;
}

interface GatewayCacheEntry {
	endpoint: IChatEndpoint;
	lastRoutedPrompt?: string;
	turnCount: number;
	/** Provider-independent turn state for Pattern 1 mid-chat switching. */
	turnState?: ConversationTurnState;
	/** Segment hashes so only dirty context is counted as rebuilt. */
	segments?: SegmentedContextState;
	/** Short gist of prior turns for Ling-3 cost/affinity decisions. */
	conversationGist?: string;
	lastCatalogModelId?: string;
}

class AutoModeTokenBank extends Disposable {
	private readonly _fetchedValue: FetchedValue<AutoModeAPIResponse>;
	private _usedSinceLastFetch = false;

	constructor(
		public debugName: string,
		location: ChatLocation,
		capiClientService: ICAPIClientService,
		authService: IAuthenticationService,
		_logService: ILogService,
		expService: IExperimentationService,
		envService: IEnvService,
	) {
		super();

		const expName = location === ChatLocation.Editor
			? 'singularitychat.autoModelHint.editor'
			: 'singularitychat.autoModelHint';

		this._fetchedValue = this._register(createCapiClientFetchedValue<AutoModeAPIResponse>(capiClientService, envService, {
			request: async () => {
				const authToken = (await authService.getSingularityToken()).token;
				const extValue = expService.getTreatmentVariable<string>(expName);
				const model_hints = [extValue || 'auto'];
				if (location === ChatLocation.Editor && model_hints[0] !== 'auto') {
					model_hints.push('auto');
				}
				return {
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${authToken}`,
					},
					method: 'POST' as const,
					json: { auto_mode: { model_hints } },
				};
			},
			requestMetadata: { type: RequestType.AutoModels },
			parseResponse: async (res) => {
				if (res.status < 200 || res.status >= 300) {
					const text = await res.text().catch(() => '');
					throw new Error(`AutoMode token response status: ${res.status}${text ? `, body: ${text}` : ''}`);
				}
				const data = await res.json() as AutoModeAPIResponse;
				this._usedSinceLastFetch = false;
				return data;
			},
			isStale: (token) => {
				if (!this._usedSinceLastFetch) {
					return false;
				}
				return token.expires_at * 1000 - Date.now() < 5 * 60 * 1000;
			},
			keepCacheHot: true,
		}));
	}

	async getToken(): Promise<AutoModeAPIResponse> {
		this._usedSinceLastFetch = true;
		return this._fetchedValue.resolve();
	}
}

/**
 * The subset of {@link ChatRequest} auto mode reads when routing. Callers that
 * have a real `ChatRequest` pass it directly; callers that do not (e.g. the
 * `vscode.lm` provider, which has no `ChatRequest`) can build this shape
 * without fabricating the rest of the interface.
 */
export interface IAutoModeRoutingRequest {
	readonly prompt: string;
	readonly id?: string;
	readonly location?: ChatLocation;
	readonly sessionId?: string;
	readonly sessionResource?: { toString(): string };
	readonly references?: readonly { readonly value: unknown }[];
}

export interface AutoModeRoutingDecision {
	resolvedModel: string;
	resolvedModelName: string;
	predictedLabel: 'needs_reasoning' | 'no_reasoning' | 'fallback';
	confidence: number;
}

export const IAutomodeService = createServiceIdentifier<IAutomodeService>('IAutomodeService');

/**
 * Discount metadata for the "Auto" model picker entry, as fractions
 * (e.g. `0.1` for 10% off).
 */
export interface AutoModePickerMetadata {
	discountRange: { low: number; high: number };
}

export interface IAutomodeService {
	readonly _serviceBrand: undefined;

	resolveAutoModeEndpoint(chatRequest: IAutoModeRoutingRequest | undefined, knownEndpoints: IChatEndpoint[]): Promise<IChatEndpoint>;

	/**
	 * Resolves the endpoint backing the "Auto" model picker entry. The picker
	 * has no prompt, so this only carries display metadata; it may perform the
	 * discount probe described on {@link getAutoPickerMetadata}.
	 */
	resolveAutoModePickerEndpoint(knownEndpoints: IChatEndpoint[]): Promise<IChatEndpoint>;

	/**
	 * Discount metadata for the "Auto" picker entry, persisted across windows.
	 * `/auto` has no prompt-free variant, so if no discount has ever been seen
	 * this issues a one-time probe with a placeholder prompt.
	 */
	getAutoPickerMetadata(): Promise<AutoModePickerMetadata | undefined>;

	/**
	 * Returns the routing decision from the last call to {@link resolveAutoModeEndpoint},
	 * or `undefined` if the router was not used (e.g. skipped, fallback, or non-auto model).
	 * Cleared after reading.
	 */
	consumeLastRoutingDecision(): AutoModeRoutingDecision | undefined;

	/**
	 * Marks the router cache for this conversation as needing re-evaluation.
	 * The next call to {@link resolveAutoModeEndpoint} will re-run the router
	 * instead of returning the cached endpoint.
	 */
	invalidateRouterCache(chatRequest: IAutoModeRoutingRequest): void;

	/**
	 * Marks a model as rate-limited so the next Auto resolve rotates away from it.
	 */
	markModelRateLimited(modelId: string): void;

	/**
	 * After a TokenRouter/BYOK 429, prefer keeping the frontend/agent owner (Pro).
	 * Marks the failed model for cooldown but preserves sticky turn state.
	 */
	resolveRateLimitFailover(failedModelId: string, chatRequest?: IAutoModeRoutingRequest): Promise<IChatEndpoint | undefined>;
}

export class AutomodeService extends Disposable implements IAutomodeService {
	readonly _serviceBrand: undefined;
	private readonly _autoModelCache: Map<string, AutoModelCacheEntry> = new Map();
	private readonly _autoV2Cache: Map<string, AutoV2CacheEntry> = new Map();
	private readonly _gatewayCache: Map<string, GatewayCacheEntry> = new Map();
	/** Model ids recently rate-limited on the gateway free tier; skipped until expiry. */
	private readonly _rateLimitedUntil = new Map<string, number>();
	/** Coalesce parallel gateway resolves for the same conversation + prompt. */
	private readonly _inflightGatewayResolve = new Map<string, Promise<IChatEndpoint | undefined>>();
	private static readonly RATE_LIMIT_COOLDOWN_MS = 60_000;
	private _reserveTokens: DisposableMap<ChatLocation, AutoModeTokenBank> = new DisposableMap();
	private readonly _routerDecisionFetcher: RouterDecisionFetcher;
	private readonly _autoV2Fetcher: AutoV2Fetcher;
	/** Kept for re-enabling the keyword bridge (see route() comment). */
	private readonly _singularityRouter = new SingularityAutoRouter();
	private readonly _llmDecision = new OpenRouterLlmDecisionEngine((msg) => this._logService.info(msg));
	private readonly _designSourcePlanner = new DesignSourcePlannerEngine((msg) => this._logService.info(msg));
	/** Cached gateway chat models — discovery can be slow; reuse across turns. */
	private _modelsCache: { models: LanguageModelChat[]; fetchedAt: number } | undefined;
	private static readonly MODELS_TTL_MS = 5 * 60_000;
	/** Direct TokenRouter endpoints for Auto — avoids selectChatModels cold start. */
	private _directAutoEndpoints: IChatEndpoint[] | undefined;
	/** Reuse endpoint wrappers — creating one per gateway model every turn is expensive. */
	private readonly _endpointById = new Map<string, IChatEndpoint>();
	private _lastRoutingDecision: AutoModeRoutingDecision | undefined;
	/** Set on a 404 (API-version or feature-flag gate); pins us to V1. */
	private _autoV2Unavailable = false;
	/** Discounts from the most recent `POST /auto` response. */
	private _lastAutoV2Discounts: Record<string, number> | undefined;
	/** Persists discounts so the picker label survives a restart. */
	private static readonly AUTO_V2_DISCOUNTS_STORAGE_KEY = 'singularity.autoMode.v2.lastDiscountedCosts';
	/** Placeholder prompt used to read discounts. See {@link _probeAutoV2Discounts}. */
	private static readonly DISCOUNT_PROBE_PROMPT = 'MODEL_PICKER_DISCOUNT_RESOLUTION - REPLACE ME';
	/** In-flight discount probe, so concurrent picker refreshes share one call. */
	private _autoV2DiscountProbe: Promise<void> | undefined;
	/** Session used only to read discounts for the picker on the legacy flow. */
	private readonly _pickerTokenBank = this._register(new MutableDisposable<AutoModeTokenBank>());

	constructor(
		@ICAPIClientService private readonly _capiClientService: ICAPIClientService,
		@IAuthenticationService private readonly _authService: IAuthenticationService,
		@ILogService private readonly _logService: ILogService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IExperimentationService private readonly _expService: IExperimentationService,
		@IEnvService private readonly _envService: IEnvService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IRequestLogger private readonly _requestLogger: IRequestLogger,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
	) {
		super();
		this._lastAutoV2Discounts = this._extensionContext.globalState.get<Record<string, number>>(AutomodeService.AUTO_V2_DISCOUNTS_STORAGE_KEY);
		this._register(this._authService.onDidAuthenticationChange(() => {
			for (const entry of this._autoModelCache.values()) {
				entry.tokenBank.dispose();
			}
			this._autoModelCache.clear();
			this._autoV2Cache.clear();
			this._gatewayCache.clear();
			this._directAutoEndpoints = undefined;
			// All of this is scoped to the signed-in account.
			this._setLastAutoV2Discounts(undefined);
			this._autoV2Unavailable = false;
			this._autoV2DiscountProbe = undefined;
			this._pickerTokenBank.clear();
			const keys = Array.from(this._reserveTokens.keys());
			this._reserveTokens.clearAndDisposeAll();
			for (const location of keys) {
				this._reserveTokens.set(location, new AutoModeTokenBank('reserve', location, this._capiClientService, this._authService, this._logService, this._expService, this._envService));
			}
		}));
		this._serviceBrand = undefined;
		this._routerDecisionFetcher = new RouterDecisionFetcher(this._capiClientService, this._authService, this._logService, this._telemetryService, this._requestLogger);
		this._autoV2Fetcher = new AutoV2Fetcher(this._capiClientService, this._authService, this._logService, this._telemetryService, this._requestLogger);
		// Do NOT warm vscode.lm.selectChatModels here — /models via the beta proxy
		// takes 20–80s and starves the actual chat completion on the same gateway.
	}

	override dispose(): void {
		for (const entry of this._autoModelCache.values()) {
			entry.tokenBank.dispose();
		}
		this._autoModelCache.clear();
		this._autoV2Cache.clear();
		this._gatewayCache.clear();
		this._reserveTokens.dispose();
		super.dispose();
	}

	consumeLastRoutingDecision(): AutoModeRoutingDecision | undefined {
		const decision = this._lastRoutingDecision;
		this._lastRoutingDecision = undefined;
		return decision;
	}

	private _setLastAutoV2Discounts(discounts: Record<string, number> | undefined): void {
		if (JSON.stringify(this._lastAutoV2Discounts) === JSON.stringify(discounts)) {
			return;
		}
		this._lastAutoV2Discounts = discounts;
		// Persisted so the next window shows the discount immediately.
		this._extensionContext.globalState.update(AutomodeService.AUTO_V2_DISCOUNTS_STORAGE_KEY, discounts)
			.then(undefined, (e: Error) => this._logService.warn(`[AutomodeService] Failed to persist auto discounts: ${e.message}`));
	}

	/**
	 * TEMPORARY: reads discounts via `POST /auto` with a placeholder prompt,
	 * since the endpoint has no prompt-free variant. Only `discounted_costs` is
	 * used. Runs at most once per session. Remove once CAPI can return discounts
	 * without classifying a prompt.
	 */
	private async _probeAutoV2Discounts(): Promise<void> {
		if (!this._autoV2DiscountProbe) {
			this._autoV2DiscountProbe = (async () => {
				try {
					const result = await this._autoV2Fetcher.getAutoDecision(AutomodeService.DISCOUNT_PROBE_PROMPT, { isDiscountProbe: true });
					this._setLastAutoV2Discounts(result.discounted_costs);
				} catch (e) {
					this._logService.warn(`[AutomodeService] Failed to probe auto discounts: ${(e as Error).message}`);
				}
			})();
		}
		return this._autoV2DiscountProbe;
	}

	async resolveAutoModePickerEndpoint(knownEndpoints: IChatEndpoint[]): Promise<IChatEndpoint> {
		if (!knownEndpoints.length) {
			throw new Error('No auto mode endpoints provided.');
		}
		if (!this._isAutoV2Enabled()) {
			return this.resolveAutoModeEndpoint(undefined, knownEndpoints);
		}
		// Nothing to route without a prompt: wrap a representative endpoint for
		// its display metadata only. The picker hides per-model pricing for
		// Auto, so the wrapped model is not user-visible.
		const metadata = await this.getAutoPickerMetadata();
		const discountRange = metadata?.discountRange ?? { low: 0, high: 0 };
		const base = knownEndpoints.find(e => e.showInModelPicker) ?? knownEndpoints[0];
		return this._instantiationService.createInstance(AutoChatEndpoint, base, '', 0, discountRange);
	}

	async getAutoPickerMetadata(): Promise<AutoModePickerMetadata | undefined> {
		if (this._isAutoV2Enabled()) {
			// `/auto` requires a prompt, which the picker does not have. Prefer
			// the discounts observed on a real request; only when none have been
			// seen yet (first ever run) probe with a placeholder prompt.
			if (!this._lastAutoV2Discounts) {
				await this._probeAutoV2Discounts();
			}
			return this._lastAutoV2Discounts
				? { discountRange: this._calculateDiscountRange(this._lastAutoV2Discounts) }
				: undefined;
		}
		// The legacy session endpoint returns discounts without a prompt.
		try {
			if (!this._pickerTokenBank.value) {
				this._pickerTokenBank.value = new AutoModeTokenBank('auto-picker-metadata', ChatLocation.Panel, this._capiClientService, this._authService, this._logService, this._expService, this._envService);
			}
			const token = await this._pickerTokenBank.value.getToken();
			return { discountRange: this._calculateDiscountRange(token.discounted_costs) };
		} catch (e) {
			this._logService.warn(`[AutomodeService] Failed to resolve auto picker metadata: ${(e as Error).message}`);
			return undefined;
		}
	}

	/**
	 * Resolve an auto mode endpoint
	 * Optionally uses a router model to select the best endpoint based on the prompt.
	 */
	invalidateRouterCache(chatRequest: IAutoModeRoutingRequest): void {
		const conversationId = chatRequest.sessionResource?.toString() ?? chatRequest.sessionId ?? 'unknown';
		const entry = this._autoModelCache.get(conversationId);
		if (entry) {
			entry.needsReEval = true;
			this._logService.trace(`[AutomodeService] Router cache invalidated for conversation ${conversationId}`);
		}
		const v2Entry = this._autoV2Cache.get(conversationId);
		if (v2Entry) {
			v2Entry.needsReEval = true;
			this._logService.trace(`[AutomodeService] Auto v2 cache invalidated for conversation ${conversationId}`);
		}
		// Drop sticky gateway pick so same-prompt retries can leave a rate-limited model.
		this._gatewayCache.delete(conversationId);
	}

	async resolveAutoModeEndpoint(chatRequest: IAutoModeRoutingRequest | undefined, knownEndpoints: IChatEndpoint[]): Promise<IChatEndpoint> {
		// Singularity Auto resolves OpenRouter BYOK models independently of CAPI `/models`.
		const singularityEnabled = this._configurationService.getConfig(ConfigKey.Advanced.SingularityRouterEnabled);
		if (!knownEndpoints.length && !singularityEnabled) {
			throw new Error('No auto mode endpoints provided.');
		}

		// Clear any previous routing decision upfront so stale data cannot
		// leak to a consumer if this call takes a non-router path.
		this._lastRoutingDecision = undefined;

		// Singularity local router takes precedence over CAPI Auto v2 / hydra.
		if (singularityEnabled) {
			const singularity = await this._tryResolveWithSingularityRouter(chatRequest, knownEndpoints);
			if (singularity) {
				return singularity;
			}
			// Do not fall through to Singularity Auto — that path fails during
			// Singularity outages and bypasses the user's OpenRouter gateway key.
			this._logService.error(
				'[AutomodeService] Singularity Auto could not resolve a TokenRouter model.',
			);
			throw new Error(
				'Singularity Auto could not load TokenRouter models. Wait a moment and retry, or restart Singularity. (Singularity sign-in is not required.)',
			);
		}

		if (!knownEndpoints.length) {
			throw new Error('No auto mode endpoints provided.');
		}

		if (this._isAutoV2Enabled()) {
			const v2Endpoint = await this._tryResolveWithAutoV2(chatRequest, knownEndpoints);
			if (v2Endpoint) {
				return v2Endpoint;
			}
		}

		const conversationId = chatRequest?.sessionResource?.toString() ?? chatRequest?.sessionId ?? 'unknown';
		const entry = this._autoModelCache.get(conversationId);
		const tokenBank = this._acquireTokenBank(entry, chatRequest?.location, conversationId);
		const token = await tokenBank.getToken();

		// After the first turn, skip the router unless explicitly invalidated
		// (e.g. after conversation compaction/summarization). Token refresh and
		// default model selection still run so available-model changes are respected.
		const skipRouter = entry !== undefined && entry.turnCount > 0 && !entry.needsReEval;
		if (entry?.needsReEval) {
			entry.needsReEval = false;
		}
		const imageTelemetryMeasurements = getImageTelemetryMeasurementsFromReferences(chatRequest?.references);
		const imageTelemetryEventMeasurements = getImageTelemetryEventMeasurements(imageTelemetryMeasurements);

		const routerResult = skipRouter
			? { lastRoutedPrompt: chatRequest?.prompt?.trim() ?? entry?.lastRoutedPrompt }
			: await this._tryRouterSelection(chatRequest, conversationId, entry, token, knownEndpoints, imageTelemetryEventMeasurements);
		let selectedModel = routerResult.selectedModel;
		const lastRoutedPrompt = routerResult.lastRoutedPrompt;
		const routerFallbackReason = routerResult.fallbackReason;

		// Default model selection when router was skipped or failed
		if (!selectedModel) {
			if (routerFallbackReason) {
				/* __GDPR__
					"automode.routerFallback" : {
						"owner": "lramos15",
						"comment": "Reports when the auto mode router is skipped or fails and falls back to default model selection",
						"reason": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "The reason the router was skipped or failed, e.g. emptyPrompt, emptyCandidateList, noMatchingEndpoint, routerError, routerTimeout, or a server error code" },
						"hasImage": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Whether the request contained an attached image" },
						"imageCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Number of input images attached to the request", "isMeasurement": true },
						"totalImageBytes": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Sum of byte sizes for attached input images when known", "isMeasurement": true },
						"maxImageBytes": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Largest known input image byte size in the request", "isMeasurement": true },
						"maxImageWidth": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Largest known input image width in the request", "isMeasurement": true },
						"maxImageHeight": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Largest known input image height in the request", "isMeasurement": true },
						"maxImagePixels": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Largest known input image pixel count in the request", "isMeasurement": true },
						"totalImagePixels": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Sum of known input image pixel counts in the request", "isMeasurement": true },
						"imagePngCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of PNG input images", "isMeasurement": true },
						"imageJpegCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of JPEG input images", "isMeasurement": true },
						"imageGifCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of GIF input images", "isMeasurement": true },
						"imageWebpCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of WebP input images", "isMeasurement": true },
						"imageUnknownMimeCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images whose MIME type is unknown or unsupported", "isMeasurement": true },
						"imageClipboardCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images sourced from clipboard or paste", "isMeasurement": true },
						"imageScreenshotCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images sourced from screenshot capture", "isMeasurement": true },
						"imageFileCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images sourced from local file attachment", "isMeasurement": true },
						"imageUrlCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images sourced from URL", "isMeasurement": true },
						"imageUnknownSourceCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images whose source could not be determined", "isMeasurement": true }
					}
				*/
				this._telemetryService.sendMSFTTelemetryEvent('automode.routerFallback', {
					reason: routerFallbackReason,
					hasImage: String(imageTelemetryMeasurements.imageCount > 0),
				}, imageTelemetryEventMeasurements);
			}
			selectedModel = this._selectDefaultModel(entry?.endpoint?.modelProvider, token.available_models, knownEndpoints);
		}

		selectedModel = this._applyVisionFallback(chatRequest, selectedModel, token.available_models, knownEndpoints);
		selectedModel = this._forceFlashEndpoint(knownEndpoints, selectedModel) ?? selectedModel;

		// Store routing decision for the UI to consume (update resolved model to the final one after all overrides)
		if (routerResult.routingDecision) {
			this._lastRoutingDecision = {
				...routerResult.routingDecision,
				resolvedModel: selectedModel.model,
				resolvedModelName: selectedModel.name,
			};
		}

		// Emit the final model selection alongside the router's recommendation
		// so analysts can detect overrides without fragile telemetry joins
		if (!skipRouter && routerResult.candidateModel) {
			/* __GDPR__
				"automode.routerModelSelection" : {
					"owner": "aashnagarg",
					"comment": "Reports the router's recommended model vs the actual model used after all client-side overrides",
					"conversationId": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The conversation ID" },
					"candidateModel": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The router's top candidate model (candidate_models[0])" },
					"actualModel": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "The model actually selected after all client-side overrides" },
					"overrideReason": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "comment": "Why the actual model differs from the candidate: none or clientOverride" },
					"imageCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Number of input images attached to the request", "isMeasurement": true },
					"totalImageBytes": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Sum of byte sizes for attached input images when known", "isMeasurement": true },
					"maxImageBytes": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Largest known input image byte size in the request", "isMeasurement": true },
					"maxImageWidth": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Largest known input image width in the request", "isMeasurement": true },
					"maxImageHeight": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Largest known input image height in the request", "isMeasurement": true },
					"maxImagePixels": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Largest known input image pixel count in the request", "isMeasurement": true },
					"totalImagePixels": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Sum of known input image pixel counts in the request", "isMeasurement": true },
					"imagePngCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of PNG input images", "isMeasurement": true },
					"imageJpegCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of JPEG input images", "isMeasurement": true },
					"imageGifCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of GIF input images", "isMeasurement": true },
					"imageWebpCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of WebP input images", "isMeasurement": true },
					"imageUnknownMimeCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images whose MIME type is unknown or unsupported", "isMeasurement": true },
					"imageClipboardCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images sourced from clipboard or paste", "isMeasurement": true },
					"imageScreenshotCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images sourced from screenshot capture", "isMeasurement": true },
					"imageFileCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images sourced from local file attachment", "isMeasurement": true },
					"imageUrlCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images sourced from URL", "isMeasurement": true },
					"imageUnknownSourceCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Count of input images whose source could not be determined", "isMeasurement": true }
				}
			*/
			const candidateModel = routerResult.candidateModel;
			const overrideReason = candidateModel === selectedModel.model ? 'none' : 'clientOverride';
			this._telemetryService.sendMSFTTelemetryEvent('automode.routerModelSelection', {
				conversationId: conversationId ?? '',
				candidateModel,
				actualModel: selectedModel.model,
				overrideReason,
			}, imageTelemetryEventMeasurements);
		}

		// Reuse the cached endpoint if the session token and model haven't changed
		const autoEndpoint = (entry?.endpoint && entry.lastSessionToken === token.session_token && entry.endpoint.model === selectedModel.model)
			? entry.endpoint
			: this._instantiationService.createInstance(AutoChatEndpoint, selectedModel, token.session_token, token.discounted_costs?.[selectedModel.model] || 0, this._calculateDiscountRange(token.discounted_costs));

		const isNewTurn = !entry || lastRoutedPrompt !== entry.lastRoutedPrompt;
		this._autoModelCache.set(conversationId, {
			endpoint: autoEndpoint,
			tokenBank,
			lastSessionToken: token.session_token,
			lastRoutedPrompt,
			routerFallbackReason,
			turnCount: (entry?.turnCount ?? 0) + (isNewTurn ? 1 : 0),
			needsReEval: false,
		});
		return autoEndpoint;
	}

	private _isAutoV2Enabled(): boolean {
		return !this._autoV2Unavailable && this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.AutoModeV2Enabled, this._expService);
	}

	/**
	 * Resolve Auto mode via the local Singularity router onto OpenRouter only.
	 * Never falls through to Microsoft CAPI / Singularity Auto — that path fails
	 * during Singularity outages ("Stream terminated") even when a gateway key is set.
	 */
	private async _tryResolveWithSingularityRouter(
		chatRequest: IAutoModeRoutingRequest | undefined,
		_knownEndpoints: IChatEndpoint[],
	): Promise<IChatEndpoint | undefined> {
		const conversationId = chatRequest?.sessionResource?.toString() ?? chatRequest?.sessionId ?? 'unknown';
		// Prompt may be empty for picker / token-count paths — still pick a gateway model.
		const prompt = chatRequest?.prompt?.trim() || '(auto)';
		return this._tryResolveWithGateway(chatRequest, conversationId, prompt);
	}

	private async _tryResolveWithGateway(
		chatRequest: IAutoModeRoutingRequest | undefined,
		conversationId: string,
		prompt: string,
	): Promise<IChatEndpoint | undefined> {
		const inflightKey = `${conversationId}::${prompt}`;
		const existing = this._inflightGatewayResolve.get(inflightKey);
		if (existing) {
			this._logService.info(`[AutomodeService] coalesce gateway resolve (${conversationId.slice(0, 48)})`);
			return existing;
		}
		const run = this._tryResolveWithGatewayUncached(chatRequest, conversationId, prompt)
			.finally(() => {
				this._inflightGatewayResolve.delete(inflightKey);
			});
		this._inflightGatewayResolve.set(inflightKey, run);
		return run;
	}

	/**
	 * Singularity Auto routing architecture (provider-independent catalog):
	 * Feature/Intent → Capability → Affinity → Cost → Model Selection → Execute
	 * Pattern 1: re-route every distinct user turn. TokenRouter/OpenRouter = transport only.
	 */
	private async _tryResolveWithGatewayUncached(
		chatRequest: IAutoModeRoutingRequest | undefined,
		conversationId: string,
		prompt: string,
	): Promise<IChatEndpoint | undefined> {
		const routeStarted = Date.now();
		const cache = this._gatewayCache.get(conversationId);
		const samePrompt = cache?.lastRoutedPrompt === prompt && !!cache.endpoint;
		const frontendSession = isFrontendSessionActive(conversationId);
		const prevLiveModel = cache?.endpoint?.model ?? cache?.turnState?.modelId ?? cache?.lastCatalogModelId;
		const prevWasPro = Boolean(prevLiveModel && /deepseek-v4-pro/i.test(prevLiveModel));

		// Resolve Auto pool without waiting on vscode.lm.selectChatModels (often 40s+ cold).
		const knownEndpoints = this._codingEndpoints(await this._getSingularityAutoEndpoints());
		const availableIds = knownEndpoints.map((e) => e.model);
		// Never kick selectChatModels during a turn — it competes with chat/completions
		// on the same llm-proxy and routinely adds 20–80s of latency.

		if (!knownEndpoints.length) {
			this._logService.warn(
				'[AutomodeService] No gateway models from TokenRouter (provider missing or not ready).',
			);
			return undefined;
		}

		if (isTrivialChatPrompt(prompt)) {
			const flash = this._forceFlashEndpoint(knownEndpoints, knownEndpoints[0]) ?? knownEndpoints[0];
			this._logService.info(`[AutomodeService] trivial chat — skip routing (${flash?.model ?? 'none'})`);
			return flash;
		}

		const deepseekDirect = knownEndpoints.filter((e) => {
			const url = typeof e.urlOrRequestMetadata === 'string' ? e.urlOrRequestMetadata : '';
			return isDeepSeekDirectRoutingModel(e.model) && isDeepSeekDirectBaseUrl(url);
		}).length;
		this._logService.info(
			`[AutomodeService] Gateway Auto pool: ${knownEndpoints.length} models (direct TokenRouter, ${deepseekDirect} DeepSeek official, ${Date.now() - routeStarted}ms)`,
		);

		let selected: IChatEndpoint | undefined;
		let turnState = cache?.turnState;
		let segments = cache?.segments;

		if (samePrompt) {
			const until = this._rateLimitedUntil.get(cache.endpoint.model) ?? 0;
			const keepDespiteRateLimit = until > Date.now() && frontendSession;
			if (until > Date.now() && !keepDespiteRateLimit) {
				this._logService.warn(
					`[AutomodeService] Cached ${cache.endpoint.model} is rate-limited; re-routing`,
				);
				selected = undefined;
			} else {
				if (keepDespiteRateLimit) {
					this._logService.info(
						`[AutomodeService] Keeping sticky ${cache.endpoint.model} despite rate-limit cooldown (frontend/agent turn)`,
					);
				}
				selected = this._forceFlashEndpoint(
					knownEndpoints,
					knownEndpoints.find((e) => e.model === cache.endpoint.model) ?? cache.endpoint,
				);
				this._logService.trace(`[AutomodeService] Singularity reuse ${selected.model}`);
			}
		}
		if (!selected) {
			const hasImages = (chatRequest?.references ?? []).some((r) => {
				const v = r.value as { mimeType?: string } | undefined;
				return typeof v?.mimeType === 'string' && v.mimeType.startsWith('image/');
			});
			const refCount = chatRequest?.references?.length ?? 0;

			// Keyword pick is local — do not surface "Model Router called" in chat.
			// reportChatTurnStatus('Model Router', 'called');
			// reportChatTurnStatus('Model Router', 'Selecting the best model for this turn…');
			// reportChatTurnStatus('Model Router', 'Keyword routing (Flash vs Pro)…');

			// Context segmentation (architecture: only dirty segments rebuild)
			segments = updateContextSegments(cache?.segments, conversationId, {
				system: 'singularity-auto',
				repository: `refs:${refCount}`,
				conversation: `turns:${cache?.turnCount ?? 0}`,
				retrieval: hasImages ? 'images' : '',
				currentPrompt: prompt,
				tokenEstimates: {
					repository: Math.min(80_000, Math.max(2_000, refCount * 2_000)),
					conversation: Math.min(40_000, Math.max(200, (cache?.turnCount ?? 0) * 1_500)),
					currentPrompt: estimateTokens(prompt),
				},
			});

			const llm = await this._llmDecision.decide({
				prompt,
				mode: String(chatRequest?.location ?? 'chat'),
				openFileCount: undefined,
				hasImages,
				conversationGist: cache?.conversationGist,
				previousModelId: prevLiveModel,
				previousTier: cache?.turnState?.tier,
				previousIntent: cache?.turnState?.intent,
				turnCount: (cache?.turnCount ?? 0) + 1,
				frontendSessionActive: frontendSession,
			}, conversationId);

			// Frontend UI → await Design Director + enable Pro/AGENT path when building UI.
			const frontendPinned =
				!isTrivialChatPrompt(prompt)
				&& (
					promptNeedsDesignIntelligence(prompt)
					|| llm.specialty === 'frontend'
					|| frontendSession
					|| /frontend-sticky|sticky-on-/.test(llm.reason)
					|| (prevWasPro && (llm.source === 'error' || llm.source === 'timeout'))
				);
			if (frontendPinned) {
				const designT0 = Date.now();
				const refIntent = detectReferenceSiteIntent(prompt);
				if (refIntent.active) {
					reportChatTurnStatus(
						'Website Cloner',
						`Analyzing reference → ${refIntent.urls[0]}${refIntent.urls.length > 1 ? ` (+${refIntent.urls.length - 1})` : ''}`,
					);
				}
				reportChatTurnStatus('Design Intelligence', 'Frontend specialty detected — preparing Design Spec…');
				const workspaceRoot =
					typeof process !== 'undefined' && process.env.SINGULARITY_WORKSPACE_ROOT
						? process.env.SINGULARITY_WORKSPACE_ROOT
						: undefined;
				let root = workspaceRoot;
				try {
					const vscode = await import('vscode');
					root = root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
				} catch {
					/* ignore */
				}

				const alreadyHasSpec = hasReusableDesignSpec(conversationId, root);
				// When Spec exists: reuse immediately (background refresh if needed) and run planner in parallel.
				// Greenfield: await Director + planner together so Spec lands before implementer.
				let directorSpecPath: string | undefined;
				const stopDirectorHeartbeat = alreadyHasSpec
					? undefined
					: startChatTurnStatusHeartbeat(
						'Design Director',
						'Writing Design Spec v2 (this can take a minute)…',
					);
				const directorPromise = runDesignDirectorForAgent({
					conversationId,
					prompt,
					workspaceRoot: root,
					waitPolicy: alreadyHasSpec ? 'reuse' : 'blocking',
					log: (msg) => this._logService.info(msg),
				}).then((director) => {
					directorSpecPath = director.specPath;
					return director;
				}).catch((e) => {
					this._logService.warn(
						`[AutomodeService] Design Director failed: ${e instanceof Error ? e.message : String(e)}`,
					);
					setFrontendSessionActive(conversationId, true, root, prompt);
					return undefined;
				}).finally(() => {
					stopDirectorHeartbeat?.();
				});

				const plannerPromise = (async () => {
					try {
						reportChatTurnStatus('Design sources', 'Planning React Bits / GodUI / shadcn…');
						const plan = await this._designSourcePlanner.plan(prompt, conversationId);
						const brief = mergeBriefWithDesignSpec(plan.agentBrief, conversationId);
						setActiveDesignPlan({ ...plan, agentBrief: brief }, conversationId);
						this._logService.info(
							`[AutomodeService] design sources use=[${plan.activeIds.join(',')}] ` +
							`ask=${plan.questions.length} src=${plan.source}` +
							(directorSpecPath ? ` spec=${directorSpecPath}` : alreadyHasSpec ? ' spec=reuse' : ' spec=pending'),
						);
						reportChatTurnStatus(
							'Design sources',
							`Enabled: ${plan.activeIds.join(', ') || 'defaults'}`,
						);
					} catch (e) {
						this._logService.warn(
							`[AutomodeService] design-source planner failed: ${e instanceof Error ? e.message : String(e)}`,
						);
						const fallback = mergeBriefWithDesignSpec(
							'Singularity Design Intelligence active — follow Design Specification. Libraries are tools, not art direction.',
							conversationId,
						);
						setActiveDesignBrief(fallback);
					}
				})();

				if (alreadyHasSpec) {
					reportChatTurnStatus('Design Spec', 'Reusing existing Spec…');
					// Overlap: don't block routing on Director; planner can finish with existing Spec.
					await Promise.all([directorPromise, plannerPromise]);
				} else {
					// Need Spec before implementer — still parallelize Director + planner.
					await Promise.all([directorPromise, plannerPromise]);
					// Re-merge brief once Spec is in session (planner may have raced ahead).
					try {
						const brief = mergeBriefWithDesignSpec(
							'Singularity Design Intelligence active — follow Design Specification. Libraries are tools, not art direction.',
							conversationId,
						);
						setActiveDesignBrief(brief);
					} catch {
						/* ignore */
					}
				}
				// #region agent log
				fetch('http://127.0.0.1:7317/ingest/c078ac08-8779-46ff-b139-9beac8ffe002',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'f71a1a'},body:JSON.stringify({sessionId:'f71a1a',runId:'post-fix',hypothesisId:'H2',location:'automodeService.ts:designWait',message:'automode design director+planner wait',data:{ms:Date.now()-designT0,alreadyHasSpec:hasReusableDesignSpec(conversationId, root)},timestamp:Date.now()})}).catch(()=>{});
				// #endregion
			} else {
				// Avoid leaking a stale frontend brief into backend/infra turns
				setActiveDesignBrief('');
				setFrontendSessionActive(conversationId, false);
			}
			const forcedFrontendModel = FRONTEND_OWNER_MODEL_ID;

			// Keyword router is the only picker. Bridge / Nemotron catalog kept for later.
			const bridged = undefined;
			const useBridge = false;
			/*
			const bridged = chatRequest
				? this._singularityRouter.route(chatRequest, knownEndpoints, availableIds)
				: undefined;
			const useBridge = Boolean(
				!frontendPinned
				&& bridged
				&& llm.source !== 'llm'
				&& (bridged.decision.intentConfidence > llm.confidence + 0.15),
			);
			*/
			const catalogWant = remapDisabledDeepSeekPro(
				frontendPinned
					? forcedFrontendModel
					: useBridge
						? bridged!.decision.recommendedModelId
						: llm.modelId,
			);
			const catalogTier = frontendPinned ? 'T2' : useBridge ? bridged!.decision.tier : llm.tier;
			const catalogSub = frontendPinned ? 'T2.1' : useBridge ? bridged!.decision.subTier : llm.subTier;
			const catalogIntent = frontendPinned ? 'AGENT' : useBridge ? bridged!.decision.intent : llm.intent;
			const catalogConf = useBridge && !frontendPinned ? bridged!.decision.intentConfidence : llm.confidence;

			// 3) Map catalog → live TokenRouter/OpenRouter endpoints
			const prefs = expandCatalogPreferences(
				freeTierSurrogatePreferences(catalogTier, catalogIntent, catalogWant),
			);
			let candidateModelId = this._resolveLiveSurrogate(knownEndpoints, prefs, {
				allowRateLimited: frontendPinned,
			})
				?? (frontendPinned
					? this._matchEndpoint(knownEndpoints, forcedFrontendModel)?.model
					: undefined)
				?? this._pickPreferredGatewayEndpoint(knownEndpoints)?.model
				?? knownEndpoints[0]?.model;

			let candidate: TurnRouteCandidate = {
				modelId: candidateModelId!,
				provider: providerOf(candidateModelId!),
				tier: catalogTier,
				subTier: catalogSub,
				intent: catalogIntent,
				confidence: catalogConf,
				contextTokens: segments.totalTokens,
			};

			// 4) Escalate-before-stream only when confidence is low
			let escalated = escalateCandidateIfNeeded(candidate, (from) => this._escalateTurnCandidate(knownEndpoints, from));
			candidate = escalated.candidate;
			if (candidate.confidence < MIN_ACCEPT_CONFIDENCE) {
				const again = escalateCandidateIfNeeded(
					candidate,
					(from) => this._escalateTurnCandidate(knownEndpoints, from),
				);
				if (again.escalated) {
					candidate = again.candidate;
					escalated = { ...again, escalated: true, reason: escalated.reason ?? again.reason };
				}
			}

			// 5) Affinity / stay — but NEVER keep a premium live model when catalog asks cheaper
			let switchDecision = decideConversationSwitch(cache?.turnState, candidate);
			const prevLive = cache?.endpoint?.model ?? cache?.turnState?.modelId;
			const prevTier = cache?.turnState?.tier;
			const catalogIsCheaper =
				Boolean(prevTier) && tierIndex(catalogTier) < tierIndex(prevTier!);
			const catalogIsFlashBand = parseTier(catalogTier) === 'T0';

			if (catalogIsCheaper || (catalogIsFlashBand && prevLive && candidate.modelId !== prevLive)) {
				// Cost downshift always wins (e.g. "how are you" after a deepseek coding turn).
				switchDecision = {
					action: 'switch',
					modelId: candidate.modelId,
					provider: candidate.provider,
					tier: catalogTier,
					subTier: catalogSub,
					intent: catalogIntent,
					confidence: catalogConf,
					reason: 'cost-downshift',
					preservesProviderCache: false,
					cacheReuseTokens: 0,
				};
			} else if (llm.stay && prevLive && !escalated.escalated) {
				// Honor stay only if this catalog pick actually maps to the current live model.
				// (Bug: lastCatalogModelId === new catalog flash made stay=true while live was still deepseek.)
				const aliasHits = expandCatalogPreferences([catalogWant]);
				const mapsToPrevLive = aliasHits.some((a) => {
					const al = a.toLowerCase();
					const pl = prevLive.toLowerCase();
					return pl === al || pl.endsWith(`/${al}`) || pl.includes(al) || al.includes(pl);
				}) || candidate.modelId === prevLive;
				if (mapsToPrevLive && knownEndpoints.some((e) => e.model === prevLive)) {
					switchDecision = {
						...switchDecision,
						action: 'stay',
						modelId: prevLive,
						provider: providerOf(prevLive),
						tier: cache!.turnState!.tier,
						subTier: cache!.turnState!.subTier,
						reason: 'ling-stay',
						preservesProviderCache: true,
						cacheReuseTokens: segments.unchangedTokens,
					};
					candidate = {
						...candidate,
						modelId: prevLive,
						provider: providerOf(prevLive),
					};
				}
			}
			if (escalated.escalated && switchDecision.action === 'stay') {
				switchDecision = {
					...switchDecision,
					action: 'switch',
					modelId: candidate.modelId,
					provider: candidate.provider,
					tier: candidate.tier,
					subTier: candidate.subTier,
					reason: `escalate:${escalated.reason ?? 'low_confidence'}`,
					preservesProviderCache: false,
					cacheReuseTokens: 0,
				};
			}
			// Explicit catalog switch must win over affinity-stay when live differs
			if (!llm.stay && switchDecision.action === 'stay' && candidate.modelId !== cache?.turnState?.modelId) {
				switchDecision = {
					...switchDecision,
					action: 'switch',
					modelId: candidate.modelId,
					provider: candidate.provider,
					tier: candidate.tier,
					subTier: candidate.subTier,
					reason: llm.reason.includes('downshift') ? 'cost-downshift' : 'ling-switch',
					preservesProviderCache: false,
					cacheReuseTokens: 0,
				};
			}

			const finalModelId = remapDisabledDeepSeekPro(switchDecision.modelId);
			selected = this._forceFlashEndpoint(
				knownEndpoints,
				knownEndpoints.find((e) => e.model === finalModelId)
					?? this._matchEndpoint(knownEndpoints, finalModelId)
					?? this._pickPreferredGatewayEndpoint(knownEndpoints)
					?? knownEndpoints[0],
			);

			if (selected && this._isLikelyFreeTierBlocked(selected.model)) {
				const safe = this._resolveLiveSurrogate(
					knownEndpoints,
					expandCatalogPreferences(
						freeTierSurrogatePreferences(switchDecision.tier, switchDecision.intent, selected.model),
					),
				);
				if (safe) {
					selected = knownEndpoints.find((e) => e.model === safe) ?? this._matchEndpoint(knownEndpoints, safe) ?? selected;
				}
			}

			turnState = applySwitchToState(
				cache?.turnState,
				conversationId,
				{ ...switchDecision, modelId: selected!.model, provider: providerOf(selected!.model) },
				hashContent(prompt),
				segments.totalTokens,
			);

			const conversationGist = appendConversationGist(
				cache?.conversationGist,
				prompt,
				catalogWant,
				catalogIntent,
			);

			this._lastRoutingDecision = {
				resolvedModel: remapDisabledDeepSeekPro(selected!.model),
				resolvedModelName: /deepseek-v4-pro/i.test(selected!.model)
					? 'DeepSeek V4 Flash-0731'
					: selected!.name,
				predictedLabel: candidate.intent === 'DEBUG' || parseTier(candidate.tier) >= 'T3' ? 'needs_reasoning' : 'no_reasoning',
				confidence: candidate.confidence,
			};

			reportChatTurnStatus('Working', 'Running the request…');

			const prevModel = cache?.turnState?.modelId ?? '(none)';
			this._logService.info(
				`[AutomodeService] arch ${switchDecision.action}: ${prevModel} → ${selected!.model} ` +
				`(catalog=${catalogWant}, ${catalogSub}, intent=${catalogIntent}, conf=${catalogConf.toFixed(2)}, ` +
				`src=${llm.source}, decide=${llm.latencyMs}ms, route=${Date.now() - routeStarted}ms` +
				`, stay=${Boolean(llm.stay)}, gistChars=${conversationGist.length}` +
				(escalated.escalated ? `, escalated=${escalated.reason}` : '') +
				`)`,
			);

			this._gatewayCache.set(conversationId, {
				endpoint: selected!,
				lastRoutedPrompt: prompt,
				turnCount: turnState.turnCount,
				turnState,
				segments,
				conversationGist,
				lastCatalogModelId: catalogWant,
			});
			return selected;
		}
		if (!selected) {
			return undefined;
		}

		this._gatewayCache.set(conversationId, {
			endpoint: selected,
			lastRoutedPrompt: prompt,
			turnCount: turnState?.turnCount ?? (cache?.turnCount ?? 0) + (samePrompt ? 0 : 1),
			turnState,
			segments,
			conversationGist: cache?.conversationGist,
			lastCatalogModelId: cache?.lastCatalogModelId,
		});
		return selected;
	}

	private _endpointsForModels(models: LanguageModelChat[]): IChatEndpoint[] {
		const out: IChatEndpoint[] = [];
		for (const model of models) {
			let ep = this._endpointById.get(model.id);
			if (!ep) {
				ep = this._instantiationService.createInstance(ExtensionContributedChatEndpoint, model);
				this._endpointById.set(model.id, ep);
			}
			out.push(ep);
		}
		return out;
	}

	/** First usable live endpoint from an ordered preference list (skips rate-limited / blocked). */
	private _resolveLiveSurrogate(
		endpoints: IChatEndpoint[],
		preferences: string[],
		opts?: { allowRateLimited?: boolean },
	): string | undefined {
		const now = Date.now();
		for (const want of preferences) {
			const hit = this._matchEndpoint(endpoints, want);
			if (!hit) {
				continue;
			}
			const until = this._rateLimitedUntil.get(hit.model) ?? 0;
			if (until > now && !opts?.allowRateLimited) {
				continue;
			}
			if (this._isLikelyFreeTierBlocked(hit.model)) {
				continue;
			}
			return hit.model;
		}
		return undefined;
	}

	private _escalateTurnCandidate(endpoints: IChatEndpoint[], from: TurnRouteCandidate): TurnRouteCandidate | undefined {
		const prefs = expandCatalogPreferences(
			escalateFreeTierPreferences(from.tier, from.intent === 'UNKNOWN' ? 'CODE' : from.intent),
		);
		const id = this._resolveLiveSurrogate(endpoints, prefs);
		if (!id || id === from.modelId) {
			return undefined;
		}
		const nextTierNum = Math.min(6, Number(parseTier(from.tier).slice(1)) + 1);
		return {
			...from,
			modelId: id,
			provider: providerOf(id),
			tier: `T${nextTierNum}`,
			subTier: `T${nextTierNum}.1`,
			intent: from.intent === 'UNKNOWN' ? 'CODE' : from.intent,
			confidence: 0.8,
		};
	}

	/**
	 * Fast Auto pool: direct TokenRouter OpenAI endpoints (no vscode.lm.selectChatModels).
	 * Falls back to LM discovery cache when direct auth is unavailable.
	 * Dynamic import avoids a circular init crash (Class extends value undefined).
	 */
	private async _getSingularityAutoEndpoints(): Promise<IChatEndpoint[]> {
		if (this._directAutoEndpoints?.length) {
			const withoutPro = this._codingEndpoints(this._directAutoEndpoints);
			if (withoutPro.length !== this._directAutoEndpoints.length) {
				this._directAutoEndpoints = withoutPro.length ? withoutPro : undefined;
				this._endpointById.clear();
			}
		}
		if (this._directAutoEndpoints?.length) {
			const deepseek = getDeepSeekDirectConfig();
			const staleDeepSeek = Boolean(deepseek) && this._directAutoEndpoints.some((ep) => {
				const url = typeof ep.urlOrRequestMetadata === 'string' ? ep.urlOrRequestMetadata : '';
				return isDeepSeekDirectRoutingModel(ep.model) && !isDeepSeekDirectBaseUrl(url);
			});
			if (!staleDeepSeek) {
				return this._directAutoEndpoints;
			}
			this._logService.info('[AutomodeService] Rebuilding Auto pool — DeepSeek official API is configured but cached endpoints still target TokenRouter');
			this._directAutoEndpoints = undefined;
			this._endpointById.clear();
		}
		const started = Date.now();
		try {
			const { createTokenRouterAutoEndpoints } = await import('../../../extension/byok/vscode-node/tokenRouterEndpoint');
			const direct = await createTokenRouterAutoEndpoints(
				this._instantiationService,
				AUTO_ROUTABLE_MODEL_IDS,
			);
			if (direct.length) {
				for (const ep of direct) {
					this._endpointById.set(ep.model, ep);
				}
				this._directAutoEndpoints = direct;
				this._logService.info(
					`[AutomodeService] Direct TokenRouter endpoints ready: ${direct.length} in ${Date.now() - started}ms`,
				);
				return direct;
			}
		} catch (e) {
			this._logService.warn(
				`[AutomodeService] Direct TokenRouter endpoints failed: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
		const models = await this._getChatModels();
		return this._endpointsForModels(models);
	}

	private async _getChatModels(): Promise<LanguageModelChat[]> {
		const now = Date.now();
		if (this._modelsCache && now - this._modelsCache.fetchedAt < AutomodeService.MODELS_TTL_MS) {
			return this._modelsCache.models;
		}
		// Prefer stale cache forever for Auto — never block a turn on /models.
		if (this._modelsCache?.models.length) {
			return this._modelsCache.models;
		}
		// Only discover once if nothing is cached; dedupe concurrent callers.
		return this._refreshChatModels();
	}

	private _modelsRefresh: Promise<LanguageModelChat[]> | undefined;

	private async _refreshChatModels(): Promise<LanguageModelChat[]> {
		if (this._modelsRefresh) {
			return this._modelsRefresh;
		}
		this._modelsRefresh = (async () => {
			const now = Date.now();
			const started = Date.now();
			let models: LanguageModelChat[] = [];
			try {
				const tokenrouter = await lm.selectChatModels({ vendor: 'tokenrouter' });
				models = tokenrouter;
			} catch (e) {
				this._logService.warn(`[AutomodeService] Gateway model discovery failed: ${(e as Error).message}`);
				return this._modelsCache?.models ?? [];
			}
			const routable = new Set(AUTO_ROUTABLE_MODEL_IDS.map((id) => id.toLowerCase()));
			const slim = models.filter((m) => {
				const id = m.id.toLowerCase();
				if (/(embed|rerank|tts|whisper|transcribe|imagen|flux|seedream|seedance|veo|wan-v|kling|gpt-image|grok-imagine|grok-stt|voyage)/.test(id)) {
					return false;
				}
				if (/deepseek-v4-pro/i.test(id)) {
					return false;
				}
				return [...routable].some((want) => id === want || id.endsWith(`/${want}`) || id.includes(want));
			});
			// Permanent model pin: Auto Mode may only pool DeepSeek V4 Flash.
			// Previously a broad fallback admitted every non-image model (e.g.
			// gpt-5-mini) whenever the allowlisted match came back empty, which
			// let Auto Mode resolve to non-DeepSeek models. The pool is now the
			// allowlisted match only — if it is empty, Auto serves nothing from
			// this discovery path rather than a wrong model.
			const pool = slim;
			this._modelsCache = { models: pool, fetchedAt: now };
			this._logService.info(`[AutomodeService] Gateway LM catalog: ${pool.length} models (from ${models.length}) in ${Date.now() - started}ms`);
			return pool;
		})().finally(() => {
			this._modelsRefresh = undefined;
		});
		return this._modelsRefresh;
	}

	private _codingEndpoints(endpoints: IChatEndpoint[]): IChatEndpoint[] {
		return endpoints.filter((e) => !/deepseek-v4-pro/i.test(e.model));
	}

	/**
	 * Permanent model pin: only DeepSeek V4 Flash 0731 may be used for Auto
	 * coding. Any selection the router/server or fallback produced (e.g.
	 * gpt-5-mini, claude-haiku) is remapped to the Flash endpoint from the
	 * pool. This runs as the final override after the router decision and
	 * vision fallback, so no non-DeepSeek model can reach the turn.
	 */
	private _forceFlashEndpoint(
		endpoints: IChatEndpoint[],
		selected: IChatEndpoint | undefined,
	): IChatEndpoint | undefined {
		if (selected && /deepseek-v4-flash/i.test(selected.model)) {
			return selected;
		}
		const pool = this._codingEndpoints(endpoints);
		const flash =
			this._matchEndpoint(pool, DEEPSEEK_FLASH_MODEL_ID)
			?? this._pickPreferredGatewayEndpoint(pool)
			?? pool[0];
		if (flash && selected && !/deepseek-v4-flash/i.test(selected.model)) {
			this._logService.info(
				`[AutomodeService] Model pin — remapping ${selected.model} → ${flash.model}`,
			);
		}
		return flash ?? selected;
	}

	/** Fuzzy-match catalog modelId to a live gateway endpoint. */
	private _matchEndpoint(endpoints: IChatEndpoint[], modelId: string): IChatEndpoint | undefined {
		const want = modelId.toLowerCase();
		const exact = endpoints.find((e) => e.model.toLowerCase() === want);
		if (exact) {
			return exact;
		}
		const suffix = want.includes('/') ? want.slice(want.lastIndexOf('/') + 1) : want;
		// Prefer exact suffix match; never let plain `deepseek-v4-flash` satisfy a
		// request for `deepseek-v4-flash-0731` (or vice versa via loose includes).
		const exactSuffix = endpoints.find((e) => {
			const id = e.model.toLowerCase();
			return id === suffix || id.endsWith(`/${suffix}`);
		});
		if (exactSuffix) {
			return exactSuffix;
		}
		return endpoints.find((e) => {
			const id = e.model.toLowerCase();
			if (want.includes('flash-0731') && !id.includes('flash-0731')) {
				return false;
			}
			if (id.includes('flash-0731') && want.includes('flash') && !want.includes('flash-0731')) {
				// Allow remapping legacy flash → 0731 when that's the live endpoint
				return id.includes(suffix) || id.includes(want);
			}
			return id.includes(suffix) || id.includes(want);
		});
	}

	/**
	 * Prefer models that typically work on the OpenRouter free tier.
	 * Claude / GPT-5 / Opus are commonly 403 RestrictedModelsError without paid credits.
	 * Skip models that recently returned free-tier 429s.
	 */
	private _pickPreferredGatewayEndpoint(endpoints: IChatEndpoint[]): IChatEndpoint | undefined {
		const now = Date.now();
		const preference = expandCatalogPreferences([
			'deepseek/deepseek-v4-flash-0731',
		]);
		const usable = (e: IChatEndpoint) => {
			const until = this._rateLimitedUntil.get(e.model) ?? 0;
			return until <= now && !this._isLikelyFreeTierBlocked(e.model);
		};
		for (const id of preference) {
			const hit = endpoints.find((e) => (e.model === id || e.model.endsWith(`/${id}`) || e.model.includes(id)) && usable(e));
			if (hit) {
				return hit;
			}
		}
		return endpoints.find(usable);
	}

	/** Call when a gateway Auto pick hits free-tier 429 so the next turn can rotate — keep sticky state. */
	markModelRateLimited(modelId: string): void {
		this._rateLimitedUntil.set(modelId, Date.now() + AutomodeService.RATE_LIMIT_COOLDOWN_MS);
		// Preserve turnState / gist so decision sticky still knows the prior Pro/frontend turn.
		// Only clear the live endpoint pin so the next resolve re-evaluates transport.
		for (const [key, entry] of this._gatewayCache) {
			if (entry.endpoint.model === modelId || modelsEqualLoose(entry.endpoint.model, modelId)) {
				this._gatewayCache.set(key, {
					...entry,
					// Keep lastRoutedPrompt so same-prompt reuse can still apply sticky Pro.
					endpoint: entry.endpoint,
				});
			}
		}
		this._logService.warn(
			`[AutomodeService] Gateway model ${modelId} rate-limited; cooling down 60s (sticky turn state preserved).`,
		);
	}

	async resolveRateLimitFailover(failedModelId: string, chatRequest?: IAutoModeRoutingRequest): Promise<IChatEndpoint | undefined> {
		this.markModelRateLimited(failedModelId);
		if (chatRequest) {
			this.invalidateRouterCache(chatRequest);
		}
		const endpoints = await this._getSingularityAutoEndpoints();
		const next = this._pickPreferredGatewayEndpoint(
			endpoints.filter((e) => !modelsEqualLoose(e.model, failedModelId)),
		);
		if (next) {
			this._logService.warn(
				`[AutomodeService] Rate-limit failover: ${failedModelId} → ${next.model}`,
			);
		}
		return next;
	}

	private _isLikelyFreeTierBlocked(modelId: string): boolean {
		const id = modelId.toLowerCase();
		// TokenRouter lists deepseek-v3.2 but upstream rejects it (only v4-pro / v4-flash).
		if (id.includes('deepseek-v3.2') || id.endsWith('/deepseek-v3.2') || id === 'deepseek-v3.2') {
			return true;
		}
		// TokenRouter can serve Claude/GPT-5; only block known non-chat modalities.
		return /(embed|rerank|tts|whisper|transcribe|imagen|flux|seedream|seedance|veo|wan-v|kling|gpt-image)/.test(id);
	}

	/**
	 * Resolves via `POST /auto`. Returns `undefined` when V2 cannot serve the
	 * request, so the caller falls back to the legacy flow.
	 */
	private async _tryResolveWithAutoV2(chatRequest: IAutoModeRoutingRequest | undefined, knownEndpoints: IChatEndpoint[]): Promise<IChatEndpoint | undefined> {
		const conversationId = chatRequest?.sessionResource?.toString() ?? chatRequest?.sessionId ?? 'unknown';
		const prompt = chatRequest?.prompt?.trim();
		// `/auto` needs a prompt. Non-panel locations stay on the legacy flow,
		// which applies their location-specific model hints.
		if (!prompt?.length || conversationId === 'unknown' || !this._isRouterEnabled(chatRequest)) {
			return undefined;
		}

		const entry = this._autoV2Cache.get(conversationId);
		// The token lasts 24h with no refresh, so reuse the endpoint for the rest
		// of the conversation. A turn that newly attaches an image must
		// re-resolve, since the cached model was picked without that constraint.
		const cacheUsable = entry && !entry.needsReEval && entry.turnCount > 0
			&& !this._isAutoV2SessionExpired(entry)
			&& (!hasImage(chatRequest) || entry.endpoint.supportsVision);
		if (cacheUsable) {
			return entry.endpoint;
		}

		try {
			const result = await this._autoV2Fetcher.getAutoDecision(prompt, {
				hasImage: hasImage(chatRequest),
				conversationId,
				vscodeRequestId: chatRequest?.id,
			});
			this._setLastAutoV2Discounts(result.discounted_costs);

			// Prefer local `/models` metadata: it carries fields `/auto` leaves
			// unset (token pricing, promos, SKU restrictions, thinking budgets).
			// If the model is missing locally the two have drifted, so fall back
			// to the embedded metadata rather than giving up.
			let selectedModel = knownEndpoints.find(e => e.model === result.selected_model.id);
			if (!selectedModel) {
				selectedModel = this._createEndpointFromAutoV2Metadata(result.selected_model);
				if (!selectedModel) {
					this._logService.warn(`[AutomodeService] Auto v2 selected '${result.selected_model.id}' which is not in knownEndpoints=[${knownEndpoints.map(e => e.model).join(', ')}] and its metadata was not usable; falling back to the legacy flow.`);
					this._sendAutoV2FallbackTelemetry('noMatchingEndpoint');
					return undefined;
				}
				this._logService.info(`[AutomodeService] Auto v2 selected '${result.selected_model.id}' which is not in knownEndpoints; using the metadata embedded in the /auto response.`);
				this._sendAutoV2FallbackTelemetry('embeddedMetadata');
			}

			// The server pre-filters on `has_image`, but the client is ultimately
			// responsible for not sending an image to a model that rejects it.
			if (hasImage(chatRequest) && !selectedModel.supportsVision) {
				this._logService.warn(`[AutomodeService] Auto v2 selected '${selectedModel.model}' which does not support vision for an image request; falling back to the legacy flow.`);
				this._sendAutoV2FallbackTelemetry('noVisionSupport');
				return undefined;
			}

			const endpoint = (entry?.endpoint && entry.sessionToken === result.session_token && entry.endpoint.model === selectedModel.model)
				? entry.endpoint
				: this._instantiationService.createInstance(AutoChatEndpoint, selectedModel, result.session_token, result.discounted_costs?.[selectedModel.model] || 0, this._calculateDiscountRange(result.discounted_costs));

			this._autoV2Cache.set(conversationId, {
				endpoint,
				sessionToken: result.session_token,
				expiresAt: result.expires_at,
				lastRoutedPrompt: prompt,
				turnCount: (entry?.turnCount ?? 0) + (entry?.lastRoutedPrompt === prompt ? 0 : 1),
				needsReEval: false,
			});
			return endpoint;
		} catch (e) {
			const reason = this._classifyAutoV2Failure(e);
			// A 404 means we are gated off; stop retrying on every turn.
			if (e instanceof AutoV2Error && e.status === 404) {
				this._autoV2Unavailable = true;
				this._logService.info(`[AutomodeService] Auto v2 endpoint unavailable (404); using the legacy flow for the rest of the session.`);
			}
			this._logService.error(`[AutomodeService] Auto v2 failed for conversation ${conversationId} (${reason}):`, (e as Error).message);
			this._sendAutoV2FallbackTelemetry(reason);
			// Prefer the last known good endpoint over the legacy round-trips.
			if (entry && !this._isAutoV2SessionExpired(entry) && (!hasImage(chatRequest) || entry.endpoint.supportsVision)) {
				return entry.endpoint;
			}
			return undefined;
		}
	}

	/**
	 * Builds an endpoint from the metadata embedded in a `POST /auto` response,
	 * for when the selected model is missing from the local `/models` view.
	 * Returns `undefined` if the payload lacks the fields needed to build a request.
	 */
	private _createEndpointFromAutoV2Metadata(model: AutoV2SelectedModel): IChatEndpoint | undefined {
		const capabilities = model.capabilities;
		// `/auto` only selects chat models and omits the `type` discriminator
		// that `/models` sets, so treat an absent type as chat.
		if (!capabilities || (capabilities.type !== undefined && capabilities.type !== 'chat') || !capabilities.family || !capabilities.tokenizer) {
			return undefined;
		}
		const chatCapabilities: IChatModelCapabilities = {
			...(capabilities as IChatModelCapabilities),
			type: 'chat',
			supports: (capabilities as IChatModelCapabilities).supports ?? { streaming: true },
		};
		const modelInformation: IChatModelInformation = {
			...model,
			id: model.id,
			name: model.name ?? model.id,
			version: model.version ?? 'unknown',
			vendor: model.vendor ?? 'singularity',
			is_chat_default: false,
			is_chat_fallback: false,
			model_picker_enabled: model.model_picker_enabled ?? true,
			capabilities: chatCapabilities,
		};
		return this._instantiationService.createInstance(SingularityChatEndpoint, modelInformation);
	}

	private _isAutoV2SessionExpired(entry: AutoV2CacheEntry): boolean {
		// Renew early so a long request cannot outlive its token.
		return entry.expiresAt * 1000 - Date.now() < 5 * 60 * 1000;
	}

	private _classifyAutoV2Failure(e: unknown): string {
		if (isAbortError(e)) {
			return 'autoV2Timeout';
		}
		if (e instanceof AutoV2Error) {
			return e.errorCode ?? `autoV2Status${e.status}`;
		}
		return 'autoV2Error';
	}

	private _sendAutoV2FallbackTelemetry(reason: string): void {
		/* __GDPR__
			"automode.autoV2Fallback" : {
				"owner": "lramos15",
				"comment": "Reports when the single-call Auto endpoint (POST /auto) cannot be used and auto mode falls back to the legacy session + intent flow",
				"reason": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "Why the single-call endpoint could not be used as-is, e.g. autoV2Timeout, autoV2Error, noMatchingEndpoint, noVisionSupport, embeddedMetadata (the selected model was built from the /auto payload because it was missing locally), or a server status/error code" }
			}
		*/
		this._telemetryService.sendMSFTTelemetryEvent('automode.autoV2Fallback', { reason });
	}

	private _acquireTokenBank(entry: AutoModelCacheEntry | undefined, location: ChatLocation | undefined, conversationId: string): AutoModeTokenBank {
		if (entry) {
			return entry.tokenBank;
		}
		const loc = location ?? ChatLocation.Panel;
		const tokenBank = this._reserveTokens.deleteAndLeak(loc) || new AutoModeTokenBank('reserve', loc, this._capiClientService, this._authService, this._logService, this._expService, this._envService);
		this._reserveTokens.set(loc, new AutoModeTokenBank('reserve', loc, this._capiClientService, this._authService, this._logService, this._expService, this._envService));
		tokenBank.debugName = conversationId;
		return tokenBank;
	}

	private async _tryRouterSelection(
		chatRequest: IAutoModeRoutingRequest | undefined,
		conversationId: string,
		entry: AutoModelCacheEntry | undefined,
		token: AutoModeAPIResponse,
		knownEndpoints: IChatEndpoint[],
		imageTelemetryEventMeasurements: Partial<ImageTelemetryMeasurements>,
	): Promise<{ selectedModel?: IChatEndpoint; lastRoutedPrompt?: string; fallbackReason?: string; candidateModel?: string; routingDecision?: AutoModeRoutingDecision }> {
		const prompt = chatRequest?.prompt?.trim();
		const lastRoutedPrompt = entry?.lastRoutedPrompt ?? prompt;

		if (!this._isRouterEnabled(chatRequest) || conversationId === 'unknown') {
			return { lastRoutedPrompt };
		}

		if (!prompt?.length) {
			return { lastRoutedPrompt, fallbackReason: 'emptyPrompt' };
		}

		// Prompt hasn't changed since last decision — skip router but allow endpoint refresh
		if (entry && entry.lastRoutedPrompt === prompt) {
			return { lastRoutedPrompt };
		}

		try {
			const contextSignals: RoutingContextSignals = {
				session_id: conversationId !== 'unknown' ? conversationId : undefined,
				reference_count: chatRequest?.references?.length,
				prompt_char_count: prompt.length,
				previous_model: entry?.endpoint?.model,
				turn_number: (entry?.turnCount ?? 0) + 1,
			};
			const routingMethod = 'hydra';

			// Filter available_models to only those the client can actually serve.
			// The AutoModels API and Models API are separate CAPI calls that can be
			// out of sync (e.g. a new model appears in available_models before the
			// Models API returns it). Sending unresolvable models to the router
			// causes it to recommend models the client must silently discard.
			const knownModelIds = new Set(knownEndpoints.map(e => e.model));
			const routableModels: string[] = [];
			const droppedModels: string[] = [];
			for (const m of token.available_models) {
				(knownModelIds.has(m) ? routableModels : droppedModels).push(m);
			}
			if (!routableModels.length) {
				this._logService.warn(`[AutomodeService] No available_models matched knownEndpoints. available_models=[${token.available_models.join(', ')}], knownEndpoints=[${knownEndpoints.map(e => e.model).join(', ')}]`);
				return { lastRoutedPrompt: prompt, fallbackReason: 'noMatchingEndpoint' };
			}
			if (droppedModels.length) {
				this._logService.info(`[AutomodeService] Filtered ${droppedModels.length} unresolvable model(s) before routing: [${droppedModels.join(', ')}]`);
			}

			const result = await this._routerDecisionFetcher.getRouterDecision(prompt, token.session_token, routableModels, undefined, contextSignals, conversationId, chatRequest?.id, routingMethod, hasImage(chatRequest), imageTelemetryEventMeasurements);

			if (result.fallback) {
				this._logService.info(`[AutomodeService] Router signaled fallback: ${result.fallback_reason ?? 'unknown'}, routing_method=${result.routing_method ?? 'n/a'}`);
				return { lastRoutedPrompt: prompt, fallbackReason: 'routerFallback' };
			}

			if (!result.candidate_models.length) {
				return { lastRoutedPrompt: prompt, fallbackReason: 'emptyCandidateList' };
			}

			// Prefer chosen_model — it is the router's authoritative pick after any
			// server-side re-ranking (e.g. Cost Sorting experiments). candidate_models
			// is the ordered fallback list per the auto-intent-service contract
			// (docs/integrators_onboarding.md: "Use chosen_model for the upcoming chat
			// call, and use candidate_models as the ordered fallback list").
			// Same-provider preference is intentionally NOT applied here — the router
			// already accounts for available models and re-runs after /compact, so
			// overriding its pick with same-provider negates cost-saving decisions.
			// Same-provider is still used in _selectDefaultModel (the non-router fallback).
			const routerModel = result.chosen_model ?? result.candidate_models[0];
			let selectedModel = result.chosen_model ? knownEndpoints.find(e => e.model === result.chosen_model) : undefined;
			if (!selectedModel) {
				selectedModel = this._findFirstAvailableModel(result.candidate_models, knownEndpoints);
			}

			if (!selectedModel) {
				this._logService.warn(`[AutomodeService] Router pick not in knownEndpoints: chosen_model=${result.chosen_model ?? 'n/a'}, candidate_models=[${result.candidate_models.join(', ')}]`);
				return { lastRoutedPrompt: prompt, fallbackReason: 'noMatchingEndpoint' };
			}
			selectedModel = this._forceFlashEndpoint(knownEndpoints, selectedModel) ?? selectedModel;

			if (result.sticky_override) {
				this._logService.trace(`[AutomodeService] Sticky routing override: confidence=${(result.confidence * 100).toFixed(1)}%, label=${result.predicted_label}, router_model=${routerModel}, actual_model=${selectedModel.model}`);
			}
			return {
				selectedModel,
				lastRoutedPrompt: prompt,
				candidateModel: routerModel,
				routingDecision: {
					resolvedModel: selectedModel.model,
					resolvedModelName: selectedModel.name,
					predictedLabel: result.predicted_label,
					confidence: result.confidence,
				},
			};
		} catch (e) {
			const isTimeout = isAbortError(e);
			let fallbackReason: string;
			if (isTimeout) {
				fallbackReason = 'routerTimeout';
			} else if (e instanceof RouterDecisionError && e.errorCode) {
				fallbackReason = e.errorCode;
			} else {
				fallbackReason = 'routerError';
			}
			this._logService.error(`Failed to get routed model for conversation ${conversationId} (${fallbackReason}):`, (e as Error).message);
			return { lastRoutedPrompt: prompt, fallbackReason };
		}
	}

	private _selectDefaultModel(currentModelProvider: string | undefined, availableModels: string[], knownEndpoints: IChatEndpoint[]): IChatEndpoint {
		const pool = this._codingEndpoints(knownEndpoints);
		const selectedModel = (currentModelProvider ? this._findSameProviderModel(currentModelProvider, availableModels, pool) : undefined)
			?? this._findFirstAvailableModel(availableModels, pool);
		if (selectedModel) {
			return selectedModel;
		}
		// AutoModels (cached up to 6h in the SingularityToken) and the Models API
		// (refreshed every 10min) are independent CAPI calls and can drift, so
		// `available_models` may have zero overlap with `knownEndpoints` (e.g.
		// a model was removed server-side after the token was minted). Rather
		// than throwing "Auto mode failed: no available model found in known
		// endpoints" and breaking the chat, fall back to the first known
		// endpoint so the user can keep working. Emit telemetry so we can
		// monitor how often this happens.
		const fallbackEndpoint = this._forceFlashEndpoint(pool.length ? pool : knownEndpoints, pool[0] ?? knownEndpoints[0]);
		this._logService.warn(
			`[AutomodeService] No available_models matched knownEndpoints; using fallback endpoint '${fallbackEndpoint.model}'. ` +
			`available_models=[${availableModels.join(', ')}], knownEndpoints=[${knownEndpoints.map(e => e.model).join(', ')}]`,
		);
		/* __GDPR__
			"automode.noEndpointFallback" : {
				"owner": "aashnagarg",
				"comment": "Reports when AutoModels available_models has no overlap with knownEndpoints and the client falls back to the first known endpoint instead of failing.",
				"availableModelCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true, "comment": "Number of models in the AutoModels response" },
				"knownEndpointCount": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true, "comment": "Number of known endpoints from the Models API" },
				"fallbackModel": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "comment": "The model selected as the safe fallback" }
			}
		*/
		this._telemetryService.sendMSFTTelemetryEvent('automode.noEndpointFallback',
			{ fallbackModel: fallbackEndpoint.model },
			{ availableModelCount: availableModels.length, knownEndpointCount: knownEndpoints.length },
		);
		return fallbackEndpoint!;
	}

	private _isRouterEnabled(chatRequest: IAutoModeRoutingRequest | undefined): boolean {
		const isPanelChat = !chatRequest?.location || chatRequest?.location === ChatLocation.Panel;
		return isPanelChat;
	}

	/**
	 * Find the first model in available_models that has a known endpoint.
	 */
	private _findFirstAvailableModel(availableModels: string[], knownEndpoints: IChatEndpoint[]): IChatEndpoint | undefined {
		for (const model of availableModels) {
			const endpoint = knownEndpoints.find(e => e.model === model);
			if (endpoint) {
				return endpoint;
			}
		}
		return undefined;
	}

	/**
	 * Find the first model in available_models whose knownEndpoint has the same modelProvider
	 * as the current model. Skips any model that doesn't have a known endpoint.
	 */
	private _findSameProviderModel(currentModelProvider: string, availableModels: string[], knownEndpoints: IChatEndpoint[]): IChatEndpoint | undefined {
		for (const model of availableModels) {
			const endpoint = knownEndpoints.find(e => e.model === model);
			if (endpoint && endpoint.modelProvider === currentModelProvider) {
				return endpoint;
			}
		}
		return undefined;
	}

	/**
	 * If the request contains an image and the selected model doesn't support vision,
	 * fall back to the first vision-capable model from the available models.
	 */
	private _applyVisionFallback(chatRequest: IAutoModeRoutingRequest | undefined, selectedModel: IChatEndpoint, availableModels: string[], knownEndpoints: IChatEndpoint[]): IChatEndpoint {
		if (!hasImage(chatRequest) || selectedModel.supportsVision) {
			return selectedModel;
		}
		const visionModel = availableModels
			.map(model => knownEndpoints.find(e => e.model === model))
			.find(endpoint => endpoint?.supportsVision);
		if (visionModel) {
			this._logService.trace(`Selected model '${selectedModel.model}' does not support vision, falling back to '${visionModel.model}'.`);
			return visionModel;
		}
		this._logService.warn(`Request contains an image but no vision-capable model is available.`);
		return selectedModel;
	}

	private _calculateDiscountRange(discounts: Record<string, number> | undefined): { low: number; high: number } {
		if (!discounts) {
			return { low: 0, high: 0 };
		}
		let low = Infinity;
		let high = -Infinity;
		let hasValues = false;

		for (const value of Object.values(discounts)) {
			hasValues = true;
			if (value < low) {
				low = value;
			}
			if (value > high) {
				high = value;
			}
		}
		return hasValues ? { low, high } : { low: 0, high: 0 };
	}
}

function modelsEqualLoose(a: string, b: string): boolean {
	const na = a.toLowerCase();
	const nb = b.toLowerCase();
	return na === nb || na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`) || na.includes(nb) || nb.includes(na);
}

function hasImage(chatRequest: IAutoModeRoutingRequest | undefined): boolean {
	if (!chatRequest || !chatRequest.references) {
		return false;
	}
	return chatRequest.references.some(ref => {
		const value = ref.value;
		return typeof value === 'object' &&
			value !== null &&
			'mimeType' in value &&
			typeof value.mimeType === 'string'
			&& value.mimeType.startsWith('image/');
	});
}
