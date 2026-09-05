/**
 * Provision per-user OpenRouter API keys via the Management API.
 * Keys are named after the user's GitHub username for visibility in the OpenRouter dashboard.
 * No `limit` is set — usage is gated by Singularity subscription billing, not OpenRouter credits.
 */

export interface OpenRouterUserIdentity {
	githubUsername?: string;
	githubId?: string;
	displayName?: string;
	avatarUrl?: string;
	authProvider: string;
}

export interface ProvisionedKey {
	key: string;
	keyName: string;
	keyHash?: string;
}

export function identityFromSupabaseUser(user: {
	id: string;
	email?: string;
	app_metadata?: Record<string, unknown>;
	user_metadata?: Record<string, unknown>;
	identities?: Array<{ provider?: string; identity_data?: Record<string, unknown> }>;
}): OpenRouterUserIdentity {
	const meta = user.user_metadata ?? {};
	const app = user.app_metadata ?? {};
	let githubUsername =
		(typeof meta.preferred_username === 'string' && meta.preferred_username)
		|| (typeof meta.user_name === 'string' && meta.user_name)
		|| (typeof meta.username === 'string' && meta.username)
		|| undefined;
	let githubId =
		(typeof meta.sub === 'string' && meta.sub)
		|| (typeof meta.provider_id === 'string' && meta.provider_id)
		|| undefined;
	let authProvider =
		(typeof app.provider === 'string' && app.provider)
		|| 'email';

	for (const id of user.identities ?? []) {
		if (id.provider === 'github') {
			authProvider = 'github';
			const data = id.identity_data ?? {};
			githubUsername =
				(typeof data.user_name === 'string' && data.user_name)
				|| (typeof data.preferred_username === 'string' && data.preferred_username)
				|| githubUsername;
			githubId =
				(typeof data.sub === 'string' && data.sub)
				|| (typeof data.id === 'string' && String(data.id))
				|| githubId;
		}
	}

	return {
		githubUsername,
		githubId,
		displayName:
			(typeof meta.full_name === 'string' && meta.full_name)
			|| (typeof meta.name === 'string' && meta.name)
			|| undefined,
		avatarUrl: typeof meta.avatar_url === 'string' ? meta.avatar_url : undefined,
		authProvider,
	};
}

export function openRouterKeyName(identity: OpenRouterUserIdentity, email: string): string {
	if (identity.githubUsername) {
		return `github:${identity.githubUsername}`;
	}
	const local = email.split('@')[0]?.replace(/[^a-zA-Z0-9._-]/g, '-') || 'user';
	return `singularity:${local}`;
}

/** Create a new OpenRouter API key with no spending limit (unlimited via OpenRouter). */
export async function provisionOpenRouterKey(keyName: string): Promise<ProvisionedKey> {
	const managementKey = Deno.env.get('OPENROUTER_MANAGEMENT_API_KEY');
	if (!managementKey) {
		throw new Error('OPENROUTER_MANAGEMENT_API_KEY not configured');
	}

	const base = (Deno.env.get('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
	const res = await fetch(`${base}/keys`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${managementKey}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			name: keyName,
			// No limit — billing is enforced by Singularity subscription, not OpenRouter credits.
			limit: null,
		}),
	});

	const text = await res.text();
	if (!res.ok) {
		throw new Error(`OpenRouter key provision failed ${res.status}: ${text.slice(0, 500)}`);
	}

	let json: Record<string, unknown>;
	try {
		json = JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new Error('OpenRouter key provision returned invalid JSON');
	}

	const key =
		(typeof json.key === 'string' && json.key)
		|| (typeof (json.data as Record<string, unknown> | undefined)?.key === 'string'
			&& (json.data as Record<string, unknown>).key as string)
		|| '';

	if (!key.startsWith('sk-or-')) {
		throw new Error('OpenRouter key provision did not return a key');
	}

	const data = (json.data ?? json) as Record<string, unknown>;
	const keyHash = typeof data.hash === 'string' ? data.hash : undefined;

	return { key, keyName, keyHash };
}
