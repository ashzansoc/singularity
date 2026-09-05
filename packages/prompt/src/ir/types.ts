/**
 * Prompt IR v3 — graph-structured, fingerprintable intermediate representation.
 */

import { IR_VERSION } from '../graph/types.js';

export type PromptBlockRole =
	| 'system'
	| 'repository'
	| 'retrieval'
	| 'conversation'
	| 'memory'
	| 'diagnostics'
	| 'tool'
	| 'selection'
	| 'git'
	| 'metadata'
	| 'user'
	| 'context'
	| 'history'
	| 'assistant';

export interface PromptBlock {
	id: string;
	role: PromptBlockRole;
	nodeIds: string[];
	segmentIds?: string[];
	text: string;
	estimatedTokens: number;
	tokenCount: number;
	priority: number;
	hash: string;
	version?: number;
	dependencies: string[];
	compressionLevel: number;
	importance?: number;
	retrievalConfidence?: number;
	cacheBreakpoint?: boolean;
}

/** Graph view of Prompt IR — blocks reference each other. */
export interface PromptIRGraph {
	roots: string[];
	blocks: Record<string, PromptBlock>;
	edges: Array<{ from: string; to: string; kind: 'depends_on' | 'contains' | 'follows' }>;
}

/** Per-block fingerprint for context diffing, caching, and economy telemetry. */
export interface ContextBlockFingerprint {
	blockId: string;
	role: PromptBlockRole;
	contentSha256: string;
	tokenCount: number;
	cacheBreakpoint?: boolean;
}

export interface PromptFingerprint {
	sha256: string;
	similarityHash: string;
	embedding: number[];
	repositoryVersion: string;
	conversationVersion: string;
	memoryVersion: string;
	dependencyVersion: string;
	intent: string;
	irVersion: number;
	/** Stable map of every IR block's content hash. */
	blockFingerprints?: ContextBlockFingerprint[];
}

export interface PromptIR {
	sessionId: string;
	intent: string;
	blocks: PromptBlock[];
	/** v3 traversable graph projection. */
	graph?: PromptIRGraph;
	fingerprint?: PromptFingerprint;
	totalTokens: number;
	budgetTokens: number;
	droppedSegmentIds: string[];
	droppedNodeIds?: string[];
	averageQuality?: number;
	irHash: string;
	compiledAt: number;
	compilerVersion: typeof IR_VERSION | 1 | 2;
	metadata?: {
		repoHash?: string;
		conversationHash?: string;
		memoryHash?: string;
		selectionHash?: string;
		diagnosticsHash?: string;
		gitHash?: string;
		retrievedCount?: number;
		stageTimingsMs?: Record<string, number>;
		fromSnapshot?: boolean;
		/** Context diff vs prior IR in the same session. */
		contextDiff?: {
			unchanged: string[];
			changed: string[];
			addedDeps: string[];
			reusedBlockIds: string[];
			rebuiltBlockIds: string[];
		};
		/** Budget allocation summary for Context Economy. */
		budgetAllocation?: BudgetAllocationReport;
	};
}

export interface BudgetAllocationReport {
	budgetTokens: number;
	totalTokens: number;
	byRole: Record<string, { kept: number; dropped: number; truncated: number }>;
	droppedIds: string[];
	truncatedIds: string[];
	priorityBands: { p0: number; p1: number; p2: number; p3: number };
}

export interface RenderedMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	name?: string;
	providerExtras?: Record<string, unknown>;
}

export interface RenderedPrompt {
	provider: string;
	messages: RenderedMessage[];
	cacheHints?: {
		cacheControl?: { type: 'ephemeral' };
		promptCacheKey?: string;
		prefixHash?: string;
	};
	tokenEstimate: number;
}
