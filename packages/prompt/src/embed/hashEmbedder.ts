/**
 * Default + Hash embedders for semantic retrieval.
 */

import { HashEmbedder as CacheHashEmbedder } from '@singularity/cache';
import type { Embedder } from '../interfaces/index.js';

export class DefaultHashEmbedder implements Embedder {
	private readonly inner = new CacheHashEmbedder(64);
	readonly dimensions = 64;

	embed(text: string): number[] {
		return this.inner.embed(text);
	}
}

export function cosineSimilarity(a: number[], b: number[]): number {
	const n = Math.min(a.length, b.length);
	if (n === 0) {
		return 0;
	}
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < n; i++) {
		dot += a[i]! * b[i]!;
		na += a[i]! * a[i]!;
		nb += b[i]! * b[i]!;
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb);
	return denom === 0 ? 0 : dot / denom;
}
