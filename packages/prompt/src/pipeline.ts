/**
 * End-to-end pipeline:
 * IDE → Context Builder → Canonical Context → Segments → Compiler → IR
 *   → Local IR Cache → Provider Adapter → Provider Cache Hints → messages
 */

import { renderForProvider } from './adapters/registry.js';
import type { ProviderKind } from './adapters/types.js';
import { normalizeProviderKind } from './adapters/types.js';
import {
	applyBuilderUpdate,
	createIncrementalBuilder,
	type BuilderUpdate,
	type IncrementalBuilderState,
} from './builder/incremental.js';
import { LocalPromptIrCache } from './cache/irCache.js';
import { compilePrompt, type CompileOptions } from './compiler/compiler.js';
import type { PromptIR, RenderedPrompt } from './compiler/ir.js';
import type { SegmentedContextState } from './segments/segment.js';
import type { CanonicalContext } from './types.js';

export interface PromptPipelineOptions {
	budgetTokens?: number;
	compressConversation?: boolean;
	keepRecentTurns?: number;
	irCache?: LocalPromptIrCache;
}

export interface PromptPipelineState {
	builder: IncrementalBuilderState;
	segments?: SegmentedContextState;
	lastIr?: PromptIR;
	irCache: LocalPromptIrCache;
}

export interface PipelineResult {
	context: CanonicalContext;
	ir: PromptIR;
	rendered: RenderedPrompt;
	fromIrCache: boolean;
	dirtyUris: string[];
	segments: SegmentedContextState;
}

export function createPromptPipeline(
	sessionId: string,
	options: PromptPipelineOptions = {},
): PromptPipelineState {
	return {
		builder: createIncrementalBuilder(sessionId),
		irCache: options.irCache ?? new LocalPromptIrCache(),
	};
}

export function runPromptPipeline(
	state: PromptPipelineState,
	update: BuilderUpdate,
	provider: string | ProviderKind,
	options: PromptPipelineOptions = {},
): { state: PromptPipelineState; result: PipelineResult } {
	const builder = applyBuilderUpdate(state.builder, update);
	const compileOpts: CompileOptions = {
		budgetTokens: options.budgetTokens ?? 12_000,
		compressConversation: options.compressConversation ?? true,
		keepRecentTurns: options.keepRecentTurns ?? 6,
	};

	const compiled = compilePrompt(builder.context, compileOpts, state.segments);
	const cache = options.irCache ?? state.irCache;

	let ir = cache.get(compiled.ir.sessionId, compiled.ir.irHash);
	let fromIrCache = true;
	if (!ir) {
		ir = compiled.ir;
		cache.set(ir);
		fromIrCache = false;
	}

	const rendered = renderForProvider(ir, normalizeProviderKind(String(provider)));

	const next: PromptPipelineState = {
		builder,
		segments: compiled.segments,
		lastIr: ir,
		irCache: cache,
	};

	return {
		state: next,
		result: {
			context: compiled.context,
			ir,
			rendered,
			fromIrCache,
			dirtyUris: [...builder.dirtyUris],
			segments: compiled.segments,
		},
	};
}
