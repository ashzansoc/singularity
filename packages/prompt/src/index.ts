/**
 * @singularity/prompt — Prompt Engine v3
 * Graph → Intelligence → Multi-stage Compiler → Prompt IR → Learning loop
 */

export {
	hashContent,
	estimateTokens,
	hashObject,
	sha256,
	sha256Object,
} from './hash.js';

export type {
	PromptIntent,
	ConversationRole,
	ConversationTurn,
	FileContextSlice,
	SelectionContext,
	RepositoryContext,
	RetrievalHit as LegacyRetrievalHit,
	DiagnosticItem,
	TerminalSnippet,
	MemoryItem,
	AgentState,
	UserPreferences,
	CanonicalContext,
	SegmentId,
} from './types.js';

export {
	ALL_SEGMENT_IDS,
	createEmptyCanonicalContext,
	materializeSegmentText,
	segmentTokenCount,
	contextContentHash,
} from './types.js';

export type {
	FileSnapshot,
	IncrementalBuilderState,
	BuilderUpdate,
} from './builder/incremental.js';

export {
	createIncrementalBuilder,
	applyBuilderUpdate,
	isFileDirty,
	listDirtyUris,
	clearDirtyFlags,
} from './builder/incremental.js';

export type {
	ContextSegment,
	SegmentedContextState,
} from './segments/segment.js';

export {
	createSegmentedContext,
	updateSegmentsFromContext,
	dirtySegmentIds,
	segmentContents,
} from './segments/segment.js';

export type {
	PromptBlockRole,
	PromptBlock,
	PromptIR,
	PromptIRGraph,
	PromptFingerprint,
	ContextBlockFingerprint,
	BudgetAllocationReport,
	RenderedMessage,
	RenderedPrompt,
} from './ir/types.js';

export type { CompileOptions, CompileResult } from './compiler/compiler.js';
export { compilePrompt } from './compiler/compiler.js';
export { GraphPromptCompiler } from './compiler/graphCompiler.js';

export type { IrCacheEntry, IrCacheOptions, PromptIrCacheOptions } from './cache/irCache.js';
export { LocalPromptIrCache, DurablePromptCache } from './cache/irCache.js';

export type { ProviderKind } from './adapters/types.js';
export { normalizeProviderKind } from './adapters/types.js';
export {
	renderClaude,
	renderGpt,
	renderGemini,
	renderQwen,
	renderLocal,
	renderOpenRouter,
	renderOllama,
	renderVllm,
	renderLmStudio,
	renderForProvider,
	RegistryProviderAdapter,
} from './adapters/registry.js';

export type { ProviderCacheHints } from './providerCache/hints.js';
export { buildProviderCacheHints } from './providerCache/hints.js';

export type { CompressionResult, CompressionOptions } from './compression/semantic.js';
export {
	compressConversation,
	applyCompressionToConversation,
} from './compression/semantic.js';

export {
	segmentsForIntent,
	isSegmentAllowed,
	normalizePromptIntent,
} from './routing/packs.js';
export { DefaultRouterIntegration } from './routing/routerIntegration.js';

export type { BudgetItem, BudgetResult, BudgetOptions } from './budget/optimizer.js';
export {
	BUDGET_PRIORITY,
	BUDGET_PRIORITY_V2,
	optimizeBudget,
	DefaultBudgetOptimizer,
} from './budget/optimizer.js';

export type {
	PromptPipelineOptions,
	PromptPipelineState,
	PipelineResult,
} from './pipeline.js';
export { createPromptPipeline, runPromptPipeline } from './pipeline.js';

export type {
	NodeKind,
	EdgeKind,
	MemoryScope,
	GraphNode,
	GraphEdge,
	MemoryNode,
} from './graph/types.js';
export { IR_VERSION } from './graph/types.js';
export { InMemoryContextGraph } from './graph/contextGraph.js';

export { DefaultHashEmbedder, cosineSimilarity } from './embed/hashEmbedder.js';
export {
	TypeScriptExtractor,
	PythonExtractor,
	defaultExtractors,
	pickExtractor,
} from './indexer/extractors.js';
export { DefaultIncrementalIndexer } from './indexer/incrementalIndexer.js';
export { InMemoryMemoryManager } from './memory/memoryManager.js';
export { SemanticRetrievalEngine, materializeSymbolSnippet } from './retrieval/semanticRetrieval.js';
export { DefaultContextVM } from './vm/contextVm.js';
export { DefaultDeltaEngine } from './delta/deltaEngine.js';
export { DefaultConversationEngine, buildStructuredConversationPackage } from './conversation/conversationEngine.js';
export { InMemoryTelemetryRecorder } from './telemetry/recorder.js';

export type * from './interfaces/index.js';
export type * from './interfaces/v3.js';

export { scoreContextNode } from './intelligence/qualityScorer.js';
export {
	DefaultContextIntelligenceLayer,
	mergePredictedCandidates,
	intentToTask,
	defaultBudget,
} from './intelligence/contextIntelligence.js';
export { WeightedKnapsackBudgetOptimizer } from './budget/knapsack.js';
export { DefaultAdaptiveBudgetLearner } from './budget/adaptiveBudgets.js';
export { DefaultLearningEngine } from './learning/learningEngine.js';
export {
	InMemorySnapshotStore,
	buildPromptFingerprint,
	snapshotIdFromFingerprint,
} from './learning/snapshots.js';
export { DefaultGraphDiffEngine } from './graph/graphDiff.js';
export { MultiStagePromptCompilerImpl } from './compiler/multiStageCompiler.js';
export { DefaultPromptSimulator } from './simulation/promptSimulator.js';

export {
	TreeSitterTypeScriptExtractor,
	TreeSitterPythonExtractor,
	treeSitterExtractors,
	structuralExtractTypeScript,
	structuralExtractPython,
	initTreeSitter,
	ensureTreeSitterReady,
	isTreeSitterReady,
	setTreeSitterParsers,
	setAllowFallback,
	getAllowFallback,
	getTreeSitterInitError,
} from './indexer/treeSitterExtractor.js';
export type {
	ExtractorBackend,
	TreeSitterInitOptions,
} from './indexer/treeSitterExtractor.js';
export { DurableRepoMap } from './repo/durableRepoMap.js';
export { renderRepoMapSummary } from './repo/repoMapSummary.js';
export { WorkingMemory, ProjectMemoryStore } from './memory/workingMemory.js';
export type { WorkingMemoryState, ProjectMemoryEntry } from './memory/workingMemory.js';
export {
	buildEconomyReport,
	formatEconomyMarkdown,
} from './economy/report.js';
export type { ContextEconomyReport } from './economy/report.js';
export { priorityBand, buildAllocationReport } from './budget/optimizer.js';

export type {
	PromptEngineConfig,
	PromptEngineRequest,
	PromptEngineResult,
	PromptEngineDebugSnapshot,
} from './engine.js';
export { PromptEngine, createPromptEngine } from './engine.js';
