/**
 * Prompt Engine v3 — adaptive, self-learning composition root.
 * Pipeline: index → retrieve → intelligence → multi-stage compile →
 *           simulate → cache/snapshot → render → telemetry → learning
 */

import { renderForProvider } from './adapters/registry.js';
import { normalizeProviderKind } from './adapters/types.js';
import { DefaultAdaptiveBudgetLearner, intentToTask } from './budget/adaptiveBudgets.js';
import { DurablePromptCache } from './cache/irCache.js';
import { MultiStagePromptCompilerImpl } from './compiler/multiStageCompiler.js';
import { DefaultConversationEngine } from './conversation/conversationEngine.js';
import { DefaultDeltaEngine } from './delta/deltaEngine.js';
import { DefaultHashEmbedder } from './embed/hashEmbedder.js';
import { DefaultGraphDiffEngine } from './graph/graphDiff.js';
import { InMemoryContextGraph } from './graph/contextGraph.js';
import { IR_VERSION } from './graph/types.js';
import { sha256 } from './hash.js';
import { DefaultIncrementalIndexer } from './indexer/incrementalIndexer.js';
import {
	DefaultContextIntelligenceLayer,
	mergePredictedCandidates,
} from './intelligence/contextIntelligence.js';
import type {
	ConversationTurnInput,
	Embedder,
	FileChangeEvent,
	PromptCache,
	RetrievalQuery,
	TelemetryEvent,
	RouteMetadata,
} from './interfaces/index.js';
import type {
	LearningEngine,
	OutcomeSignal,
	PromptSnapshot,
	SimulationReport,
} from './interfaces/v3.js';
import type { PromptIR, PromptFingerprint, RenderedPrompt } from './ir/types.js';
import { DefaultLearningEngine } from './learning/learningEngine.js';
import {
	InMemorySnapshotStore,
	snapshotIdFromFingerprint,
} from './learning/snapshots.js';
import { InMemoryMemoryManager } from './memory/memoryManager.js';
import { DefaultRouterIntegration } from './routing/routerIntegration.js';
import { SemanticRetrievalEngine } from './retrieval/semanticRetrieval.js';
import { DefaultPromptSimulator } from './simulation/promptSimulator.js';
import { InMemoryTelemetryRecorder } from './telemetry/recorder.js';
import { normalizePromptIntent } from './routing/packs.js';
import { DefaultContextVM } from './vm/contextVm.js';
import { DurableRepoMap } from './repo/durableRepoMap.js';
import { WorkingMemory, ProjectMemoryStore } from './memory/workingMemory.js';

export interface PromptEngineConfig {
	workspaceId?: string;
	durableDir?: string;
	budgetTokens?: number;
	embedder?: Embedder;
	promptCache?: PromptCache;
	learning?: LearningEngine;
}

export interface PromptEngineRequest {
	sessionId: string;
	prompt: string;
	systemPrompt?: string;
	intent?: string;
	provider?: string;
	model?: string;
	languageId?: string;
	conversation?: ConversationTurnInput[];
	retrieval?: Omit<RetrievalQuery, 'prompt'>;
	files?: FileChangeEvent[];
	budgetTokens?: number;
}

export interface PromptEngineResult {
	ir: PromptIR;
	rendered: RenderedPrompt;
	route: RouteMetadata;
	fromCache: boolean;
	fromSnapshot: boolean;
	fingerprint?: PromptFingerprint;
	reusedBlockIds: string[];
	rebuiltBlockIds: string[];
	retrievedCount: number;
	averageQuality?: number;
	recommendedBudget: number;
	simulation?: SimulationReport;
	telemetry: TelemetryEvent;
	debug: PromptEngineDebugSnapshot;
}

export interface PromptEngineDebugSnapshot {
	repoHash: string;
	memoryHash: string;
	retrieved: Array<{ nodeId: string; score: number; reason: string }>;
	workingSetNodeIds: string[];
	scoredCandidates: number;
	redundantIds: string[];
	ir: PromptIR;
	rendered: RenderedPrompt;
	route: RouteMetadata;
	cacheStats: { hits: number; misses: number; size: number };
	learningStats: { events: number; nodesTracked: number };
	stageTimingsMs?: Record<string, number>;
	estimatedAnswerConfidence?: number;
	estimatedRegenerationProbability?: number;
	simulation?: SimulationReport;
}

export class PromptEngine {
	readonly graph: InMemoryContextGraph;
	readonly memory: InMemoryMemoryManager;
	readonly indexer: DefaultIncrementalIndexer;
	readonly retrieval: SemanticRetrievalEngine;
	readonly vm: DefaultContextVM;
	readonly delta: DefaultDeltaEngine;
	readonly conversation: DefaultConversationEngine;
	readonly cache: PromptCache;
	readonly telemetry: InMemoryTelemetryRecorder;
	readonly routerIntegration: DefaultRouterIntegration;
	readonly learning: LearningEngine;
	readonly budgets: DefaultAdaptiveBudgetLearner;
	readonly intelligence: DefaultContextIntelligenceLayer;
	readonly multiStage: MultiStagePromptCompilerImpl;
	readonly snapshots: InMemorySnapshotStore;
	readonly graphDiff: DefaultGraphDiffEngine;
	readonly simulator: DefaultPromptSimulator;
	readonly embedder: Embedder;
	readonly workspaceId: string;
	readonly budgetTokens: number;
	readonly repoMap: DurableRepoMap;
	readonly workingMemory: WorkingMemory;
	readonly projectMemory: ProjectMemoryStore;

	private lastIr = new Map<string, PromptIR>();
	private lastGraphSnap = new Map<string, ReturnType<InMemoryContextGraph['snapshot']>>();
	private lastDebug?: PromptEngineDebugSnapshot;
	private lastSelectedNodes = new Map<string, string[]>();

	constructor(config: PromptEngineConfig = {}) {
		this.workspaceId = config.workspaceId ?? 'default';
		this.budgetTokens = config.budgetTokens ?? 12_000;
		this.embedder = config.embedder ?? new DefaultHashEmbedder();
		this.graph = new InMemoryContextGraph();
		this.memory = new InMemoryMemoryManager();
		this.indexer = new DefaultIncrementalIndexer({
			graph: this.graph,
			embedder: this.embedder,
			repositoryId: `repo:${this.workspaceId}`,
		});
		this.retrieval = new SemanticRetrievalEngine({
			graph: this.graph,
			memory: this.memory,
			embedder: this.embedder,
			symbolFirst: true,
		});
		this.vm = new DefaultContextVM();
		this.delta = new DefaultDeltaEngine();
		this.conversation = new DefaultConversationEngine();
		this.cache =
			config.promptCache ??
			new DurablePromptCache({
				durableDir: config.durableDir,
				workspaceId: this.workspaceId,
			});
		this.telemetry = new InMemoryTelemetryRecorder({
			durableDir: config.durableDir,
			workspaceId: this.workspaceId,
		});
		this.routerIntegration = new DefaultRouterIntegration();
		this.learning = config.learning ?? new DefaultLearningEngine();
		this.budgets = new DefaultAdaptiveBudgetLearner();
		this.intelligence = new DefaultContextIntelligenceLayer(this.learning, this.budgets);
		this.multiStage = new MultiStagePromptCompilerImpl();
		this.snapshots = new InMemorySnapshotStore();
		this.graphDiff = new DefaultGraphDiffEngine();
		this.simulator = new DefaultPromptSimulator();
		this.repoMap = new DurableRepoMap({
			workspaceId: this.workspaceId,
			dir: config.durableDir,
			graph: this.graph,
		});
		this.workingMemory = new WorkingMemory('default');
		this.projectMemory = new ProjectMemoryStore();
	}

	async indexFiles(files: FileChangeEvent[]): Promise<void> {
		await this.indexer.ensureReady();
		for (const f of files) {
			await this.indexer.indexFile(f);
			if (f.content) {
				this.repoMap.setFileHash(f.uri, sha256(f.content));
			}
		}
		this.repoMap.resolveImportEdges();
		this.repoMap.upsertSummaryNode(3_000);
		this.repoMap.persist();
	}

	getLastDebug(): PromptEngineDebugSnapshot | undefined {
		return this.lastDebug;
	}

	/** Feedback loop — call after user accepts / regenerates / etc. */
	recordOutcome(
		requestId: string,
		outcome: OutcomeSignal,
		extras?: { userFeedback?: number; outputTokens?: number },
	): void {
		const tel = this.telemetry.list(20).find((e) => e.requestId === requestId);
		const selected = this.lastSelectedNodes.get(requestId) ?? [];
		this.learning.record({
			requestId,
			promptFingerprint: tel?.irHash ?? requestId,
			irHash: tel?.irHash ?? '',
			retrievedNodeIds: selected,
			memoryNodeIds: selected.filter((id) => id.startsWith('memory:') || this.graph.getNode(id)?.kind === 'memory'),
			model: tel?.model,
			provider: tel?.provider,
			intent: 'GENERAL',
			inputTokens: tel?.inputTokens ?? 0,
			outputTokens: extras?.outputTokens,
			latencyMs: tel?.latencyMs,
			cost: tel?.estimatedCost,
			outcome,
			userFeedback: extras?.userFeedback,
			timestamp: Date.now(),
		});
		if (outcome === 'regenerated') {
			this.learning.observeMissingNodes(selected.slice(0, 3));
		}
		if (outcome === 'accepted' || outcome === 'success') {
			this.budgets.observe(
				{ task: 'general' },
				tel?.inputTokens ?? this.budgetTokens,
				outcome,
			);
		}
	}

	async run(req: PromptEngineRequest): Promise<PromptEngineResult> {
		const started = Date.now();
		const requestId = `pe-${started}-${Math.random().toString(36).slice(2, 8)}`;
		const intent = normalizePromptIntent(req.intent);
		const task = intentToTask(intent);

		const tIndex = Date.now();
		if (req.files?.length) {
			await this.indexFiles(req.files);
		}
		const promptBuildMs = Date.now() - tIndex;

		this.workingMemory.update({
			currentTask: req.prompt.slice(0, 240),
			...(req.files?.length
				? { currentFiles: req.files.map((f) => f.uri).slice(0, 16) }
				: {}),
			currentErrors: (req.retrieval?.diagnostics ?? []).map(
				(d) => `${d.uri}: ${d.message}`,
			),
			currentDiff: req.retrieval?.gitDiff?.slice(0, 4_000),
		});
		const wm = this.workingMemory.toMemoryNode();
		const prevWm = this.memory.get(wm.id);
		if (!prevWm || prevWm.hash !== wm.hash) {
			this.memory.upsert(wm);
		}
		for (const n of this.projectMemory.toMemoryNodes()) {
			this.memory.upsert(n);
			this.graph.upsertNode(n);
		}
		// Repo map summary is stable unless files changed
		if (req.files?.length || !this.graph.getNode(`repository:map:${this.workspaceId}`)) {
			this.repoMap.upsertSummaryNode(3_000);
		}

		if (req.conversation?.length) {
			const state = this.conversation.ingest(req.conversation);
			for (const n of this.conversation.toNodes(state)) {
				this.graph.upsertNode(n);
			}
		}

		this.graph.upsertNode(
			InMemoryContextGraph.makeNode({
				id: 'system:prompt',
				kind: 'system',
				label: 'system',
				content: req.systemPrompt ?? '',
			}),
		);
		this.graph.upsertNode(
			InMemoryContextGraph.makeNode({
				id: 'user:prompt',
				kind: 'userPrompt',
				label: 'user',
				content: req.prompt,
			}),
		);
		if (req.retrieval?.selectionText) {
			this.graph.upsertNode(
				InMemoryContextGraph.makeNode({
					id: `selection:${sha256(req.retrieval.selectionText).slice(0, 12)}`,
					kind: 'selection',
					label: 'selection',
					content: req.retrieval.selectionText,
					meta: { uri: req.retrieval.selectionUri },
				}),
			);
		}

		const snap = this.graph.snapshot();
		const prevSnap = this.lastGraphSnap.get(req.sessionId);
		const diff = prevSnap
			? this.graphDiff.diff(prevSnap, snap)
			: { added: snap.nodes.map((n) => n.id), removed: [], changed: [], unchanged: [], affectedSubtree: snap.nodes.map((n) => n.id) };
		this.lastGraphSnap.set(req.sessionId, snap);

		const tRet = Date.now();
		const retrieved = await this.retrieval.retrieve({
			prompt: req.prompt,
			...req.retrieval,
		});
		const retrievalMs = Date.now() - tRet;

		const queryEmbedding = await Promise.resolve(
			this.embedder.embed(
				[req.prompt, req.retrieval?.selectionText ?? '', intent].join('\n'),
			),
		);

		const candidateIds = new Set([
			...retrieved.map((r) => r.nodeId),
			'system:prompt',
			'user:prompt',
			...this.graph.listNodes('selection').map((n) => n.id),
			...diff.affectedSubtree.slice(0, 40),
		]);
		const candidates = [...candidateIds]
			.map((id) => this.graph.getNode(id))
			.filter((n): n is NonNullable<typeof n> => !!n);

		const repoSize =
			this.graph.listNodes('file').length > 80 ? 'large' : 'small';

		let intelligence = this.intelligence.analyze({
			prompt: req.prompt,
			intent,
			languageId: req.languageId ?? req.files?.[0]?.languageId,
			repoSize,
			candidates,
			retrievalHits: retrieved,
			queryEmbedding,
			graph: this.graph,
			requiredNodeIds: ['system:prompt', 'user:prompt'],
		});
		intelligence = mergePredictedCandidates(
			intelligence,
			this.graph,
			queryEmbedding,
			this.learning,
		);

		const recommendedBudget =
			req.budgetTokens ??
			intelligence.recommendedBudget ??
			this.budgets.recommend({
				task,
				language: req.languageId,
				repoSize,
			});

		const repoHash = this.graph.repoHash();
		const conversationHash = sha256(
			(req.conversation ?? []).map((t) => t.content).join('\n'),
		);
		const memoryHash = this.memory.memoryHash();
		const selectionHash = sha256(req.retrieval?.selectionText ?? '');
		const diagnosticsHash = sha256(JSON.stringify(req.retrieval?.diagnostics ?? []));
		const gitHash = sha256(req.retrieval?.gitDiff ?? '');

		const cacheKey = this.cache.buildKey({
			repoHash,
			conversationHash,
			memoryHash,
			selectionHash,
			diagnosticsHash,
			gitHash,
			irVersion: IR_VERSION,
		});

		let fromCache = false;
		let fromSnapshot = false;
		let ir: PromptIR | undefined = this.cache.get(cacheKey);
		let reusedBlockIds: string[] = [];
		let rebuiltBlockIds: string[] = [];
		let stageTimingsMs: Record<string, number> | undefined;
		let averageQuality: number | undefined;
		let fingerprint = ir?.fingerprint;
		let simulation: SimulationReport | undefined;
		const providerKind = normalizeProviderKind(req.provider);

		const runSimulation = (candidate: PromptIR): SimulationReport =>
			this.simulator.simulate({
				ir: candidate,
				provider: providerKind,
				userPrompt: req.prompt,
				budgetTokens: recommendedBudget,
				estimatedAnswerConfidence: intelligence.estimatedAnswerConfidence,
				estimatedRegenerationProbability: intelligence.estimatedRegenerationProbability,
			});

		const tCompile = Date.now();
		if (ir) {
			simulation = runSimulation(ir);
			if (simulation.passed) {
				fromCache = true;
				ir = simulation.ir;
				fingerprint = ir.fingerprint;
				reusedBlockIds = ir.blocks.map((b) => b.id);
			} else {
				ir = undefined;
				fingerprint = undefined;
			}
		}

		if (!ir) {
			const snapHit = this.snapshots.findSimilar(queryEmbedding, 0.94);
			if (
				snapHit &&
				snapHit.fingerprint.intent === intent &&
				snapHit.fingerprint.repositoryVersion === repoHash
			) {
				simulation = runSimulation(snapHit.ir);
				if (simulation.passed) {
					ir = simulation.ir;
					fingerprint = snapHit.fingerprint;
					fromSnapshot = true;
					reusedBlockIds = ir.blocks.map((b) => b.id);
				}
			}
		}

		if (!ir) {
			const compiled = await this.multiStage.compile({
				sessionId: req.sessionId,
				intent,
				systemPrompt: req.systemPrompt ?? '',
				userPrompt: req.prompt,
				intelligence,
				graph: this.graph,
				budgetTokens: recommendedBudget,
				priorIr: this.lastIr.get(req.sessionId),
				embedder: this.embedder,
				fingerprintExtras: {
					repoHash,
					conversationHash,
					memoryHash,
					gitHash,
				},
			});
			const delta = this.delta.apply(this.lastIr.get(req.sessionId), compiled.ir);
			let nextIr = delta.ir;
			nextIr.fingerprint = compiled.fingerprint;

			// Prompt IR → Prompt Simulator → Prompt Cache
			simulation = runSimulation(nextIr);
			nextIr = simulation.ir;
			fingerprint = nextIr.fingerprint ?? compiled.fingerprint;
			nextIr.fingerprint = fingerprint;

			ir = nextIr;
			reusedBlockIds = delta.reusedBlockIds;
			rebuiltBlockIds = delta.rebuiltBlockIds;
			stageTimingsMs = {
				...compiled.stageTimingsMs,
				simulation: simulation.simulationMs,
			};
			averageQuality = compiled.averageQuality;

			if (simulation.passed) {
				this.cache.set(cacheKey, ir);
				const snapshot: PromptSnapshot = {
					id: snapshotIdFromFingerprint(fingerprint),
					fingerprint,
					ir,
					retrievedNodeIds: compiled.selectedNodeIds,
					memoryNodeIds: compiled.selectedNodeIds.filter(
						(id) => this.graph.getNode(id)?.kind === 'memory',
					),
					selectedFiles: compiled.selectedNodeIds.filter((id) =>
						id.startsWith('file:'),
					),
					model: req.model,
					qualityScore: compiled.averageQuality,
					embedding: fingerprint.embedding,
					createdAt: Date.now(),
					hits: 0,
				};
				this.snapshots.store(snapshot);
			}
			this.lastSelectedNodes.set(requestId, compiled.selectedNodeIds);
		} else {
			averageQuality = ir.averageQuality;
			stageTimingsMs = {
				...(ir.metadata?.stageTimingsMs ?? {}),
				simulation: simulation?.simulationMs ?? 0,
			};
			this.lastSelectedNodes.set(
				requestId,
				ir.blocks.flatMap((b) => b.nodeIds),
			);
		}
		const compilationMs = Date.now() - tCompile;

		this.lastIr.set(req.sessionId, ir);

		const tRender = Date.now();
		const rendered = renderForProvider(ir, providerKind);
		const renderingMs = Date.now() - tRender;

		const route = this.routerIntegration.prepare(ir);
		const cacheStats = this.cache.stats();

		const telemetry: TelemetryEvent = {
			requestId,
			provider: providerKind,
			model: req.model,
			latencyMs: Date.now() - started,
			promptBuildMs,
			retrievalMs,
			compilationMs,
			renderingMs,
			inputTokens: ir.totalTokens,
			freshInputTokens: fromCache || fromSnapshot ? 0 : ir.totalTokens,
			cachedInputTokens: fromCache || fromSnapshot ? ir.totalTokens : 0,
			promptSize: ir.blocks.reduce((n, b) => n + b.text.length, 0),
			contextSize: intelligence.scored.length,
			compressionRatio: intelligence.redundantIds.length / Math.max(1, intelligence.scored.length),
			retrievedFiles: retrieved.filter((h) => h.nodeId.startsWith('file:')).length,
			retrievedSymbols: retrieved.filter((h) =>
				/:(function|class|interface|symbol):/.test(h.nodeId),
			).length,
			cacheHits: cacheStats.hits,
			cacheMisses: cacheStats.misses,
			estimatedCost: (ir.totalTokens / 1_000_000) * 0.15,
			irHash: ir.irHash,
			timestamp: Date.now(),
		};
		this.telemetry.record(telemetry);

		// Optimistic learning signal for this compile (refined via recordOutcome)
		this.learning.record({
			requestId,
			promptFingerprint: fingerprint?.sha256 ?? ir.irHash,
			irHash: ir.irHash,
			retrievedNodeIds: this.lastSelectedNodes.get(requestId) ?? [],
			memoryNodeIds: [],
			model: req.model,
			provider: providerKind,
			intent,
			languageId: req.languageId,
			inputTokens: ir.totalTokens,
			latencyMs: telemetry.latencyMs,
			cost: telemetry.estimatedCost,
			outcome: 'success',
			timestamp: Date.now(),
		});
		this.budgets.observe(
			{ task, language: req.languageId, repoSize },
			ir.totalTokens,
			'success',
		);

		const debug: PromptEngineDebugSnapshot = {
			repoHash,
			memoryHash,
			retrieved,
			workingSetNodeIds: intelligence.scored.map((s) => s.nodeId),
			scoredCandidates: intelligence.scored.length,
			redundantIds: intelligence.redundantIds,
			ir,
			rendered,
			route,
			cacheStats,
			learningStats: this.learning.stats(),
			stageTimingsMs,
			estimatedAnswerConfidence:
				simulation?.predictedSuccess ?? intelligence.estimatedAnswerConfidence,
			estimatedRegenerationProbability:
				simulation?.predictedRegeneration ?? intelligence.estimatedRegenerationProbability,
			simulation,
		};
		this.lastDebug = debug;

		return {
			ir,
			rendered,
			route,
			fromCache,
			fromSnapshot,
			fingerprint,
			reusedBlockIds,
			rebuiltBlockIds,
			retrievedCount: retrieved.length,
			averageQuality,
			recommendedBudget,
			simulation,
			telemetry,
			debug,
		};
	}
}

export function createPromptEngine(config?: PromptEngineConfig): PromptEngine {
	return new PromptEngine(config);
}
