/**
 * Level 3 — Context Segmentation
 * Immutable segments with hash, version, token count, and cache metadata.
 */

import { estimateTokens, hashContent } from '../hash.js';
import {
	ALL_SEGMENT_IDS,
	type CanonicalContext,
	type SegmentId,
	materializeSegmentText,
} from '../types.js';

export interface ContextSegment {
	id: SegmentId;
	hash: string;
	version: number;
	tokenCount: number;
	dirty: boolean;
	/** Opaque cache key for local IR / provider prefix reuse. */
	cacheKey?: string;
	/** Materialized text when dirty or when store requests content. */
	content?: string;
}

export interface SegmentedContextState {
	sessionId: string;
	segments: Record<SegmentId, ContextSegment>;
	totalTokens: number;
	unchangedTokens: number;
	rebuiltTokens: number;
}

function emptySegment(id: SegmentId): ContextSegment {
	return { id, hash: '', version: 0, tokenCount: 0, dirty: true };
}

export function createSegmentedContext(sessionId: string): SegmentedContextState {
	const segments = Object.fromEntries(
		ALL_SEGMENT_IDS.map((id) => [id, emptySegment(id)]),
	) as Record<SegmentId, ContextSegment>;
	return {
		sessionId,
		segments,
		totalTokens: 0,
		unchangedTokens: 0,
		rebuiltTokens: 0,
	};
}

/**
 * Diff canonical context into segments. Only dirty segments need recompilation.
 */
export function updateSegmentsFromContext(
	prev: SegmentedContextState | undefined,
	ctx: CanonicalContext,
	options?: { retainContent?: boolean },
): SegmentedContextState {
	const base =
		prev?.sessionId === ctx.sessionId ? prev : createSegmentedContext(ctx.sessionId);
	let unchangedTokens = 0;
	let rebuiltTokens = 0;
	let totalTokens = 0;
	const segments = { ...base.segments };

	for (const id of ALL_SEGMENT_IDS) {
		const content = materializeSegmentText(ctx, id);
		const hash = content ? hashContent(content) : '';
		const tokens = content ? estimateTokens(content) : 0;
		const prevSeg = base.segments[id];
		const dirty = !prevSeg || prevSeg.hash !== hash;
		const version = dirty ? (prevSeg?.version ?? 0) + 1 : prevSeg.version;
		segments[id] = {
			id,
			hash,
			version,
			tokenCount: tokens,
			dirty,
			cacheKey: dirty ? undefined : (prevSeg.cacheKey ?? `${id}:${hash}`),
			...(options?.retainContent || dirty ? { content } : {}),
		};
		totalTokens += tokens;
		if (dirty) {
			rebuiltTokens += tokens;
		} else {
			unchangedTokens += tokens;
		}
	}

	return {
		sessionId: ctx.sessionId,
		segments,
		totalTokens,
		unchangedTokens,
		rebuiltTokens,
	};
}

export function dirtySegmentIds(state: SegmentedContextState): SegmentId[] {
	return ALL_SEGMENT_IDS.filter((id) => state.segments[id].dirty);
}

export function segmentContents(
	state: SegmentedContextState,
	ctx: CanonicalContext,
): Record<SegmentId, string> {
	const out = {} as Record<SegmentId, string>;
	for (const id of ALL_SEGMENT_IDS) {
		out[id] = state.segments[id].content ?? materializeSegmentText(ctx, id);
	}
	return out;
}
