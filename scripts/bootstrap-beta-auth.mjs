#!/usr/bin/env node
/**
 * Manual Supabase beta login + OpenRouter key provisioning.
 * Use when the IDE access gate is unavailable. Writes ~/.singularity/beta-auth.json.
 *
 * Usage:
 *   node scripts/bootstrap-beta-auth.mjs
 *   node scripts/bootstrap-beta-auth.mjs '<email-link-with-access_token>'
 *   node scripts/bootstrap-beta-auth.mjs '<6-digit-code>' 'you@zansoc.com'
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const SUPABASE_URL = 'https://nuwsczuwyezpodtnouqf.supabase.co';
const SUPABASE_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51d3NjenV3eWV6cG9kdG5vdXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTExMTYsImV4cCI6MjEwMTk2NzExNn0.xqrEqaV9pfQchO7MDs6E-59wGDDIIqDLs5qVfsGwkQs';
const PROXY = `${SUPABASE_URL}/functions/v1/llm-proxy/v1`;
const ALLOWED_EMAIL_DOMAIN = 'zansoc.com';
const AUTH_FILE = join(homedir(), '.singularity', 'beta-auth.json');

function isAllowedEmail(email) {
	const normalized = email.trim().toLowerCase();
	const suffix = `@${ALLOWED_EMAIL_DOMAIN}`;
	return normalized.endsWith(suffix) && normalized.length > suffix.length;
}

function parseTokens(raw) {
	const text = raw.trim();
	if (/github\.com\/login\/oauth/i.test(text)) {
		throw new Error(
			'That is the GitHub login URL (before sign-in). Finish signing in on GitHub first.\n' +
			'You should land on: https://singularity-ide.web.app/auth/beta.html#access_token=...\n' +
			'Copy that full URL from the browser address bar (or click "Copy page URL" on that page).',
		);
	}
	let fragment = text;
	if (/^https?:\/\//i.test(text) || /^singularity:/i.test(text)) {
		const hash = text.indexOf('#');
		fragment = hash >= 0 ? text.slice(hash + 1) : text.split('?')[1] ?? '';
	}
	if (fragment.startsWith('#')) {
		fragment = fragment.slice(1);
	}
	const params = new URLSearchParams(fragment);
	const accessToken = params.get('access_token');
	if (!accessToken) {
		if (/singularity-ide\.web\.app\/auth\/beta\.html/i.test(text) && !text.includes('#')) {
			throw new Error(
				'Beta page URL has no #access_token. Sign-in may not have completed — run the script again and finish GitHub auth.',
			);
		}
		throw new Error(
			'No access_token in URL.\n' +
			'Expected: https://singularity-ide.web.app/auth/beta.html#access_token=...&refresh_token=...\n' +
			'Or: singularity://beta-auth#access_token=...',
		);
	}
	return {
		accessToken,
		refreshToken: params.get('refresh_token') ?? undefined,
		expiresIn: Number(params.get('expires_in') ?? '3600'),
	};
}

async function fetchUser(accessToken) {
	const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
		headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) {
		throw new Error(`Supabase user lookup failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

function githubUsername(user) {
	for (const id of user.identities ?? []) {
		if (id.provider === 'github') {
			const d = id.identity_data ?? {};
			if (typeof d.user_name === 'string' && d.user_name) return d.user_name;
			if (typeof d.preferred_username === 'string' && d.preferred_username) return d.preferred_username;
		}
	}
	const m = user.user_metadata ?? {};
	if (typeof m.preferred_username === 'string' && m.preferred_username) return m.preferred_username;
	if (typeof m.user_name === 'string' && m.user_name) return m.user_name;
	return undefined;
}

async function register(accessToken, deviceId) {
	const res = await fetch(`${PROXY}/register`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			apikey: SUPABASE_ANON_KEY,
			'X-Singularity-Device-Id': deviceId,
			'Content-Type': 'application/json',
		},
		body: '{}',
	});
	const body = await res.text();
	if (!res.ok) {
		throw new Error(`Register failed (${res.status}): ${body}`);
	}
	return JSON.parse(body);
}

async function main() {
	let raw = process.argv[2];
	let interactiveEmail;

	if (!raw) {
		const rl = readline.createInterface({ input, output });
		interactiveEmail = (await rl.question(`\nEnter your @${ALLOWED_EMAIL_DOMAIN} email:\n`)).trim().toLowerCase();
		if (!isAllowedEmail(interactiveEmail)) {
			rl.close();
			throw new Error(`Only @${ALLOWED_EMAIL_DOMAIN} email addresses can access Singularity.`);
		}
		console.log(`\nSending login code to ${interactiveEmail}...`);
		const otpRes = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
			method: 'POST',
			headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: interactiveEmail, create_user: true }),
		});
		if (!otpRes.ok) {
			rl.close();
			throw new Error(`OTP send failed: ${otpRes.status} ${await otpRes.text()}`);
		}
		raw = await rl.question('\nEnter the code from your email, or paste the email link:\n');
		rl.close();
	}

	let tokens;
	if (raw.includes('access_token')) {
		tokens = parseTokens(raw);
	} else {
		const email = (interactiveEmail ?? process.argv[3]?.trim().toLowerCase());
		if (!email || !isAllowedEmail(email)) {
			throw new Error(`Usage: node scripts/bootstrap-beta-auth.mjs <email-code-or-link> <you@${ALLOWED_EMAIL_DOMAIN}>`);
		}
		const verifyRes = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
			method: 'POST',
			headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, token: raw.trim(), type: 'email' }),
		});
		if (!verifyRes.ok) {
			throw new Error(`Verify failed: ${verifyRes.status} ${await verifyRes.text()}`);
		}
		const data = await verifyRes.json();
		if (!data.access_token) {
			throw new Error('Verify response missing access_token');
		}
		tokens = {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresIn: Number(data.expires_in ?? '3600'),
		};
	}

	const user = await fetchUser(tokens.accessToken);
	const email = (user.email ?? '').toLowerCase();
	if (!email) {
		throw new Error('Supabase user has no email');
	}
	if (!isAllowedEmail(email)) {
		throw new Error(`Only @${ALLOWED_EMAIL_DOMAIN} email addresses can access Singularity.`);
	}

	const deviceId = randomUUID();
	const auth = {
		email,
		userId: user.id,
		accessToken: tokens.accessToken,
		refreshToken: tokens.refreshToken,
		expiresAt: Date.now() + Math.max(60, tokens.expiresIn || 3600) * 1000,
		deviceId,
		githubUsername: githubUsername(user),
	};

	console.log('\nRegistering profile + provisioning OpenRouter key...');
	const reg = await register(tokens.accessToken, deviceId);
	if (reg.gateway?.apiKey) {
		auth.openrouterApiKey = reg.gateway.apiKey;
		auth.openrouterBaseUrl = reg.gateway.baseUrl;
		auth.openrouterKeyName = reg.gateway.keyName;
	}
	if (reg.subscription?.startedAt) {
		auth.subscriptionStartedAt = reg.subscription.startedAt;
	}
	if (reg.githubUsername) {
		auth.githubUsername = reg.githubUsername;
	}

	mkdirSync(join(homedir(), '.singularity'), { recursive: true });
	writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });

	console.log('\nWrote', AUTH_FILE);
	console.log('  email:', auth.email);
	console.log('  github:', auth.githubUsername ?? '(none)');
	console.log('  openrouter key name:', auth.openrouterKeyName ?? '(none)');
	console.log('  openrouterApiKey:', auth.openrouterApiKey?.startsWith('sk-or-') ? 'sk-or-… (set)' : 'MISSING — check Supabase llm-proxy secrets');
	console.log('\nRestart Singularity. Check Supabase user_profiles and OpenRouter keys dashboard.');
}

main().catch((err) => {
	console.error('\nError:', err.message ?? err);
	process.exit(1);
});
