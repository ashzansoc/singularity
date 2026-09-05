/**
 * Shared Singularity beta auth helpers (Node).
 * Session file lives at ~/.singularity/beta-auth.json so workbench + extensions share one identity.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isAllowedSingularityEmail } from './allowedEmail.js';

export const SINGULARITY_SUPABASE_URL = 'https://nuwsczuwyezpodtnouqf.supabase.co';
export const SINGULARITY_SUPABASE_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51d3NjenV3eWV6cG9kdG5vdXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTExMTYsImV4cCI6MjEwMTk2NzExNn0.xqrEqaV9pfQchO7MDs6E-59wGDDIIqDLs5qVfsGwkQs';
export const SINGULARITY_LLM_PROXY_URL =
	'https://nuwsczuwyezpodtnouqf.supabase.co/functions/v1/llm-proxy/v1';

export { isAllowedSingularityEmail, SINGULARITY_ALLOWED_EMAIL_DOMAIN } from './allowedEmail.js';

export interface SingularityBetaAuth {
	email: string;
	userId?: string;
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	deviceId: string;
	/** Per-user OpenRouter key provisioned at login (never shown in UI). */
	openrouterApiKey?: string;
	openrouterBaseUrl?: string;
	openrouterKeyName?: string;
	subscriptionStartedAt?: string;
	githubUsername?: string;
}

const AUTH_DIR = join(homedir(), '.singularity');
const AUTH_FILE = join(AUTH_DIR, 'beta-auth.json');

export function getBetaAuthPath(): string {
	return AUTH_FILE;
}

export function readBetaAuth(): SingularityBetaAuth | undefined {
	try {
		if (!existsSync(AUTH_FILE)) {
			return undefined;
		}
		const raw = JSON.parse(readFileSync(AUTH_FILE, 'utf8')) as SingularityBetaAuth;
		if (!raw?.accessToken || !raw?.email || !raw?.deviceId) {
			return undefined;
		}
		if (!isAllowedSingularityEmail(raw.email)) {
			return undefined;
		}
		return raw;
	} catch {
		return undefined;
	}
}

export function writeBetaAuth(auth: SingularityBetaAuth): void {
	mkdirSync(AUTH_DIR, { recursive: true });
	writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

export function clearBetaAuth(): void {
	try {
		if (existsSync(AUTH_FILE)) {
			writeFileSync(AUTH_FILE, '{}', { mode: 0o600 });
		}
	} catch {
		/* ignore */
	}
}

export function ensureDeviceId(existing?: string): string {
	if (existing?.trim()) {
		return existing.trim();
	}
	const current = readBetaAuth()?.deviceId;
	if (current) {
		return current;
	}
	return randomUUID();
}

export async function refreshBetaSessionIfNeeded(): Promise<SingularityBetaAuth | undefined> {
	const auth = readBetaAuth();
	if (!auth) {
		return undefined;
	}
	// Trust JWT exp over expiresAt — mismatched fields caused hour-long 401s.
	let jwtExp: number | undefined;
	try {
		const parts = auth.accessToken.split('.');
		if (parts.length >= 2) {
			const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { exp?: number };
			if (typeof payload.exp === 'number') {
				jwtExp = payload.exp * 1000;
			}
		}
	} catch {
		/* ignore */
	}
	const expiresAt =
		jwtExp !== undefined && auth.expiresAt !== undefined
			? Math.min(jwtExp, auth.expiresAt)
			: (jwtExp ?? auth.expiresAt ?? 0);
	// Refresh 5 minutes before expiry
	if (expiresAt > Date.now() + 5 * 60_000) {
		return auth;
	}
	if (!auth.refreshToken) {
		return auth;
	}
	const res = await fetch(`${SINGULARITY_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
		method: 'POST',
		headers: {
			apikey: SINGULARITY_SUPABASE_ANON_KEY,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ refresh_token: auth.refreshToken }),
	});
	if (!res.ok) {
		return auth;
	}
	const data = (await res.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		user?: { id?: string; email?: string };
	};
	if (!data.access_token) {
		return auth;
	}
	let nextJwtExp: number | undefined;
	try {
		const parts = data.access_token.split('.');
		if (parts.length >= 2) {
			const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { exp?: number };
			if (typeof payload.exp === 'number') {
				nextJwtExp = payload.exp * 1000;
			}
		}
	} catch {
		/* ignore */
	}
	const next: SingularityBetaAuth = {
		...auth,
		accessToken: data.access_token,
		refreshToken: data.refresh_token ?? auth.refreshToken,
		expiresAt: nextJwtExp ?? Date.now() + (data.expires_in ?? 3600) * 1000,
		userId: data.user?.id ?? auth.userId,
		email: (data.user?.email ?? auth.email).toLowerCase(),
	};
	writeBetaAuth(next);
	return next;
}

/** Headers for the Singularity LLM proxy (Authorization = user JWT). */
export async function getBetaProxyAuthHeaders(): Promise<Record<string, string> | undefined> {
	const auth = (await refreshBetaSessionIfNeeded()) ?? readBetaAuth();
	if (!auth?.accessToken) {
		return undefined;
	}
	return {
		Authorization: `Bearer ${auth.accessToken}`,
		apikey: SINGULARITY_SUPABASE_ANON_KEY,
		'X-Singularity-Device-Id': auth.deviceId,
	};
}

export async function fetchBetaQuota(): Promise<{
	emailRemaining: number;
	deviceRemaining: number;
	emailUsed: number;
	deviceUsed: number;
	emailLimit: number;
	deviceLimit: number;
} | undefined> {
	const headers = await getBetaProxyAuthHeaders();
	if (!headers) {
		return undefined;
	}
	const res = await fetch(`${SINGULARITY_LLM_PROXY_URL}/quota`, { headers });
	if (!res.ok) {
		return undefined;
	}
	return (await res.json()) as {
		emailRemaining: number;
		deviceRemaining: number;
		emailUsed: number;
		deviceUsed: number;
		emailLimit: number;
		deviceLimit: number;
	};
}
