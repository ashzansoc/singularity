/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { LanguageModelChatInformation, LanguageModelChatProvider, commands, lm } from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { Disposable, DisposableStore, IDisposable } from '../../../util/vs/base/common/lifecycle';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { BYOKKnownModels, isClientBYOKAllowed } from '../../byok/common/byokProvider';
import { IExtensionContribution } from '../../common/contributions';
import { AbstractLanguageModelChatProvider } from './abstractLanguageModelChatProvider';
import { AnthropicLMProvider } from './anthropicProvider';
import { AzureBYOKModelProvider } from './azureProvider';
import { BYOKStorageService, IBYOKStorageService } from './byokStorageService';
import { CustomEndpointBYOKModelProvider } from './customEndpointProvider';
import { CustomOAIBYOKModelProvider } from './customOAIProvider';
import { GeminiNativeBYOKLMProvider } from './geminiNativeProvider';
import { OllamaLMProvider } from './ollamaProvider';
import { OAIBYOKLMProvider } from './openAIProvider';
import { OpenRouterLMProvider } from './openRouterProvider';
import { TokenRouterLMProvider } from './tokenRouterProvider';
import { XAIBYOKLMProvider } from './xAIProvider';
import { applySingularityBundledEnv, ensureFreshTokenRouterApiKey, getDeepSeekDirectConfig, getTokenRouterApiKey, prefersOwnLlmCredentialsOverBeta, setBetaTokenRefreshListener, startBetaAuthRefreshLoop } from '../../../platform/env/node/singularityBundledEnv';

export class BYOKContrib extends Disposable implements IExtensionContribution {
	public readonly id: string = 'byok-contribution';
	private readonly _byokStorageService: IBYOKStorageService;
	private readonly _providers: Map<string, LanguageModelChatProvider<LanguageModelChatInformation>> = new Map();
	/** Non-TokenRouter BYOK vendors — safe to clear when Singularity entitlement drops. */
	private readonly _otherProviderRegistrations = this._register(new DisposableStore());
	/** TokenRouter must stay registered independently — never cleared with other BYOK vendors. */
	private _tokenRouterRegistration: IDisposable | undefined;
	private _providersRegistered = false;
	private _knownModelsRefreshed = false;
	private _knownModelsRefreshTargets: ReadonlyArray<readonly [string, AbstractLanguageModelChatProvider]> = [];
	private _seedInFlight: Promise<void> | undefined;

	constructor(
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
		@IAuthenticationService private readonly _authService: IAuthenticationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this._byokStorageService = new BYOKStorageService(extensionContext);
		applySingularityBundledEnv();
		const deepseek = getDeepSeekDirectConfig();
		if (deepseek) {
			this._logService.info(
				`[BYOK] Using DeepSeek official API @ ${deepseek.baseUrl} (Pro + Flash bypass beta TokenRouter)`,
			);
		} else if (prefersOwnLlmCredentialsOverBeta()) {
			this._logService.info('[BYOK] Using own TokenRouter API key (beta proxy bypassed)');
		}
		this._register(startBetaAuthRefreshLoop());
		setBetaTokenRefreshListener(token => {
			void this._seedBundledGatewayKeys(token);
		});
		// TokenRouter first — Singularity Auto must not wait on Singularity entitlement.
		// Seed the gateway key before other auth work so the first chat request
		// finds BYOK models instead of the setup-agent "Please try again." race.
		this._ensureTokenRouterRegistered();
		void this._seedBundledGatewayKeys();
		this._applyPolicy();
		this._register(this._authService.onDidAuthenticationChange(() => this._applyPolicy()));
	}

	override dispose(): void {
		setBetaTokenRefreshListener(undefined);
		this._tokenRouterRegistration?.dispose();
		this._tokenRouterRegistration = undefined;
		super.dispose();
	}

	private _buildProviders(): void {
		const instantiationService = this._instantiationService;

		const anthropic = instantiationService.createInstance(AnthropicLMProvider, undefined, this._byokStorageService);
		const gemini = instantiationService.createInstance(GeminiNativeBYOKLMProvider, undefined, this._byokStorageService);
		const xai = instantiationService.createInstance(XAIBYOKLMProvider, {}, this._byokStorageService);
		const openai = instantiationService.createInstance(OAIBYOKLMProvider, {}, this._byokStorageService);

		this._providers.set(OllamaLMProvider.providerId, instantiationService.createInstance(OllamaLMProvider, this._byokStorageService));
		// DISABLED: Anthropic/Claude disabled - use only DeepSeek
		// this._providers.set(AnthropicLMProvider.providerId, anthropic);
		this._providers.set(GeminiNativeBYOKLMProvider.providerId, gemini);
		this._providers.set(XAIBYOKLMProvider.providerId, xai);
		this._providers.set(OAIBYOKLMProvider.providerId, openai);
		this._providers.set(OpenRouterLMProvider.providerId, instantiationService.createInstance(OpenRouterLMProvider, this._byokStorageService));
		this._providers.set(TokenRouterLMProvider.providerId, instantiationService.createInstance(TokenRouterLMProvider, this._byokStorageService));
		this._providers.set(AzureBYOKModelProvider.providerId, instantiationService.createInstance(AzureBYOKModelProvider, this._byokStorageService));
		this._providers.set(CustomOAIBYOKModelProvider.providerId, instantiationService.createInstance(CustomOAIBYOKModelProvider, this._byokStorageService));
		this._providers.set(CustomEndpointBYOKModelProvider.providerId, instantiationService.createInstance(CustomEndpointBYOKModelProvider, this._byokStorageService));

		this._knownModelsRefreshTargets = [
			// DISABLED: Anthropic/Claude disabled
			// [AnthropicLMProvider.providerName, anthropic],
			[GeminiNativeBYOKLMProvider.providerName, gemini],
			[XAIBYOKLMProvider.providerName, xai],
			[OAIBYOKLMProvider.providerName, openai],
		];
	}

	/**
	 * Register TokenRouter once and keep it for the lifetime of the contribution.
	 * Clearing other BYOK vendors on auth change must never unregister TokenRouter —
	 * that races `$unregisterProvider` vs `$registerLanguageModelProvider` on the main thread
	 * and leaves Auto with zero gateway models.
	 */
	private _ensureTokenRouterRegistered(): void {
		if (this._tokenRouterRegistration) {
			return;
		}
		if (this._providers.size === 0) {
			this._buildProviders();
		}
		const tokenrouter = this._providers.get(TokenRouterLMProvider.providerId);
		if (!tokenrouter) {
			this._logService.error('BYOK: TokenRouter provider missing after build.');
			return;
		}
		try {
			this._tokenRouterRegistration = lm.registerLanguageModelChatProvider(
				TokenRouterLMProvider.providerId,
				tokenrouter,
			);
			this._logService.info('BYOK: TokenRouter provider registered.');
			// Eager seed (constructor also kicks this off); keep the call here for
			// late re-registration paths after dispose.
			void this._seedBundledGatewayKeys();
		} catch (err) {
			this._tokenRouterRegistration = undefined;
			this._logService.error(
				err instanceof Error ? err : new Error(String(err)),
				'BYOK: failed to register TokenRouter provider',
			);
		}
	}

	private _applyPolicy(): void {
		this._ensureTokenRouterRegistered();

		const allowed = isClientBYOKAllowed(!!this._authService.anyGitHubSession, this._authService.singularityToken);
		if (allowed && !this._providersRegistered) {
			if (this._providers.size === 0) {
				this._buildProviders();
			}
			for (const [providerId, provider] of this._providers) {
				if (providerId === TokenRouterLMProvider.providerId) {
					continue; // already held in _tokenRouterRegistration
				}
				this._otherProviderRegistrations.add(lm.registerLanguageModelChatProvider(providerId, provider));
			}
			this._providersRegistered = true;
			this._logService.info(`BYOK: registered ${this._providers.size} provider(s): ${Array.from(this._providers.keys()).join(', ')}`);
			if (!this._knownModelsRefreshed) {
				this._knownModelsRefreshed = true;
				void this._refreshKnownModels().catch(err => {
					this._knownModelsRefreshed = false;
					this._logService.warn(`BYOK: failed to refresh known models, will retry on next allowed transition: ${err instanceof Error ? err.message : String(err)}`);
				});
			}
		} else if (!allowed && this._providersRegistered) {
			// Drop other BYOK vendors only — TokenRouter stays registered.
			this._otherProviderRegistrations.clear();
			this._providersRegistered = false;
			this._logService.info('BYOK: enterprise policy blocked most providers; TokenRouter kept enabled.');
			void this._seedBundledGatewayKeys();
		} else if (!allowed && !this._providersRegistered) {
			this._logService.info('BYOK: TokenRouter available without Singularity entitlement.');
		}
	}

	private async _seedBundledGatewayKeys(apiKeyOverride?: string): Promise<void> {
		if (this._seedInFlight && !apiKeyOverride) {
			return this._seedInFlight;
		}
		this._seedInFlight = this._seedBundledGatewayKeysImpl(apiKeyOverride).finally(() => {
			this._seedInFlight = undefined;
		});
		return this._seedInFlight;
	}

	private async _seedBundledGatewayKeysImpl(apiKeyOverride?: string): Promise<void> {
		applySingularityBundledEnv();
		const apiKey = apiKeyOverride ?? await ensureFreshTokenRouterApiKey();
		if (!apiKey) {
			return;
		}
		// Main-thread registration is async over RPC — retry until the provider is visible.
		for (let attempt = 0; attempt < 12; attempt++) {
			try {
				await commands.executeCommand('lm.migrateLanguageModelsProviderGroup', {
					vendor: TokenRouterLMProvider.providerId,
					name: TokenRouterLMProvider.providerName,
					apiKey,
				});
				this._logService.info('BYOK: seeded bundled TokenRouter gateway key.');
				return;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const retryable = /not registered|not found/i.test(message);
				if (!retryable || attempt === 11) {
					this._logService.warn(`BYOK: failed to seed bundled gateway keys: ${message}`);
					return;
				}
				// Short backoff — first chat after launch races this seed.
				await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
			}
		}
	}

	private async _refreshKnownModels(): Promise<void> {
		const knownModels = await this._fetchKnownModelList(this._fetcherService);
		if (this._store.isDisposed) {
			return;
		}
		for (const [providerName, provider] of this._knownModelsRefreshTargets) {
			provider.updateKnownModels(knownModels[providerName]);
		}
	}

	private async _fetchKnownModelList(_fetcherService: IFetcherService): Promise<Record<string, BYOKKnownModels>> {
		this._logService.info('BYOK: skipping vscode-cdn Singularity model catalog; TokenRouter owns model lists.');
		return {};
	}
}
