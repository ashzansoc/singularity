/**
 * Built-in Singularity credentials for packaged installs.
 * All models route through OpenRouter (https://openrouter.ai/api/v1).
 * Beta users without their own key fall back to the Supabase LLM proxy.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export const SINGULARITY_BUNDLED_ENV: Readonly<Record<string, string>> = {
	TOKENROUTER_BASE_URL: OPENROUTER_DEFAULT_BASE_URL,
	AI_GATEWAY_BASE_URL: OPENROUTER_DEFAULT_BASE_URL,
	TOKENROUTER_API_KEY: '',
	AI_GATEWAY_API_KEY: '',
	OPENROUTER_API_KEY: '',
	OPENROUTER_BASE_URL: OPENROUTER_DEFAULT_BASE_URL,
	SINGULARITY_DECISION_API_KEY: '',
	SINGULARITY_DECISION_BASE_URL: OPENROUTER_DEFAULT_BASE_URL,
	SINGULARITY_DECISION_MODEL: 'deepseek/deepseek-v4-flash-0731',
	SINGULARITY_DECISION_TIMEOUT_MS: '5000',
	SINGULARITY_SUPABASE_URL: 'https://nuwsczuwyezpodtnouqf.supabase.co',
	SINGULARITY_SUPABASE_ANON_KEY:
		'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51d3NjenV3eWV6cG9kdG5vdXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTExMTYsImV4cCI6MjEwMTk2NzExNn0.xqrEqaV9pfQchO7MDs6E-59wGDDIIqDLs5qVfsGwkQs',
	SINGULARITY_LLM_PROXY_URL: 'https://nuwsczuwyezpodtnouqf.supabase.co/functions/v1/llm-proxy/v1',
};

interface SingularityBetaAuth {
	email?: string;
	userId?: string;
	accessToken?: string;
	refreshToken?: string;
	expiresAt?: number;
	deviceId?: string;
	openrouterApiKey?: string;
	openrouterBaseUrl?: string;
	openrouterKeyName?: string;
	subscriptionStartedAt?: string;
	githubUsername?: string;
}

const AUTH_DIR = join(homedir(), '.singularity');
const AUTH_FILE = join(AUTH_DIR, 'beta-auth.json');
/** Temporary DeepSeek official-API override (not committed). */
const DEEPSEEK_FILE = join(AUTH_DIR, 'deepseek.json');
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
/** Refresh this far before JWT expiry — Supabase access tokens last ~1h. */
const REFRESH_SKEW_MS = 5 * 60_000;

let applied = false;
let cachedBetaAccessToken: string | undefined;
let refreshInFlight: Promise<string | undefined> | undefined;
let betaTokenRefreshListener: ((token: string) => void) | undefined;

function readBetaAuthFile(): SingularityBetaAuth | undefined {
	try {
		if (!existsSync(AUTH_FILE)) {
			return undefined;
		}
		return JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as SingularityBetaAuth;
	} catch {
		return undefined;
	}
}

function writeBetaAuthFile(auth: SingularityBetaAuth): void {
	mkdirSync(AUTH_DIR, { recursive: true });
	writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

function jwtExpiresAtMs(token: string): number | undefined {
	try {
		const parts = token.split('.');
		if (parts.length < 2) {
			return undefined;
		}
		const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { exp?: number };
		return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;
	} catch {
		return undefined;
	}
}

/** Effective expiry — always trust JWT `exp` over a stale/wrong expiresAt field. */
function effectiveExpiryMs(auth: SingularityBetaAuth): number | undefined {
	if (!auth.accessToken) {
		return undefined;
	}
	const jwtExp = jwtExpiresAtMs(auth.accessToken);
	if (jwtExp !== undefined && auth.expiresAt !== undefined) {
		return Math.min(jwtExp, auth.expiresAt);
	}
	return jwtExp ?? auth.expiresAt;
}

function isTokenExpiredOrNearExpiry(token: string | undefined, skewMs = REFRESH_SKEW_MS): boolean {
	if (!token) {
		return true;
	}
	if (!token.startsWith('eyJ')) {
		return false; // static API keys are not JWTs
	}
	const exp = jwtExpiresAtMs(token);
	return !exp || exp <= Date.now() + skewMs;
}

function isBetaTokenStale(auth: SingularityBetaAuth | undefined): boolean {
	if (!auth?.accessToken) {
		return true;
	}
	const expiresAt = effectiveExpiryMs(auth);
	return !expiresAt || expiresAt <= Date.now() + REFRESH_SKEW_MS;
}

function getProvisionedOpenRouterKey(): string | undefined {
	return readBetaAuthFile()?.openrouterApiKey?.trim() || undefined;
}

function getStaticEnvApiKey(): string | undefined {
	return (
		process.env.OPENROUTER_API_KEY?.trim()
		|| process.env.TOKENROUTER_API_KEY?.trim()
		|| process.env.AI_GATEWAY_API_KEY?.trim()
		|| process.env.VERCEL_AI_GATEWAY_API_KEY?.trim()
		|| undefined
	);
}

export function isOpenRouterApiKey(key: string | undefined): boolean {
	return !!key?.startsWith('sk-or-');
}

export function applySingularityBundledEnv(): void {
	if (applied) {
		return;
	}
	applied = true;
	for (const [key, value] of Object.entries(SINGULARITY_BUNDLED_ENV)) {
		if (value && process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

/** Notify when the beta JWT is rotated (e.g. re-seed LM provider config). */
export function setBetaTokenRefreshListener(listener: ((token: string) => void) | undefined): void {
	betaTokenRefreshListener = listener;
}

/**
 * Refresh the Supabase beta session when near expiry.
 * Returns the current access token (refreshed when possible).
 */
export async function refreshBetaSessionIfNeeded(force = false): Promise<string | undefined> {
	if (refreshInFlight) {
		return refreshInFlight;
	}

	refreshInFlight = (async () => {
		try {
			applySingularityBundledEnv();
			const staticKey = getStaticEnvApiKey();
			if (staticKey) {
				cachedBetaAccessToken = staticKey;
				return staticKey;
			}
			const provisioned = getProvisionedOpenRouterKey();
			if (provisioned) {
				cachedBetaAccessToken = provisioned;
				return provisioned;
			}
			const auth = readBetaAuthFile();
			if (!auth?.accessToken) {
				cachedBetaAccessToken = undefined;
				return getStaticEnvApiKey();
			}

			if (!force && !isBetaTokenStale(auth)) {
				cachedBetaAccessToken = auth.accessToken;
				return auth.accessToken;
			}

			if (!auth.refreshToken) {
				// Cannot refresh — only return if still usable
				if (isTokenExpiredOrNearExpiry(auth.accessToken, 0)) {
					cachedBetaAccessToken = undefined;
					return getStaticEnvApiKey();
				}
				cachedBetaAccessToken = auth.accessToken;
				return auth.accessToken;
			}

			const res = await fetch(`${SINGULARITY_BUNDLED_ENV.SINGULARITY_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
				method: 'POST',
				headers: {
					apikey: getSupabaseAnonKey(),
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ refresh_token: auth.refreshToken }),
			});

			if (!res.ok) {
				console.warn(`[beta-auth] refresh_token failed HTTP ${res.status}`);
				if (isTokenExpiredOrNearExpiry(auth.accessToken, 0)) {
					cachedBetaAccessToken = undefined;
					return getStaticEnvApiKey();
				}
				cachedBetaAccessToken = auth.accessToken;
				return auth.accessToken;
			}

			const data = (await res.json()) as {
				access_token?: string;
				refresh_token?: string;
				expires_in?: number;
				user?: { id?: string; email?: string };
			};

			if (!data.access_token) {
				if (isTokenExpiredOrNearExpiry(auth.accessToken, 0)) {
					cachedBetaAccessToken = undefined;
					return getStaticEnvApiKey();
				}
				cachedBetaAccessToken = auth.accessToken;
				return auth.accessToken;
			}

			const jwtExp = jwtExpiresAtMs(data.access_token);
			const next: SingularityBetaAuth = {
				...auth,
				accessToken: data.access_token,
				refreshToken: data.refresh_token ?? auth.refreshToken,
				expiresAt: jwtExp ?? (Date.now() + (data.expires_in ?? 3600) * 1000),
				userId: data.user?.id ?? auth.userId,
				email: (data.user?.email ?? auth.email)?.toLowerCase(),
			};
			writeBetaAuthFile(next);
			cachedBetaAccessToken = next.accessToken;

			if (next.accessToken !== auth.accessToken) {
				betaTokenRefreshListener?.(next.accessToken);
			}

			return next.accessToken;
		} finally {
			refreshInFlight = undefined;
		}
	})();

	return refreshInFlight;
}

/** Await a fresh beta JWT (or static env key) before LLM requests. */
export async function ensureFreshTokenRouterApiKey(): Promise<string | undefined> {
	applySingularityBundledEnv();
	const staticKey = getStaticEnvApiKey();
	if (staticKey) {
		cachedBetaAccessToken = staticKey;
		return staticKey;
	}
	const provisioned = getProvisionedOpenRouterKey();
	if (provisioned) {
		cachedBetaAccessToken = provisioned;
		return provisioned;
	}
	const auth = readBetaAuthFile();
	if (auth?.accessToken) {
		// Always refresh when near JWT exp — do not trust a warm in-memory cache alone.
		if (forceNeeded(auth) || isTokenExpiredOrNearExpiry(cachedBetaAccessToken)) {
			return refreshBetaSessionIfNeeded(isTokenExpiredOrNearExpiry(auth.accessToken, 0));
		}
		return refreshBetaSessionIfNeeded();
	}
	const envKey = getStaticEnvApiKey();
	if (envKey) {
		cachedBetaAccessToken = envKey;
	}
	return envKey;
}

function forceNeeded(auth: SingularityBetaAuth): boolean {
	return isBetaTokenStale(auth) || isTokenExpiredOrNearExpiry(cachedBetaAccessToken);
}

/**
 * Sync read of the best available TokenRouter / beta key.
 * Never returns an expired JWT from memory — falls through to disk.
 */
export function getTokenRouterApiKey(): string | undefined {
	applySingularityBundledEnv();
	const staticKey = getStaticEnvApiKey();
	if (staticKey) {
		cachedBetaAccessToken = staticKey;
		return staticKey;
	}
	const provisioned = getProvisionedOpenRouterKey();
	if (provisioned) {
		cachedBetaAccessToken = provisioned;
		return provisioned;
	}

	if (cachedBetaAccessToken && !isTokenExpiredOrNearExpiry(cachedBetaAccessToken, 0)) {
		if (isTokenExpiredOrNearExpiry(cachedBetaAccessToken)) {
			void refreshBetaSessionIfNeeded();
		}
		return cachedBetaAccessToken;
	}

	const auth = readBetaAuthFile();
	if (auth?.accessToken) {
		if (isTokenExpiredOrNearExpiry(auth.accessToken, 0)) {
			void refreshBetaSessionIfNeeded(true);
			return cachedBetaAccessToken && !isTokenExpiredOrNearExpiry(cachedBetaAccessToken, 0)
				? cachedBetaAccessToken
				: undefined;
		}
		cachedBetaAccessToken = auth.accessToken;
		if (isBetaTokenStale(auth)) {
			void refreshBetaSessionIfNeeded();
		}
		return auth.accessToken;
	}

	cachedBetaAccessToken = undefined;
	return getStaticEnvApiKey();
}

/** True when TokenRouter traffic must go through the Supabase beta proxy (JWT only). */
export function isUsingBetaProxy(bearerToken?: string): boolean {
	if (process.env.OPENROUTER_API_KEY?.trim()) {
		return false;
	}
	if (getProvisionedOpenRouterKey()) {
		return false;
	}
	const token = bearerToken ?? getTokenRouterApiKey();
	if (!token?.startsWith('eyJ')) {
		return false;
	}
	return true;
}

export function getTokenRouterBaseUrl(bearerToken?: string): string {
	applySingularityBundledEnv();
	const token = bearerToken ?? getTokenRouterApiKey();
	if (isOpenRouterApiKey(token) || process.env.OPENROUTER_API_KEY?.trim() || getProvisionedOpenRouterKey()) {
		return getOpenRouterBaseUrl();
	}
	if (isUsingBetaProxy(token)) {
		return (
			process.env.SINGULARITY_LLM_PROXY_URL?.replace(/\/$/, '')
			|| SINGULARITY_BUNDLED_ENV.SINGULARITY_LLM_PROXY_URL
		);
	}
	// Static API keys (sk-…) — prefer env override, else OpenRouter default
	if (token && !token.startsWith('eyJ')) {
		const fromEnv = process.env.TOKENROUTER_BASE_URL?.replace(/\/$/, '')
			|| process.env.AI_GATEWAY_BASE_URL?.replace(/\/$/, '')
			|| process.env.OPENROUTER_BASE_URL?.replace(/\/$/, '');
		if (fromEnv && !/llm-proxy|supabase\.co/i.test(fromEnv)) {
			return fromEnv;
		}
		return OPENROUTER_DEFAULT_BASE_URL;
	}
	return (
		process.env.OPENROUTER_BASE_URL?.replace(/\/$/, '')
		|| process.env.TOKENROUTER_BASE_URL?.replace(/\/$/, '')
		|| process.env.AI_GATEWAY_BASE_URL?.replace(/\/$/, '')
		|| OPENROUTER_DEFAULT_BASE_URL
	);
}

/** Authorization + proxy headers for TokenRouter / llm-proxy chat requests. */
export function getTokenRouterRequestHeaders(bearerToken: string): Record<string, string> {
	// Prefer a non-expired session token over whatever was baked into the endpoint.
	let token = bearerToken;
	if (isUsingBetaProxy(bearerToken)) {
		const fresh = getTokenRouterApiKey();
		if (fresh) {
			token = fresh;
		}
	}
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
	};
	if (isOpenRouterApiKey(token) || process.env.OPENROUTER_API_KEY?.trim()) {
		headers['HTTP-Referer'] = process.env.SINGULARITY_SITE_URL?.trim() || 'https://singularity.dev';
		headers['X-Title'] = process.env.SINGULARITY_APP_NAME?.trim() || 'Singularity';
	}
	if (isUsingBetaProxy(token)) {
		headers.apikey = getSupabaseAnonKey();
		const deviceId = getBetaDeviceId();
		if (deviceId) {
			headers['X-Singularity-Device-Id'] = deviceId;
		}
	}
	return headers;
}

export function getOpenRouterApiKey(): string | undefined {
	applySingularityBundledEnv();
	return (
		process.env.SINGULARITY_DECISION_API_KEY?.trim()
		|| process.env.OPENROUTER_API_KEY?.trim()
	);
}

export function getBetaDeviceId(): string | undefined {
	return readBetaAuthFile()?.deviceId;
}

export const DEEPSEEK_FLASH_MODEL_ID = 'deepseek/deepseek-v4-flash-0731';
/** Agent-host / SDK BYOK wire id (TokenRouter vendor + OpenRouter catalog id). */
export const PINNED_BYOK_FLASH_MODEL_ID = `tokenrouter/${DEEPSEEK_FLASH_MODEL_ID}`;
/** Pro tier — DeepSeek V4 Pro 0813 via TokenRouter. */
export const DEEPSEEK_PRO_MODEL_ID = 'deepseek/deepseek-v4-pro-0813';

/** Official TokenRouter API — not the Singularity beta Supabase proxy. */
export const OFFICIAL_TOKENROUTER_BASE_URL = 'https://api.tokenrouter.com/v1';

/** Flash + Pro use OpenRouter when OPENROUTER_API_KEY is set; else optional DeepSeek direct. */
export function useDeepSeekDirectRouting(): boolean {
	applySingularityBundledEnv();
	if (process.env.OPENROUTER_API_KEY?.trim() || getProvisionedOpenRouterKey()) {
		return false;
	}
	if (process.env.SINGULARITY_DEEPSEEK_DIRECT === '0') {
		return false;
	}
	if (process.env.SINGULARITY_DEEPSEEK_DIRECT === '1') {
		return hasDeepSeekDirectCredentials();
	}
	if (getStaticEnvApiKey()) {
		return false;
	}
	return hasDeepSeekDirectCredentials();
}

function hasDeepSeekDirectCredentials(): boolean {
	const file = readDeepSeekDirectFile();
	return !!(process.env.DEEPSEEK_API_KEY?.trim() || file?.apiKey?.trim());
}

/** User-supplied or provisioned OpenRouter keys override the free beta proxy. */
export function prefersOwnLlmCredentialsOverBeta(): boolean {
	return !!process.env.OPENROUTER_API_KEY?.trim()
		|| !!getProvisionedOpenRouterKey()
		|| !!getStaticEnvApiKey()
		|| hasDeepSeekDirectCredentials();
}

/** DeepSeek Flash + Pro can route to api.deepseek.com when direct credentials exist. */
export function isDeepSeekDirectRoutingModel(modelId: string): boolean {
	return isDeepSeekCatalogModel(modelId);
}

export function getOpenRouterBaseUrl(): string {
	applySingularityBundledEnv();
	const fromAuth = readBetaAuthFile()?.openrouterBaseUrl?.replace(/\/$/, '');
	return (
		fromAuth
		|| process.env.OPENROUTER_BASE_URL?.replace(/\/$/, '')
		|| SINGULARITY_BUNDLED_ENV.OPENROUTER_BASE_URL
	);
}

/** Models routed to OpenRouter chat/completions (:free non-DeepSeek only). */
export function isOpenRouterCatalogModel(modelId: string): boolean {
	const id = modelId.trim().toLowerCase();
	return /:free$/.test(id) && !isDeepSeekCatalogModel(id);
}

export function isDeepSeekCatalogModel(modelId: string): boolean {
	return /(^|\/)deepseek-/i.test(modelId.trim());
}

/** Flash only — routed to official api.deepseek.com when DEEPSEEK_API_KEY is set. */
export function isDeepSeekFlashCatalogModel(modelId: string): boolean {
	return /deepseek-v4-flash/i.test(modelId.trim());
}

/** Map TokenRouter / catalog ids onto official DeepSeek Chat Completions model names. */
export function mapDeepSeekOfficialModelId(catalogId: string): string {
	const id = catalogId.trim().toLowerCase();
	if (id.includes('pro')) {
		return 'deepseek-v4-pro';
	}
	return 'deepseek-v4-flash';
}

interface DeepSeekDirectAuth {
	apiKey?: string;
	baseUrl?: string;
}

function readDeepSeekDirectFile(): DeepSeekDirectAuth | undefined {
	try {
		if (!existsSync(DEEPSEEK_FILE)) {
			return undefined;
		}
		return JSON.parse(readFileSync(DEEPSEEK_FILE, 'utf8')) as DeepSeekDirectAuth;
	} catch {
		return undefined;
	}
}

/**
 * Temporary DeepSeek official API (bypasses TokenRouter RPM).
 * Reads DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL, then ~/.singularity/deepseek.json.
 */
export function getDeepSeekDirectConfig(): { apiKey: string; baseUrl: string } | undefined {
	if (!useDeepSeekDirectRouting()) {
		return undefined;
	}
	applySingularityBundledEnv();
	const file = readDeepSeekDirectFile();
	const apiKey = (
		process.env.DEEPSEEK_API_KEY?.trim()
		|| file?.apiKey?.trim()
		|| ''
	);
	if (!apiKey) {
		return undefined;
	}
	const baseUrl = (
		process.env.DEEPSEEK_BASE_URL?.replace(/\/$/, '')
		|| file?.baseUrl?.replace(/\/$/, '')
		|| DEFAULT_DEEPSEEK_BASE_URL
	);
	return { apiKey, baseUrl };
}

export function isDeepSeekDirectBaseUrl(base: string): boolean {
	return /api\.deepseek\.com/i.test(base);
}

/** Bearer for OpenRouter / DeepSeek official API; beta proxy headers otherwise. */
export function getChatCompletionsAuthHeaders(apiKey: string, baseUrl?: string): Record<string, string> {
	if (baseUrl && isDeepSeekDirectBaseUrl(baseUrl)) {
		return {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		};
	}
	const headers = getTokenRouterRequestHeaders(apiKey);
	if (baseUrl && /openrouter\.ai/i.test(baseUrl)) {
		headers['HTTP-Referer'] = process.env.SINGULARITY_SITE_URL?.trim() || 'https://singularity.dev';
		headers['X-Title'] = process.env.SINGULARITY_APP_NAME?.trim() || 'Singularity';
	}
	return headers;
}

export function getSupabaseAnonKey(): string {
	applySingularityBundledEnv();
	return process.env.SINGULARITY_SUPABASE_ANON_KEY?.trim() || SINGULARITY_BUNDLED_ENV.SINGULARITY_SUPABASE_ANON_KEY;
}

/** Proactive refresh so beta JWTs stay valid between chat turns. Skipped when using own API keys. */
export function startBetaAuthRefreshLoop(): { dispose: () => void } {
	if (prefersOwnLlmCredentialsOverBeta()) {
		return { dispose: () => undefined };
	}
	void refreshBetaSessionIfNeeded();
	// 30s so we catch the 5-minute skew window reliably.
	const handle = setInterval(() => void refreshBetaSessionIfNeeded(), 30_000);
	return { dispose: () => clearInterval(handle) };
}
