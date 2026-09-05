/**
 * Prompt Engine v2 — SHA-256 hashing + token estimates.
 */

import { createHash } from 'node:crypto';

/** SHA-256 hex digest for cache keys and durable node hashes. */
export function sha256(content: string): string {
	return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Stable object hash (sorted keys). */
export function sha256Object(value: unknown): string {
	return sha256(stableStringify(value));
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Fast FNV-1a 32-bit — hot dirty-checks only. */
export function hashContent(content: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < content.length; i++) {
		h ^= content.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

export function estimateTokens(text: string): number {
	if (!text) {
		return 0;
	}
	return Math.max(1, Math.ceil(text.length / 4));
}

export function hashObject(value: unknown): string {
	return hashContent(stableStringify(value));
}
