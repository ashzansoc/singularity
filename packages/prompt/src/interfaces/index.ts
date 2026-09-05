/**
 * Prompt Engine v2 — DI contracts (Level 17).
 */

import type { GraphEdge, GraphNode, MemoryNode, MemoryScope, NodeKind } from '../graph/types.js';
import type { PromptIR, RenderedPrompt } from '../ir/types.js';
import type { PromptIntent } from '../types.js';

export interface Embedder {
	embed(text: string): Promise<number[]> | number[];
	readonly dimensions: number;
}

export interface LanguageExtractor {
	readonly languages: string[];
	extract(input: {
		uri: string;
		content: string;
		languageId?: string;
	}): {
		symbols: Array<{
			kind: 'class' | 'function' | 'interface' | 'symbol';
			name: string;
			startLine?: number;
			endLine?: number;
			content?: string;
		}>;
		imports: Array<{ name: string; from: string }>;
		exports: Array<{ name: string }>;
		calls?: Array<{ from: string; to: string }>;
	};
}

export interface FileChangeEvent {
	uri: string;
	content: string;
	version: number;
	languageId?: string;
	removed?: boolean;
}

export interface IncrementalIndexer {
	indexFile(event: FileChangeEvent): Promise<void> | void;
	removeFile(uri: string): Promise<void> | void;
	getFileHash(uri: string): string | undefined;
	dirtyUris(): string[];
	clearDirty(): void;
}

export interface ContextGraph {
	upsertNode(node: GraphNode): void;
	removeNode(id: string): void;
	getNode(id: string): GraphNode | undefined;
	listNodes(kind?: NodeKind): GraphNode[];
	addEdge(edge: GraphEdge): void;
	removeEdges(nodeId: string): void;
	neighbors(id: string, kind?: GraphEdge['kind']): GraphNode[];
	repoHash(): string;
	snapshot(): { nodes: GraphNode[]; edges: GraphEdge[] };
	materialize(nodeId: string): string;
}

export interface MemoryManager {
	upsert(memory: Omit<MemoryNode, 'kind' | 'hash' | 'version' | 'tokenCount' | 'dependencies' | 'lastModified'> & Partial<MemoryNode>): MemoryNode;
	remove(id: string): void;
	get(id: string): MemoryNode | undefined;
	list(scope?: MemoryScope): MemoryNode[];
	touch(id: string): void;
	semanticSearch(queryEmbedding: number[], topK: number, scope?: MemoryScope): MemoryNode[];
	memoryHash(): string;
}

export interface RetrievalQuery {
	prompt: string;
	cursorUri?: string;
	selectionText?: string;
	selectionUri?: string;
	openFileUris?: string[];
	diagnostics?: Array<{ uri: string; message: string; severity?: string }>;
	gitDiff?: string;
	agentState?: Record<string, unknown>;
	topK?: number;
}

export interface RetrievalHit {
	nodeId: string;
	score: number;
	reason: string;
}

export interface RetrievalEngine {
	retrieve(query: RetrievalQuery): Promise<RetrievalHit[]> | RetrievalHit[];
}

export type VmOpcode =
	| 'LOAD'
	| 'LOAD_SUMMARY'
	| 'LOAD_NODE'
	| 'LOAD_NEIGHBORS'
	| 'COMPRESS'
	| 'BUDGET_SLICE'
	| 'EMIT_BLOCK';

export interface VmInstruction {
	op: VmOpcode;
	/** Target kind, node id, or block role depending on op. */
	arg?: string;
	nodeIds?: string[];
	limit?: number;
}

export interface VmProgram {
	intent: PromptIntent | string;
	instructions: VmInstruction[];
}

export interface VmWorkingSet {
	nodeIds: string[];
	emittedBlocks: Array<{ role: string; nodeIds: string[] }>;
	compressedIds: string[];
}

export interface ContextVM {
	buildProgram(intent: PromptIntent | string, retrieved: RetrievalHit[]): VmProgram;
	execute(program: VmProgram, graph: ContextGraph): VmWorkingSet;
}

export interface CompileInput {
	sessionId: string;
	intent: string;
	systemPrompt: string;
	userPrompt: string;
	workingSet: VmWorkingSet;
	graph: ContextGraph;
	budgetTokens: number;
	priorIr?: PromptIR;
}

export interface PromptCompiler {
	compile(input: CompileInput): PromptIR;
}

export interface PromptCacheKeyParts {
	repoHash: string;
	conversationHash: string;
	memoryHash: string;
	selectionHash: string;
	diagnosticsHash: string;
	gitHash: string;
	irVersion: number;
}

export interface PromptCache {
	get(key: string): PromptIR | undefined;
	set(key: string, ir: PromptIR, ttlMs?: number): void;
	buildKey(parts: PromptCacheKeyParts): string;
	invalidate(prefix?: string): void;
	stats(): { hits: number; misses: number; size: number };
}

export interface DeltaResult {
	ir: PromptIR;
	reusedBlockIds: string[];
	rebuiltBlockIds: string[];
}

export interface DeltaEngine {
	apply(prior: PromptIR | undefined, next: PromptIR): DeltaResult;
}

export interface ConversationTurnInput {
	id: string;
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	createdAt: number;
}

export interface ConversationState {
	recentTurns: ConversationTurnInput[];
	summary: string;
	importantFacts: string[];
	resolvedTasks: string[];
	pendingTasks: string[];
	referencedMessageIds: string[];
	conversationHash: string;
}

export interface ConversationEngine {
	ingest(turns: ConversationTurnInput[]): ConversationState;
	toNodes(state: ConversationState): GraphNode[];
}

export interface BudgetItem {
	id: string;
	priority: number;
	tokenCount: number;
	text: string;
	truncatable?: boolean;
}

export interface BudgetResult {
	kept: BudgetItem[];
	dropped: string[];
	truncated: string[];
	totalTokens: number;
	budgetTokens: number;
}

export interface BudgetOptimizer {
	optimize(items: BudgetItem[], budgetTokens: number): BudgetResult;
}

export interface ProviderAdapter {
	readonly kind: string;
	render(ir: PromptIR): RenderedPrompt;
}

export interface TelemetryEvent {
	requestId: string;
	provider?: string;
	model?: string;
	latencyMs?: number;
	promptBuildMs?: number;
	retrievalMs?: number;
	compilationMs?: number;
	renderingMs?: number;
	inputTokens?: number;
	outputTokens?: number;
	freshInputTokens?: number;
	cachedInputTokens?: number;
	promptSize?: number;
	contextSize?: number;
	compressionRatio?: number;
	retrievedFiles?: number;
	retrievedSymbols?: number;
	cacheHits?: number;
	cacheMisses?: number;
	estimatedCost?: number;
	actualCost?: number;
	irHash?: string;
	timestamp: number;
}

export interface TelemetryRecorder {
	record(event: TelemetryEvent): void;
	list(limit?: number): TelemetryEvent[];
	clear(): void;
}

export interface RouteMetadata {
	intent: string;
	estimatedTokens: number;
	requiresTools: boolean;
	hasImages: boolean;
	complexity: 'low' | 'medium' | 'high';
	irHash: string;
	blockCount: number;
}

export interface RouterIntegration {
	prepare(ir: PromptIR): RouteMetadata;
}
