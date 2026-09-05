/**
 * Level 7 — Prompt IR Cache (Memory + SQLite-compatible durable store)
 */

import { SqliteStore } from '@singularity/cache';
import { sha256Object } from '../hash.js';
import { IR_VERSION } from '../graph/types.js';
import type { PromptCache, PromptCacheKeyParts } from '../interfaces/index.js';
import type { PromptIR } from '../ir/types.js';

interface CacheEntry {
	ir: PromptIR;
	expiresAt: number;
	lastAccess: number;
}

export interface PromptIrCacheOptions {
	maxEntries?: number;
	defaultTtlMs?: number;
	durableDir?: string;
	workspaceId?: string;
}

export class DurablePromptCache implements PromptCache {
	private readonly memory = new Map<string, CacheEntry>();
	private readonly maxEntries: number;
	private readonly defaultTtlMs: number;
	private readonly workspaceId: string;
	private readonly durable?: SqliteStore;
	private hits = 0;
	private misses = 0;

	constructor(options: PromptIrCacheOptions = {}) {
		this.maxEntries = options.maxEntries ?? 256;
		this.defaultTtlMs = options.defaultTtlMs ?? 30 * 60_000;
		this.workspaceId = options.workspaceId ?? 'default';
		if (options.durableDir) {
			this.durable = new SqliteStore({
				dir: options.durableDir,
				filename: 'prompt-ir-cache.json',
			});
		}
	}

	buildKey(parts: PromptCacheKeyParts): string {
		return sha256Object({
			...parts,
			irVersion: parts.irVersion || IR_VERSION,
		});
	}

	get(key: string): PromptIR | undefined {
		const now = Date.now();
		const mem = this.memory.get(key);
		if (mem) {
			if (mem.expiresAt < now) {
				this.memory.delete(key);
			} else {
				mem.lastAccess = now;
				this.hits++;
				return mem.ir;
			}
		}
		if (this.durable) {
			const rec = this.durable.get(`ir:${key}`);
			if (rec?.value) {
				try {
					const ir = JSON.parse(rec.value) as PromptIR;
					this.memory.set(key, {
						ir,
						expiresAt: rec.expiresAt,
						lastAccess: now,
					});
					this.hits++;
					return ir;
				} catch {
					/* ignore corrupt */
				}
			}
		}
		this.misses++;
		return undefined;
	}

	set(key: string, ir: PromptIR, ttlMs?: number): void {
		const ttl = ttlMs ?? this.defaultTtlMs;
		const expiresAt = Date.now() + ttl;
		const createdAt = Date.now();
		this.memory.set(key, { ir, expiresAt, lastAccess: createdAt });
		this.evict();
		this.durable?.set({
			key: `ir:${key}`,
			value: JSON.stringify(ir),
			expiresAt,
			meta: {
				layer: 'L4',
				workspaceId: this.workspaceId,
				createdAt,
				expiresAt,
				schemaVersion: IR_VERSION,
			},
		});
	}

	invalidate(prefix?: string): void {
		if (!prefix) {
			this.memory.clear();
			this.durable?.clear();
			return;
		}
		for (const key of [...this.memory.keys()]) {
			if (key.startsWith(prefix)) {
				this.memory.delete(key);
			}
		}
	}

	stats(): { hits: number; misses: number; size: number } {
		return { hits: this.hits, misses: this.misses, size: this.memory.size };
	}

	private evict(): void {
		while (this.memory.size > this.maxEntries) {
			let oldestKey: string | undefined;
			let oldest = Infinity;
			for (const [k, v] of this.memory) {
				if (v.lastAccess < oldest) {
					oldest = v.lastAccess;
					oldestKey = k;
				}
			}
			if (oldestKey) {
				this.memory.delete(oldestKey);
			} else {
				break;
			}
		}
	}
}

/** Back-compat alias used by v1 pipeline. */
export class LocalPromptIrCache {
	private readonly inner: DurablePromptCache;
	constructor(options?: { maxEntries?: number }) {
		this.inner = new DurablePromptCache(options);
	}
	get(sessionId: string, irHash: string): PromptIR | undefined {
		return this.inner.get(`${sessionId}:${irHash}`);
	}
	set(ir: PromptIR): void {
		this.inner.set(`${ir.sessionId}:${ir.irHash}`, ir);
	}
}

export type { PromptIrCacheOptions as IrCacheOptions };
export type IrCacheEntry = { ir: PromptIR };
