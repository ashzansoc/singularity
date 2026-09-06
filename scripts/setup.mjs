#!/usr/bin/env node
/**
 * One-command OpenRouter setup for Singularity.
 *
 *   npm run setup
 *
 * What it does:
 *   1. Copies `.env.example` → `.env` when `.env` is missing (or merges missing keys).
 *   2. Prompts for your OpenRouter API key (non-echoed, optional — skip and the
 *      IDE will keep using sign-in / beta defaults).
 *   3. Writes the key into `.env` (never into git; `.env` is gitignored).
 *   4. Prints what's next: `npm start`.
 *
 * Key must be an OpenRouter key (`sk-or-…`). Paste it from
 * https://openrouter.ai/settings/keys
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_EXAMPLE = join(ROOT, '.env.example');
const ENV = join(ROOT, '.env');

/** Ask a question with hidden echo (callback style — safe across Node 16–24). */
function askHidden(rl, prompt) {
	return new Promise((resolve) => {
		rl.question(prompt, { hideEchoBack: true }, (val) => resolve(val));
	});
}

/** Parse `KEY=VALUE` lines (ignores comments and blanks). Empty values kept. */
function parseEnv(text) {
	const entries = [];
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) {
			continue;
		}
		const eq = trimmed.indexOf('=');
		if (eq <= 0) {
			continue;
		}
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		entries.push([key, value]);
	}
	return entries;
}

function isOpenRouterKey(key) {
	return typeof key === 'string' && /^sk-or-/.test(key.trim());
}

/** Merge in order: existing .env wins over .env.example. */
function mergeEnv(envLines, exampleLines) {
	const byKey = new Map();
	for (const [key, value] of exampleLines) {
		byKey.set(key, value);
	}
	for (const [key, value] of envLines) {
		byKey.set(key, value);
	}
	return [...byKey.entries()];
}

async function main() {
	if (!existsSync(ENV_EXAMPLE)) {
		console.error(`[setup] Missing ${ENV_EXAMPLE} — run setup from the repository root.`);
		process.exit(1);
	}

	const exampleRaw = readFileSync(ENV_EXAMPLE, 'utf8');
	const exampleLines = parseEnv(exampleRaw);
	const hadEnv = existsSync(ENV);
	const envLines = hadEnv ? parseEnv(readFileSync(ENV, 'utf8')) : [];
	const merged = mergeEnv(envLines, exampleLines);

	const rl = readline.createInterface({ input, output, terminal: true });

	console.log('\n  Singularity — OpenRouter setup');
	console.log('  -------------------------------');

	const answer = (await askHidden(
		rl,
		'\n  Paste your OpenRouter API key (sk-or-…, hidden; Enter to skip): ',
	)).trim();
	rl.close();

	if (answer) {
		if (!isOpenRouterKey(answer)) {
			console.error(
				'\n[setup] That doesn’t look like an OpenRouter key (expected `sk-or-…`).\n' +
				'        Get one at https://openrouter.ai/settings/keys — nothing was written.',
			);
			process.exit(1);
		}
		const idx = merged.findIndex(([k]) => k === 'OPENROUTER_API_KEY');
		if (idx >= 0) {
			merged[idx] = ['OPENROUTER_API_KEY', answer];
		} else {
			merged.push(['OPENROUTER_API_KEY', answer]);
		}
	}

	const comments = exampleRaw
		.split(/\r?\n/)
		.filter((l) => l.trim().startsWith('#'))
		.join('\n');
	const body = merged.map(([k, v]) => `${k}=${v}`).join('\n');
	const out = (hadEnv ? '' : comments + '\n\n') + body + '\n';

	writeFileSync(ENV, out, { mode: 0o600 });

	if (answer) {
		console.log('\n  ✅ OPENROUTER_API_KEY saved to .env (hidden from git).');
	} else if (!hadEnv) {
		console.log('\n  ℹ️  No key provided — .env created from .env.example.');
		console.log('     You can add OPENROUTER_API_KEY later, or run `npm run setup` again.');
	} else {
		console.log('\n  ℹ️  .env already exists — left as-is (no key provided).');
	}

	console.log('\n  Next: npm start  (or npm run launch)');
	console.log('  Keys: https://openrouter.ai/settings/keys\n');
}

main().catch((err) => {
	console.error('[setup] Failed:', err.message || err);
	process.exit(1);
});