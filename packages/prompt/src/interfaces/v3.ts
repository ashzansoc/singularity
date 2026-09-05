/**
 * Prompt Engine v3 — DI contracts for intelligence, learning, and multi-stage compile.
 */

import type { GraphNode, NodeKind } from '../graph/types.js';
import type { PromptIR, PromptIRGraph, PromptFingerprint } from '../ir/types.js';

/** Structural graph access (avoids circular import with interfaces/index). */
export interface IntelligenceGraph {
	getNode(id: string): GraphNode | undefined;
	listNodes(kind?: NodeKind): GraphNode[];
	materialize(nodeId: string): string;
}

export interface IntelligenceEmbedder {
	embed(text: string): Promise<number[]> | number[];
	readonly dimensions: number;
}

export interface IntelligenceRetrievalHit {
	nodeId: string;
	score: number;
	reason: string;
}

export interface ContextQualityScore {
	relevance: number;
	confidence: number;
	freshness: number;
	recency: number;
	importance: number;
	retrievalScore: number;
	historicalUsefulness: number;
	estimatedTokenCost: number;
	finalScore: number;
}

export interface ScoredContextCandidate {
	nodeId: string;
	node: GraphNode;
	text: string;
	tokenCount: number;
	score: ContextQualityScore;
	required: boolean;
	dependencies: string[];
	retrievalHit?: IntelligenceRetrievalHit;
}

export interface ContextIntelligenceInput {
	prompt: string;
	intent: string;
	languageId?: string;
	repoSize?: 'small' | 'large';
	candidates: GraphNode[];
	retrievalHits: IntelligenceRetrievalHit[];
	queryEmbedding: number[];
	graph: IntelligenceGraph;
	requiredNodeIds?: string[];
}

export interface ContextIntelligenceResult {
	scored: ScoredContextCandidate[];
	predictedMissing: string[];
	redundantIds: string[];
	estimatedRegenerationProbability: number;
	estimatedAnswerConfidence: number;
	recommendedBudget: number;
}

export interface ContextIntelligenceLayer {
	analyze(input: ContextIntelligenceInput): ContextIntelligenceResult | Promise<ContextIntelligenceResult>;
}

export interface KnapsackCandidate {
	id: string;
	value: number;
	weight: number;
	required?: boolean;
	dependencies?: string[];
	text: string;
	meta?: Record<string, unknown>;
}

export interface KnapsackResult {
	selected: KnapsackCandidate[];
	dropped: string[];
	totalValue: number;
	totalWeight: number;
	budget: number;
}

export interface KnapsackBudgetOptimizer {
	optimize(candidates: KnapsackCandidate[], budget: number): KnapsackResult;
}

export type TaskBudgetKind =
	| 'autocomplete'
	| 'edit'
	| 'refactor'
	| 'architecture'
	| 'debug'
	| 'plan'
	| 'general';

export interface AdaptiveBudgetKey {
	task: TaskBudgetKind;
	language?: string;
	repoSize?: 'small' | 'large';
}

export type OutcomeSignal =
	| 'accepted'
	| 'regenerated'
	| 'edited'
	| 'cancelled'
	| 'failed'
	| 'tool_retry'
	| 'tool_failure'
	| 'success';

export interface AdaptiveBudgetLearner {
	recommend(key: AdaptiveBudgetKey): number;
	observe(key: AdaptiveBudgetKey, usedTokens: number, outcome: OutcomeSignal): void;
}

export interface GraphDiff {
	added: string[];
	removed: string[];
	changed: string[];
	unchanged: string[];
	affectedSubtree: string[];
}

export interface GraphDiffEngine {
	diff(prev: { nodes: GraphNode[] }, next: { nodes: GraphNode[] }): GraphDiff;
}

export interface PromptSnapshot {
	id: string;
	fingerprint: PromptFingerprint;
	ir: PromptIR;
	retrievedNodeIds: string[];
	memoryNodeIds: string[];
	selectedFiles: string[];
	conversationSummary?: string;
	model?: string;
	qualityScore: number;
	embedding: number[];
	createdAt: number;
	hits: number;
}

export interface SnapshotStore {
	store(snapshot: PromptSnapshot): void;
	findSimilar(embedding: number[], threshold?: number): PromptSnapshot | undefined;
	get(id: string): PromptSnapshot | undefined;
}

export interface LearningEvent {
	requestId: string;
	promptFingerprint: string;
	irHash: string;
	retrievedNodeIds: string[];
	memoryNodeIds: string[];
	model?: string;
	provider?: string;
	intent: string;
	languageId?: string;
	inputTokens: number;
	outputTokens?: number;
	latencyMs?: number;
	cost?: number;
	outcome: OutcomeSignal;
	userFeedback?: number;
	timestamp: number;
}

export interface NodeUsefulnessStats {
	nodeId: string;
	shown: number;
	accepted: number;
	ignored: number;
	regeneratedMissing: number;
	usefulness: number;
}

export interface LearningEngine {
	record(event: LearningEvent): void;
	nodeUsefulness(nodeId: string): number;
	layoutPreference(intent: string): number;
	preferredModel(intent: string): string | undefined;
	observeMissingNodes(nodeIds: string[]): void;
	observeIgnoredNodes(nodeIds: string[]): void;
	stats(): { events: number; nodesTracked: number };
}

export interface MultiStageCompileInput {
	sessionId: string;
	intent: string;
	systemPrompt: string;
	userPrompt: string;
	intelligence: ContextIntelligenceResult;
	graph: IntelligenceGraph;
	budgetTokens: number;
	priorIr?: PromptIR;
	embedder: IntelligenceEmbedder;
	fingerprintExtras?: {
		repoHash?: string;
		conversationHash?: string;
		memoryHash?: string;
		gitHash?: string;
	};
}

export interface MultiStageCompileResult {
	ir: PromptIR;
	graphIr: PromptIRGraph;
	fingerprint: PromptFingerprint;
	stageTimingsMs: Record<string, number>;
	selectedNodeIds: string[];
	droppedNodeIds: string[];
	averageQuality: number;
}

export interface MultiStagePromptCompiler {
	compile(input: MultiStageCompileInput): Promise<MultiStageCompileResult> | MultiStageCompileResult;
}

/** Prompt Simulation Layer — evaluate Prompt IR before cache / provider. */
export type SimulationSeverity = 'info' | 'warning' | 'error';

export interface SimulationIssue {
	code: string;
	severity: SimulationSeverity;
	message: string;
	blockId?: string;
}

export interface SimulationReport {
	passed: boolean;
	/** True when IR was mutated to fix issues. */
	repaired: boolean;
	ir: PromptIR;
	issues: SimulationIssue[];
	predictedSuccess: number;
	predictedRegeneration: number;
	estimatedRenderTokens: number;
	dryRunMessageCount: number;
	simulationMs: number;
}

export interface PromptSimulateInput {
	ir: PromptIR;
	provider: string;
	userPrompt: string;
	budgetTokens: number;
	estimatedAnswerConfidence?: number;
	estimatedRegenerationProbability?: number;
}

export interface PromptSimulator {
	simulate(input: PromptSimulateInput): SimulationReport;
}
