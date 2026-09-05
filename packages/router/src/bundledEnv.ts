/**
 * Built-in Singularity credentials for packaged installs.
 * All models route through OpenRouter (https://openrouter.ai/api/v1).
 * Beta users without their own key fall back to the Supabase LLM proxy.
 */
import { readBetaAuth, refreshBetaSessionIfNeeded } from './betaAuth.js';

export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export const SINGULARITY_BUNDLED_ENV: Readonly<Record<string, string>> = {
  TOKENROUTER_BASE_URL: OPENROUTER_DEFAULT_BASE_URL,
  AI_GATEWAY_BASE_URL: OPENROUTER_DEFAULT_BASE_URL,
  TOKENROUTER_API_KEY: '',
  AI_GATEWAY_API_KEY: '',
  OPENROUTER_API_KEY: '',
  OPENROUTER_BASE_URL: OPENROUTER_DEFAULT_BASE_URL,
  SINGULARITY_DECISION_API_KEY: '',
  SINGULARITY_DECISION_BASE_URL: 'https://openrouter.ai/api/v1',
  SINGULARITY_DECISION_MODEL: 'deepseek/deepseek-v4-flash-0731',
  SINGULARITY_DECISION_TIMEOUT_MS: '5000',
  SINGULARITY_SUPABASE_URL: 'https://nuwsczuwyezpodtnouqf.supabase.co',
  SINGULARITY_SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51d3NjenV3eWV6cG9kdG5vdXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTExMTYsImV4cCI6MjEwMTk2NzExNn0.xqrEqaV9pfQchO7MDs6E-59wGDDIIqDLs5qVfsGwkQs',
  SINGULARITY_LLM_PROXY_URL: 'https://nuwsczuwyezpodtnouqf.supabase.co/functions/v1/llm-proxy/v1',
};

let applied = false;

/** Apply bundled keys into process.env when not already set. Idempotent. */
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

export function isOpenRouterApiKey(key: string | undefined): boolean {
  return !!key?.startsWith('sk-or-');
}

/** Best available gateway key — env override, then per-user provisioned key, then beta JWT. */
export function getGatewayApiKey(): string | undefined {
  applySingularityBundledEnv();
  const openRouter = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouter) {
    return openRouter;
  }
  const auth = readBetaAuth();
  const provisioned = auth?.openrouterApiKey?.trim();
  if (provisioned) {
    return provisioned;
  }
  const staticKey =
    process.env.TOKENROUTER_API_KEY?.trim()
    || process.env.AI_GATEWAY_API_KEY?.trim()
    || process.env.VERCEL_AI_GATEWAY_API_KEY?.trim();
  if (staticKey) {
    return staticKey;
  }
  if (auth?.accessToken) {
    void refreshBetaSessionIfNeeded();
    return auth.accessToken;
  }
  return undefined;
}

export function getTokenRouterApiKey(): string | undefined {
  return getGatewayApiKey();
}

/** Await a fresh beta JWT (or static env key) before LLM requests. */
export async function ensureFreshTokenRouterApiKey(): Promise<string | undefined> {
  applySingularityBundledEnv();
  const openRouter = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouter) {
    return openRouter;
  }
  const auth = readBetaAuth();
  const provisioned = auth?.openrouterApiKey?.trim();
  if (provisioned) {
    return provisioned;
  }
  const staticKey =
    process.env.TOKENROUTER_API_KEY?.trim()
    || process.env.AI_GATEWAY_API_KEY?.trim()
    || process.env.VERCEL_AI_GATEWAY_API_KEY?.trim();
  if (staticKey) {
    return staticKey;
  }
  if (auth?.accessToken) {
    const refreshed = await refreshBetaSessionIfNeeded();
    return refreshed?.accessToken ?? auth.accessToken;
  }
  return undefined;
}

export function isUsingBetaProxy(): boolean {
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    return false;
  }
  if (readBetaAuth()?.openrouterApiKey?.trim()) {
    return false;
  }
  return !!readBetaAuth()?.accessToken;
}

export function getOpenRouterBaseUrl(): string {
  applySingularityBundledEnv();
  const auth = readBetaAuth();
  return (
    auth?.openrouterBaseUrl?.replace(/\/$/, '')
    || process.env.OPENROUTER_BASE_URL?.replace(/\/$/, '')
    || process.env.SINGULARITY_DECISION_BASE_URL?.replace(/\/$/, '')
    || OPENROUTER_DEFAULT_BASE_URL
  );
}

export function getTokenRouterBaseUrl(): string {
  applySingularityBundledEnv();
  const key = getGatewayApiKey();
  if (isOpenRouterApiKey(key) || process.env.OPENROUTER_API_KEY?.trim()) {
    return getOpenRouterBaseUrl();
  }
  if (isUsingBetaProxy()) {
    return (
      process.env.SINGULARITY_LLM_PROXY_URL?.replace(/\/$/, '')
      || SINGULARITY_BUNDLED_ENV.SINGULARITY_LLM_PROXY_URL
    );
  }
  return (
    process.env.TOKENROUTER_BASE_URL?.replace(/\/$/, '')
    || process.env.AI_GATEWAY_BASE_URL?.replace(/\/$/, '')
    || process.env.OPENROUTER_BASE_URL?.replace(/\/$/, '')
    || OPENROUTER_DEFAULT_BASE_URL
  );
}

export function getTokenRouterRequestHeaders(bearerToken: string): Record<string, string> {
  const token = isUsingBetaProxy() ? (getTokenRouterApiKey() ?? bearerToken) : bearerToken;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  if (isOpenRouterApiKey(token) || process.env.OPENROUTER_API_KEY?.trim() || readBetaAuth()?.openrouterApiKey?.trim()) {
    headers['HTTP-Referer'] = process.env.SINGULARITY_SITE_URL?.trim() || 'https://singularity.dev';
    headers['X-Title'] = process.env.SINGULARITY_APP_NAME?.trim() || 'Singularity';
  }
  if (isUsingBetaProxy()) {
    headers.apikey = SINGULARITY_BUNDLED_ENV.SINGULARITY_SUPABASE_ANON_KEY;
    const deviceId = readBetaAuth()?.deviceId;
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
