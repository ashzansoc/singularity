import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
	identityFromSupabaseUser,
	openRouterKeyName,
	provisionOpenRouterKey,
} from './openrouter.ts';

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers':
		'authorization, x-client-info, apikey, content-type, x-singularity-device-id',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

/** Soft/display default only — enforcement is disabled (no 10M hard cap). */
const TOKEN_LIMIT = Number.MAX_SAFE_INTEGER;
const ENFORCE_TOKEN_QUOTA = false;
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...CORS, 'Content-Type': 'application/json' },
	});
}

function adminClient() {
	const url = Deno.env.get('SUPABASE_URL')!;
	const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
	return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authenticate(req: Request) {
	const auth = req.headers.get('Authorization') ?? '';
	if (!auth.startsWith('Bearer ')) {
		return { error: json(401, { error: 'missing_authorization' }) };
	}
	const jwt = auth.slice('Bearer '.length).trim();
	const url = Deno.env.get('SUPABASE_URL')!;
	const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SB_PUBLISHABLE_KEY')!;
	const userClient = createClient(url, anon, {
		global: { headers: { Authorization: `Bearer ${jwt}` } },
		auth: { persistSession: false, autoRefreshToken: false },
	});
	const { data, error } = await userClient.auth.getUser(jwt);
	if (error || !data.user) {
		return { error: json(401, { error: 'invalid_token', detail: error?.message }) };
	}
	const email = (data.user.email ?? '').toLowerCase();
	if (!email) {
		return { error: json(401, { error: 'missing_email' }) };
	}
	const allowedDomain = (Deno.env.get('SINGULARITY_ALLOWED_EMAIL_DOMAIN') ?? 'zansoc.com').toLowerCase();
	if (!email.endsWith(`@${allowedDomain}`) || email.length <= allowedDomain.length + 1) {
		return { error: json(403, { error: 'email_domain_not_allowed', domain: allowedDomain }) };
	}
	return { user: data.user, email, jwt };
}

function deviceIdFrom(req: Request): string | undefined {
	return req.headers.get('X-Singularity-Device-Id')?.trim() || undefined;
}

function usageCharge(usage: Record<string, unknown> | undefined) {
	if (!usage) {
		return { prompt: 0, completion: 0, cached: 0, total: 0 };
	}
	const prompt = Number(usage.prompt_tokens ?? 0) || 0;
	const completion = Number(usage.completion_tokens ?? 0) || 0;
	const details = (usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
	const cached =
		Number(details.cached_tokens ?? usage.cache_read_input_tokens ?? usage.cached_tokens ?? 0) || 0;
	return { prompt, completion, cached, total: prompt + completion };
}

async function ensureIdentity(email: string, userId: string, deviceId: string) {
	const sb = adminClient();
	const { error } = await sb.rpc('ensure_beta_identity', {
		p_email: email,
		p_user_id: userId,
		p_device_id: deviceId,
	});
	if (error) {
		throw new Error(`ensure_beta_identity: ${error.message}`);
	}
}

async function getQuota(email: string, deviceId: string) {
	const sb = adminClient();
	const { data, error } = await sb.rpc('get_beta_quota', {
		p_email: email,
		p_device_id: deviceId,
	});
	if (error) {
		throw new Error(`get_beta_quota: ${error.message}`);
	}
	const row = Array.isArray(data) ? data[0] : data;
	return {
		email: row.email as string,
		deviceId: row.device_id as string,
		emailUsed: Number(row.email_used) || 0,
		emailLimit: Number(row.email_limit) || TOKEN_LIMIT,
		emailRemaining: Number(row.email_remaining) || 0,
		deviceUsed: Number(row.device_used) || 0,
		deviceLimit: Number(row.device_limit) || TOKEN_LIMIT,
		deviceRemaining: Number(row.device_remaining) || 0,
	};
}

async function charge(
	email: string,
	deviceId: string,
	prompt: number,
	completion: number,
	cached: number,
	model?: string,
) {
	const sb = adminClient();
	const { data, error } = await sb.rpc('charge_beta_tokens', {
		p_email: email,
		p_device_id: deviceId,
		p_prompt_tokens: prompt,
		p_completion_tokens: completion,
		p_cached_tokens: cached,
		p_model: model ?? null,
	});
	if (error) {
		const msg = error.message || '';
		if (msg.includes('quota_exceeded')) {
			return { exceeded: true as const, message: msg };
		}
		throw new Error(`charge_beta_tokens: ${msg}`);
	}
	const row = Array.isArray(data) ? data[0] : data;
	return {
		exceeded: false as const,
		emailUsed: Number(row.email_used) || 0,
		emailRemaining: Number(row.email_remaining) || 0,
		deviceUsed: Number(row.device_used) || 0,
		deviceRemaining: Number(row.device_remaining) || 0,
		totalCharged: Number(row.total_charged) || 0,
	};
}

function encryptionSecret(): string {
	const secret = Deno.env.get('OPENROUTER_KEY_ENCRYPTION_SECRET');
	if (!secret) {
		throw new Error('OPENROUTER_KEY_ENCRYPTION_SECRET not configured');
	}
	return secret;
}

/** Sync profile + provision OpenRouter key on first login. Returns plaintext key for IDE bootstrap. */
async function ensureUserProfileAndKey(user: {
	id: string;
	email?: string;
	app_metadata?: Record<string, unknown>;
	user_metadata?: Record<string, unknown>;
	identities?: Array<{ provider?: string; identity_data?: Record<string, unknown> }>;
}): Promise<{
	profile: Record<string, unknown>;
	gatewayKey: string;
	keyName: string;
	provisioned: boolean;
}> {
	const sb = adminClient();
	const email = (user.email ?? '').toLowerCase();
	const identity = identityFromSupabaseUser(user);

	const { data: profile, error: profileErr } = await sb.rpc('upsert_user_profile', {
		p_user_id: user.id,
		p_email: email,
		p_github_username: identity.githubUsername ?? null,
		p_github_id: identity.githubId ?? null,
		p_display_name: identity.displayName ?? null,
		p_avatar_url: identity.avatarUrl ?? null,
		p_auth_provider: identity.authProvider,
	});
	if (profileErr) {
		throw new Error(`upsert_user_profile: ${profileErr.message}`);
	}

	const { data: active, error: subErr } = await sb.rpc('user_has_active_subscription', {
		p_user_id: user.id,
	});
	if (subErr) {
		throw new Error(`user_has_active_subscription: ${subErr.message}`);
	}
	if (!active) {
		return {
			profile: profile as Record<string, unknown>,
			gatewayKey: '',
			keyName: '',
			provisioned: false,
		};
	}

	const { data: existingKey, error: keyErr } = await sb.rpc('get_user_openrouter_key_plaintext', {
		p_user_id: user.id,
		p_encryption_secret: encryptionSecret(),
	});
	if (keyErr) {
		throw new Error(`get_user_openrouter_key_plaintext: ${keyErr.message}`);
	}

	if (typeof existingKey === 'string' && existingKey.startsWith('sk-or-')) {
		const keyName = openRouterKeyName(identity, email);
		return {
			profile: profile as Record<string, unknown>,
			gatewayKey: existingKey,
			keyName,
			provisioned: false,
		};
	}

	const keyName = openRouterKeyName(identity, email);
	const provisioned = await provisionOpenRouterKey(keyName);

	const { error: storeErr } = await sb.rpc('store_user_openrouter_key', {
		p_user_id: user.id,
		p_key_name: keyName,
		p_key_hash: provisioned.keyHash ?? null,
		p_key_plaintext: provisioned.key,
		p_encryption_secret: encryptionSecret(),
	});
	if (storeErr) {
		throw new Error(`store_user_openrouter_key: ${storeErr.message}`);
	}

	return {
		profile: profile as Record<string, unknown>,
		gatewayKey: provisioned.key,
		keyName,
		provisioned: true,
	};
}

async function resolveUpstreamKey(userId: string): Promise<string> {
	const sb = adminClient();
	const { data: active } = await sb.rpc('user_has_active_subscription', { p_user_id: userId });
	if (!active) {
		throw new Error('subscription_inactive');
	}

	const { data: userKey, error } = await sb.rpc('get_user_openrouter_key_plaintext', {
		p_user_id: userId,
		p_encryption_secret: encryptionSecret(),
	});
	if (error) {
		throw new Error(`get_user_openrouter_key_plaintext: ${error.message}`);
	}
	if (typeof userKey === 'string' && userKey.startsWith('sk-or-')) {
		return userKey;
	}

	// Fallback: shared workspace key (dev / migration)
	const fallback = Deno.env.get('OPENROUTER_API_KEY') ?? Deno.env.get('TOKENROUTER_API_KEY');
	if (fallback) {
		return fallback;
	}
	throw new Error('no_openrouter_key_for_user');
}

function upstreamBase(): string {
	return (Deno.env.get('OPENROUTER_BASE_URL') || OPENROUTER_BASE).replace(/\/$/, '');
}

function openRouterHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		'Content-Type': 'application/json',
		'HTTP-Referer': Deno.env.get('SINGULARITY_SITE_URL') || 'https://singularity.dev',
		'X-Title': Deno.env.get('SINGULARITY_APP_NAME') || 'Singularity',
	};
}

/** Strip /functions/v1/llm-proxy prefix so remainder is /v1/... */
function proxyPath(url: URL): string {
	const full = url.pathname;
	const marker = '/llm-proxy';
	const idx = full.indexOf(marker);
	if (idx >= 0) {
		return full.slice(idx + marker.length) || '/';
	}
	return full;
}

Deno.serve(async (req) => {
	if (req.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: CORS });
	}

	try {
		const url = new URL(req.url);
		const path = proxyPath(url);

		const auth = await authenticate(req);
		if ('error' in auth && auth.error) {
			return auth.error;
		}
		const { user, email } = auth as {
			user: {
				id: string;
				email?: string;
				app_metadata?: Record<string, unknown>;
				user_metadata?: Record<string, unknown>;
				identities?: Array<{ provider?: string; identity_data?: Record<string, unknown> }>;
			};
			email: string;
		};
		const deviceId = deviceIdFrom(req);
		if (!deviceId) {
			return json(400, { error: 'missing_device_id' });
		}

		await ensureIdentity(email, user.id, deviceId);
		const quota = await getQuota(email, deviceId);

		if (req.method === 'GET' && (path === '/v1/quota' || path === '/quota')) {
			return json(200, {
				emailRemaining: quota.emailRemaining,
				deviceRemaining: quota.deviceRemaining,
				emailUsed: quota.emailUsed,
				deviceUsed: quota.deviceUsed,
				emailLimit: quota.emailLimit,
				deviceLimit: quota.deviceLimit,
				tokenLimit: TOKEN_LIMIT,
			});
		}

		// Login/register: sync profile, provision OpenRouter key, return gateway for IDE (hidden from UI).
		if (req.method === 'POST' && (path === '/v1/register' || path === '/register')) {
			const session = await ensureUserProfileAndKey(user);
			const profile = session.profile;
			return json(200, {
				ok: true,
				email,
				deviceId,
				provisioned: session.provisioned,
				subscription: {
					plan: profile.subscription_plan,
					status: profile.subscription_status,
					startedAt: profile.subscription_started_at,
				},
				githubUsername: profile.github_username ?? null,
				// IDE stores this in ~/.singularity/beta-auth.json + VS Code secrets — never shown in UI.
				gateway: session.gatewayKey
					? {
						provider: 'openrouter',
						baseUrl: upstreamBase(),
						apiKey: session.gatewayKey,
						keyName: session.keyName,
					}
					: null,
				emailRemaining: quota.emailRemaining,
				deviceRemaining: quota.deviceRemaining,
			});
		}

		if (
			ENFORCE_TOKEN_QUOTA &&
			(quota.emailRemaining <= 0 || quota.deviceRemaining <= 0)
		) {
			return json(402, {
				error: 'quota_exceeded',
				message: 'Beta token limit reached.',
				emailRemaining: quota.emailRemaining,
				deviceRemaining: quota.deviceRemaining,
			});
		}

		let upstreamKey: string;
		try {
			upstreamKey = await resolveUpstreamKey(user.id);
		} catch (err) {
			const msg = String(err);
			if (msg.includes('subscription_inactive')) {
				return json(402, { error: 'subscription_inactive', message: 'Active subscription required.' });
			}
			throw err;
		}

		if (req.method === 'GET' && (path === '/v1/models' || path.startsWith('/v1/models'))) {
			const upstream = await fetch(`${upstreamBase()}/models${url.search}`, {
				method: 'GET',
				headers: openRouterHeaders(upstreamKey),
			});
			const body = await upstream.text();
			return new Response(body, {
				status: upstream.status,
				headers: {
					...CORS,
					'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
				},
			});
		}

		if (req.method === 'POST' && path.endsWith('/chat/completions')) {
			const raw = await req.text();
			let parsed: Record<string, unknown> = {};
			try {
				parsed = JSON.parse(raw);
			} catch {
				return json(400, { error: 'invalid_json' });
			}
			const stream = Boolean(parsed.stream);
			const model = typeof parsed.model === 'string' ? parsed.model : undefined;

			const upstream = await fetch(`${upstreamBase()}/chat/completions`, {
				method: 'POST',
				headers: openRouterHeaders(upstreamKey),
				body: raw,
			});

			if (!upstream.ok) {
				const errText = await upstream.text();
				return new Response(errText, {
					status: upstream.status,
					headers: {
						...CORS,
						'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
					},
				});
			}

			if (!stream) {
				const payload = await upstream.json();
				const u = usageCharge(payload.usage as Record<string, unknown> | undefined);
				const charged = await charge(email, deviceId, u.prompt, u.completion, u.cached, model);
				if (ENFORCE_TOKEN_QUOTA && charged.exceeded) {
					return json(402, {
						error: 'quota_exceeded',
						message: 'Beta token limit reached while charging usage.',
					});
				}
				return json(200, payload);
			}

			const reader = upstream.body?.getReader();
			if (!reader) {
				return json(502, { error: 'empty_upstream_stream' });
			}
			const decoder = new TextDecoder();
			let buffer = '';
			let lastUsage: Record<string, unknown> | undefined;
			const { readable, writable } = new TransformStream();
			const writer = writable.getWriter();

			(async () => {
				try {
					for (;;) {
						const { done, value } = await reader.read();
						if (done) {
							break;
						}
						await writer.write(value);
						buffer += decoder.decode(value, { stream: true });
						const lines = buffer.split('\n');
						buffer = lines.pop() ?? '';
						for (const line of lines) {
							const trimmed = line.trim();
							if (!trimmed.startsWith('data:')) {
								continue;
							}
							const data = trimmed.slice(5).trim();
							if (!data || data === '[DONE]') {
								continue;
							}
							try {
								const chunk = JSON.parse(data);
								if (chunk.usage) {
									lastUsage = chunk.usage;
								}
							} catch {
								/* ignore partial JSON */
							}
						}
					}
					const u = usageCharge(lastUsage);
					await charge(email, deviceId, u.prompt, u.completion, u.cached, model);
				} catch (err) {
					console.error('stream charge failed', err);
				} finally {
					try {
						await writer.close();
					} catch {
						/* ignore */
					}
				}
			})();

			return new Response(readable, {
				status: 200,
				headers: {
					...CORS,
					'Content-Type': upstream.headers.get('Content-Type') || 'text/event-stream',
					'Cache-Control': 'no-cache',
				},
			});
		}

		return json(404, { error: 'not_found', path });
	} catch (err) {
		console.error(err);
		return json(500, { error: 'proxy_error', detail: String(err) });
	}
});
