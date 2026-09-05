# Singularity — Context Construction & Retrieval Cluster

Current-state architecture map. Packages covered: `@singularity/context`, `@singularity/prompt`, `@singularity/wiki`, `@singularity/cache`, `@singularity/intelligence`. Every finding cites real source paths. Goal criterion applied throughout: **ONE capability = ONE owner**, where the "Context Engine" owns retrieval → ranking → compression → assembly → token budgeting, and the Brain (knowledge store) owns *what is known*, while Context decides *what is relevant NOW*.

---

## Per-Package Analysis

---

## 1. `@singularity/context` — Context Engine (LangExtract)

**DIR:** `packages/context` · **package.json:** `@singularity/context` v0.1.0, engines `node>=18`, `type: module`.

**PURPOSE (from docs):** Transform selected conversation/document text into durable structured **Project State** (requirements constraints...) that agents retrieve by relevance. Docs explicitly disclaim planning: it "is **not** the planner or coding agent" (`docs/ARCHITECTURE.md`).

### Public API (index.ts)
`readContextEngineFlags`, `isContextEngineActive`, `ContextEngineFlags`, `redactSecrets`, `containsLikelySecret`, `shouldExtract`, `preferSyncExtraction`, `MetricsCollector`, `createEmptyMetrics`, `estimateTokens`, `ContextExtractor`, `ExtractOptions`, `NoopContextExtractor`, `HeuristicContextExtractor`, `heuristicExtract`, `LangExtractContextExtractor`, `LangExtractSidecarClient`, `SidecarConfig`, `mergeDelta`, `applyUserOverride`, `removeItem`, `emptyProjectState`, `MergeStats`, `ProjectStateStore`, `contextDir`, `getRelevantContext`, `estimateFullStateTokens`, `RetrieveOptions`, `formatRelevantContextBlock`, `formatProjectSummary`, `formatVerificationChecklist`, `ContextEngine`, `createContextEngine`, `ContextEngineOptions`, `IngestMessageResult`, `associateRequirementsWithFiles`, `CodeHit`.

### Internal architecture
- **Facade** `src/engine.ts` — `ContextEngine` (extract → merge → store → retrieve). Chooses extractor: `Noop` (disabled) → `Heuristic` (`heuristicOnly`/no LangExtract) → `LangExtractContextExtractor`.
- **Extractors** — `extractor.ts` (interface + Noop), `heuristicExtractor.ts` (regex rules, fallback), `langextractExtractor.ts` (sidecar + fallback), `sidecarClient.ts` (Python stdio JSON-lines client w/ circuit breaker).
- **Merge/conflict** — `merge.ts` (delta apply, supersede, user-override protection).
- **Retrieval** — `retrieval.ts` (relevance-filtered pickScored over ProjectState), `relevance.ts` (trivial-message gate), `format.ts` (prompt-block builders).
- **Store** — `store.ts` (JSON collections under `.singularity/project-context/`).
- **Redaction** — `redact.ts`. **IDs** — `ids.ts`. **Metrics** — `metrics.ts`. **Association** — `fileAssociation.ts`. **Flags** — `flags.ts`.

### State owned
`<workspace>/.singularity/project-context/` — JSON collection files + `versions/v{N}.json` snapshots (`store.ts`)
» requirements/constraints/prohibitions/technologies/decisions/preferences/goals/questions/entities/files/sources.json + meta.json.

### Databases/tables
**None** (explicitly documented: "No database changes, Supabase unchanged"). Pure workspace JSON.

### Storage backends
Filesystem JSON (sync `writeFileSync` per save).

### Relay events
No event-bus emit/consume in package. Consumed by host via direct method calls. Host fires architecture/memory/outcome events in the bridge (`contextEngineBridge.ts` passes to arch/memory planes).

### Model calls
**NOT direct.** LangExtract extraction happens in Python sidecar (`services/langextract-sidecar/main.py`). The Node `sidecarClient.ts` passes provider config down: env `SINGULARITY_CONTEXT_PROVIDER`/`MODEL` (default `gemini-2.0-flash`), temperature, `max_output_tokens`, API key fallback chain. No embeddings of its own — heuristic keyword scoring in `retrieval.ts`.

### Dependencies on other @singularity/*
**None in src.** `packages/wiki/src/redact.ts` imports FROM context (opposite direction).

### Callers / consumers
- `vscode/extensions/singularity-ai/src/contextEngineBridge.ts` — primary host bridge: `createContextEngine`, `ingestMessage`, `getRelevant`, `memoryFacts`→projectMemory sync, `buildRuntimeContextPayload`, `prepareContextForPrompt`.
- `vscode/extensions/singularity-ai/src/langExtractBackgroundAgent.ts` — background scene scheduling.
- `vscode/extensions/singularity-ai/src/intelligenceShell/shellPanel.ts` — `ingestMessage` override broadcast.
- `packages/architecture/src/extraction/adrExtractor.ts`, `heuristic.ts` + `packages/outcome/src/evidence/compress.ts`, `packages/memory/src/extraction/secrets.ts` — reuse `LangExtractSidecarClient` and `redactSecrets`.
- `packages/runtime/test/contextIntegration.test.ts` — `createContextEngine`.

### Sync vs async / hot path
- **Hot path** (chat/agent): LangExtract is *scheduled* in background; bridge returns already-persisted JSON synchronously — "Never await the sidecar on the chat critical path" (bridge comment). `ContextEngine.ingestMessage` is async but called from scheduler.
- `getRelevant` is fully synchronous (tokenize/score/slice in memory).
- Extractor spawn is async; heuristic is effectively instant.

### User-visible features
Project Context webview panel (inspect/override/archive), `singularity.ai.projectContext` / `.context.refresh` / `.context.show`, `getRelevant` task-filtered prompt block. Flagged via `SINGULARITY_CONTEXT_ENGINE` (default **ON** per `flags.ts`; docs/IMPLEMENTATION report contradictoryly claim default OFF).

### Tests
`test/contextEngine.test.ts`, `test/benchmark.test.ts`.

---

## 2. `@singularity/prompt` — Prompt Engine v3

**DIR:** `packages/prompt` · **package.json:** v0.3.0, dependencies `@singularity/cache`, `tree-sitter-wasms`, `web-tree-sitter`.

**PURPOSE:** adaptive, self-learning prompt compilation. Graph→Intelligence→Multi-stage compiler→Prompt IR→learning loop. Docs: "Prompts are compiled artifacts. Context is a graph. The system learns continuously."

### Public API (index.ts) — very large surface.
Hashing (`hashContent`, `estimateTokens`, `sha256Object` ...), Canonical types, Incremental builder, Segments, PromptIR types, compiler (`compilePrompt`, `GraphPromptCompiler`), IR cache (`LocalPromptIrCache`, `DurablePromptCache`), provider adapters (`renderClaude/Gpt/Gemini/Qwen/Local/OpenRouter/Ollama/Vllm/LmStudio/ForProvider`), provider cache hints, compression (`compressConversation`), routing packs, budget optimizer (`BUDGET_PRIORITY`, `BUDGET_PRIORITY_V2`, `optimizeBudget`, `DefaultBudgetOptimizer`, `WeightedKnapsackBudgetOptimizer`, `DefaultAdaptiveBudgetLearner`, `priorityBand`, `buildAllocationReport`), PromptPipeline (`createPromptPipeline`, `runPromptPipeline`), graph types, `InMemoryContextGraph`, `DefaultHashEmbedder`, extractors (`TypeScriptExtractor`, `PythonExtractor`, `defaultExtractors`, TreeSitter variants), `DefaultIncrementalIndexer`, memory (`InMemoryMemoryManager`, `WorkingMemory`, `ProjectMemoryStore`), retrieval (`SemanticRetrievalEngine`), `DefaultContextVM`, `DefaultDeltaEngine`, `DefaultConversationEngine`, telemetry, quality scorer, intelligence (`DefaultContextIntelligenceLayer`, `mergePredictedCandidates`, `intentToTask`, `defaultBudget`), learning, snapshots, graph diff, multi-stage compiler, simulator, `DurableRepoMap`, economy report, and composition root `PromptEngine`/`createPromptEngine`.

### Internal architecture (Level numbering from `semanticRetrieval.ts` etc.)
- **Indexer** — `indexer/index.ts`, `indexer/incrementalIndexer.ts`, `indexer/extractors.ts`, `indexer/treeSitterExtractor.ts` (tree-sitter WASM primary, regex fallback).
- **Graph** — `graph/contextGraph.ts` (in-memory nodes/edges), `graph/graphDiff.ts`, `graph/types.ts`.
- **Memory** — `memory/memoryManager.ts`, `memory/workingMemory.ts` (session vs project).
- **Retrieval** — `retrieval/semanticRetrieval.ts` (symbol-first + lexical + cosine).
- **Intelligence** — `intelligence/contextIntelligence.ts` (ranking, de-dupe, predicted-missing, budgets), `qualityScorer.ts`.
- **Compiler** — `compiler/compiler.ts` (v1 canonical→IR), `compiler/multiStageCompiler.ts` (collect→rank→deps→knapsack→IR graph), `compiler/graphCompiler.ts`.
- **IR** — `ir/types.ts`, `ir/format.ts`? (compiler/ir).
- **Budget** — `budget/optimizer.ts`, `budget/adapt0ptimizer.ts` (`WeightedKnapsack`), `budget/adaptiveBudgets.ts`.
- **Cache** — `cache/irCache.ts` (durable via `@singularity/cache` SqliteStore).
- **Compression** — `compression/semantic.ts` (extractive conversation summarizer).
- **Rendering** — `adapters/registry.ts` (per-provider), `providerCache/hints.ts`.
- **Learning** — `learning/learningEngine.ts`, `learning/snapshots.ts`.
- **Conversation/Delta/VM/Telemetry/RepoMap/Economy/Routing/Simulation** — subdirs.
- **Facade** — `engine.ts` (composes all), `pipeline.ts` (older v2 pipeline).

### State owned
- In-memory hot graph + durable repo map JSON (`DurableRepoMap` at `{durableDir}/singularity-repomap-{hash}.json`).
- Prompt IR cache → `@singularity/cache` SqliteStore (`durableDir/prompt-ir-cache.json`).
- Telemetry → `@singularity/cache` SqliteStore.
- Deterministic hash embeddings only (no remote model).

### Databases / tables
None native. Uses `@singularity/cache` SqliteStore (JSON-file-backed KvStore; logical `response_cache`-style schema; see cache section).

### Storage backends
`@singularity/cache` `SqliteStore` (durable JSON-KV), plus JSON repo-map file, plus in-memory.

### External events
Emits its own `TelemetryEvent` via recorder. Does not gossip between planes. Consumed by router as compiler engine.

### Model calls
**None.** All embedding is `DefaultHashEmbedder` (cosine over hashed text) or ignored. Composition root never calls an LLM. Prompt IR is a *compile-time artifact* assembled before the LLM is invoked elsewhere (router/provider layer).

### Dependencies on other @singularity/*
- `cache/irCache.ts:5` — `import { SqliteStore } from '@singularity/cache'`
- `embed/hashEmbedder.ts:5` — `import { HashEmbedder as CacheHashEmbedder } from '@singularity/cache'`
- `telemetry/recorder.ts:5` — `import { SqliteStore } from '@singularity/cache'`
- `package.json`: `@singularity/cache: file:../cache`, `tree-sitter-wasms`, `web-tree-sitter`.

### Callers / consumers
- `packages/router/src/runtime.ts` — creates `createPromptEngine`, `run` called during `compilePromptMessages`; exposes prompt engine graph/memory/cache. `packages/router/src/index.ts` re-exports prompt API as "Prompt architecture surface for IDE / extension".
- `packages/router/src/contextSegments.ts` — `estimateTokens`, `hashContent`.
- `packages/intelligence/*` — `InMemoryContextGraph`, `DefaultIncrementalIndexer`, `defaultExtractors`, graph node types & nodes.
- `vscode/extensions/singularity-ai/src/extension.ts` — `ai.promptEngine.indexer.ensureReady()`, `.indexFiles`, `.projectMemory.upsert`, `.run`.
- `vscode/extensions/singularity-ai/src/promptDebugPanel.ts` — reads `ai.getPromptDebug()` (PromptEngineDebugSnapshot).
- `vscode/extensions/singularity-ai/src/contextEngineBridge.ts` — `ai.promptEngine.projectMemory.upsert` (context facts → prompt memory).

### Sync vs async / hot path
- **Async heavy**: indexing + `run()` await embedding for each stage; tree-sitter parse.
- `route` prepare + compile are async. Debug snapshot is a sync getter.
- Learning is optimistic/synchronous in-process (in-memory maps, no bus).

### User-visible features
Prompt Debug panel (StageInfo timings, IR, cache stats), token budget/compression readout, context economy report. Debug snapshot surfaces `recommendedBudget`, `simulation`, cache/learning stats.

### Tests
`test/adaptersLearningEtc.test.ts`, `budgetOptimizer.test.ts`, `compilerSimulatorCache.test.ts`, `contextEconomy.test.ts`, `contextGraph.test.ts`, `contextIntelligence.test.ts`, `indexer.test.ts`, `memoryGraph.test.ts`, `pipeline.test.ts`, `treeSitterPrimary.test.ts`, plus `bench/`.

---

## 3. `@singularity/wiki` — LLM Wiki

**DIR:** `packages/wiki` · v0.1.0, dependency `@singularity/context`.

**PURPOSE:** persistent compounding Markdown knowledge base (Karpathy "LLM Wiki" pattern) — raw sources immutable, derivative wiki pages, a schema contract, organic LLM curation, per-query `wikiRoot`.

### Public API (index.ts)
`readWikiEngineFlags`, `isWikiEngineActive`, `WikiEngineFlags`, `redactSecrets`, `slugify`, `todayDate`, `parseFrontmatter`, `stringifyFrontmatter`, `wikiPaths`, `pageRelPath`, `relToWorkspace`, `WikiPaths`, `WikiStore`, `searchPages`, `extractWikilinks`, `tokenize`, `lintWiki`, `queryWiki`, `ingestSource`, `formatWikiContextBlock`, `formatLintReport`, `WIKI_SCHEMA_MD`, `WikiEngine`, `createWikiEngine`, `WikiEngineOptions`.

### Internal architecture
- **Facade** `engine.ts` (init/ingest/query/search/lint/file-answer/index-rebuild/log).
- **Storage** `store.ts` (recursive filesystem: raw/ immutable, pages/, meta.json).
- **Ingest** `ingest.ts` (extract takeaways/entities/concepts, write source+entity/concept pages, bump overview/synthesis).
- **Search** `search.ts` (TF-IDF lexical — no embeddings), `query.ts` (draft answer + citations + confidence gate).
- **Schema** `schema.ts` (the agent contract SCHEMA.md), `lint.ts`, `log.ts`, `indexFile.ts`, `frontmatter.ts`, `paths.ts`, `slug.ts`, `flags.ts`, `redact.ts` (re-export from context).

### State owned
`<workspace>/.singularity/wiki/` (or `SINGULARITY_WIKI_ROOT`): `SCHEMA.md`, `meta.json`, `raw/` (immutable), `raw/assets/`, `wiki/` (index/log/overview/synthesis/contradictions, sources/, entities/, concepts/, queries/). Also writes/patches `AGENTS.md` pointer.

### Databases / tables
None (pure filesystem Markdown + meta.json).

### External events
None. Echoes query/ingest to `log.md` internally.

### Model calls
**None from this package.** Query `draft` is heuristic (splice hits into headings), marked "Agent: synthesize ... refine". Actual LLM synthesis/mem happens in the *agent* (host) that calls wiki operations; no LLM call inside `@singularity/wiki`.

### Dependencies
- `wiki/src/redact.ts` — `export { redactSecrets } from '@singularity/context'`.
- `package.json`: `@singularity/context`.

### Callers / consumers
- `vscode/extensions/singularity-ai/src/wikiBridge.ts` — `createWikiEngine`, `init/query/lint/search/file`, `buildWikiPromptBlock` (system block for agent).
- `vscode/extensions/singularity-ai/src/extension.ts` — `initWiki`/`queryWiki` commands.
- `vscode/extensions/singularity-ai/src/wikiPanel.ts` — webview.
- `vscode/extensions/singularity-ai/src/contextEngineBridge.ts:20` — `buildWikiPromptBlock`.

### Sync vs async / hot path
Mixed sync file I/O. `init/query/lint/search/ingest` are all synchronous. No async boundaries.

### User-visible
Wiki panel, `llm_wiki` operation, `AGENTS.md` pointer, searchable index, schema-driven curation.

### Tests
`test/wikiEngine.test.ts`.

---

## 4. `@singularity/cache` — AI I/O Cache

**DIR:** `packages/cache`, no `@singularity/*` src deps (self-contained).

**PURPOSE:** minimization of LLM latency/token spend by stacking exact (L4), semantic (L3), prefix (L2), routing (L7) cache layers + a thin MemoryHub, all local-first.

### Public API (`index.ts`)
CSCHEMA_VERSION, CACHEABLE_INTENTS, DEFAULT_SEMANTIC_THRESHOLD; `buildResponseCacheKey`, `buildRouteCacheKey`, `fingerprintBucket`, `normalizePrompt`, `sha256`, `shortHash`, `buildContextFingerprint`, `buildBlockFingerprints`, `aggregateBlockFingerprint`, `FingerprintHistoryStore`, `CacheMetrics`, `InvalidationController`, `MemoryStore`, `SqliteStore`, `HashEmbedder`, `InMemoryVectorStore`, `ContextCache`, `PromptPrefixCache`, `SemanticPromptCache`, `ResponseCache`, `RoutingCache`, `createRoutingCacheAdapter`, `InMemoryMemoryHub`, `CacheManager`, `createCacheManager`, plus many type exports.

### Internal architecture
- **Manager** `manager.ts` orchestrates lookup→hits/miss→write-through→invalidate.
- **Layers** `layers/context.ts` (L1 fingerprint), `layers/prompt-prefix.ts` (L2), `layers/semantic.ts` (L3), `layers/response.ts` (L4), `layers/routing.ts` (L7), `layers/fingerprint-history.ts`.
- **Storage** `storage/memory.ts` (LRU hot), `storage/sqlite.ts` (durable KV), `storage/vector.ts` (in-memory cosine + HashEmbedder).
- **Memory** `memory/hub.ts` (namespace KV; distinct from cache).
- **Invalidation** `invalidation.ts` (event→version bump), `keys.ts`, `fingerprint.ts`, `metrics.ts`.

### State owned
- `MemoryStore` LRU (hot, process-lifetime).
- `SqliteStore` durable JSON (if `durableDir`) — `singularity-cache.json` (or `prompt-ir-cache.json` for prompt engine's own `DurablePromptCache`).
- In-memory vector store (L3).

### Databases / tables
Logical SQLite tables in DESIGN.md (`response_cache`, `routing_stats`, `prefix_versions`) — real v1 persists the same logical rows as JSON docs (`storage/sqlite.ts`). No native db.

### Storage backends
Hot LRU memory + durable JSON-file KV. Pluggable vector store.

### External events
`InvalidationController` maps IDE events (`file_save`, `branch_switch`, `provider_change`, `workspace_change`, ...) to version bumps. No cross-plane event bus.

### Model calls
**None for inference.** `Embedder` is injected (`HashEmbedder` default, deterministic non-ML). Real embeddings out-of-scope (DESIGN.md).

### Dependencies on other @singularity/*
None in src. (Adapters mirror router `InMemoryRouteCache` API even though routes are in same repo.) Used *by* prompt + router.

### Callers / consumers
- `packages/router/src/runtime.ts` — `createCacheManager`, `CacheManager`, `CacheRequest`.
- `packages/router/src/engine.ts` (route cache bridge), `types.ts`.
- `packages/prompt/src/cache/irCache.ts` — `SqliteStore`; `packages/prompt/src/telemetry/recorder.ts`; `embed/hashEmbedder.ts` — `HashEmbedder`.
- `packages/architecture/src/memory/vectorStore.ts`, `packages/memory/src/storage/vector.ts` — `HashEmbedder`.
- `vscode/extensions/singularity-ai/src/cacheTelemetry.ts` imports **`@singularity/neural-relay`** (not cache directly) for status-bar cache stats; the actual `@singularity/cache` is consumed by router.
- `packages/router/src/cache.ts` (standalone InMemory route cache is separate from this package).

### Sync vs async / hot path
`lookup`/`writeThrough` mostly sync except `semanticCache.query` (await). Designed for hot request path.

### User-visible features
Cache-status bar (DeepSeek provider-cache vs Neural Relay), configurable `durableDir`, `enableBackgroundRefresh` for stale-serve.

### Tests
Missing four files. `test/fingerprint.test.ts`, `manager.test.ts`, `response-cache.test.ts`, `semantic-cache.test.ts`.

---

## 5. `@singularity/intelligence` — Context Intelligence Layer (daemon + graph + hybrid retrieval)

**DIR:** `packages/intelligence`, deps: `@singularity/prompt`, `@singularity/architecture`, `@singularity/memory`, `@singularity/outcome`, `@hono/node-server`, `hono`.

**PURPOSE:** reusable heavyweight persistent code/graph context store with a local HTTP daemon, priority job queue, staged bootstrap, multi-source symbols (tree-sitter / SCIP / regex), and hybrid (lexical+graph-relation) retrieval to *augment* the prompt engine, not replace compilation.

### Public API (`index.ts`)
`JOB_PRIORITY`, re-exported types, `MemoryGraphStore`, `SqliteGraphStore`, `openGraphStore`, `JobQueue`, `retrieveContext`, `impactForSymbol`, `formatContextBlock`, `parseScipJson`, `ingestScipDump`, `ingestScipFile`, `applyLspRelations`, `IntelligenceEngine`, `pathToUri`, `uriToFs`, `codeImpactFromEngine`, `createIntelligenceApp`, `serveIntelligence`, `createArchitectureReviewPort`, `wireArchitectureGovernance`, `IntelligenceClient`, helpers (`sha256`, `languageFromPath`, etc).

### Internal architecture
- **Engine daemon** `engine.ts` — staged bootstrap (tree/ast/scip/docs/embeddings/architecture), job queue, pump loop, `notifyFileEvent`, `indexPathNow`.
- **Graph stores** — `sqliteGraphStore.ts` (SQLite via node:sqlite, WAL, JSON fallback), `memoryGraphStore.ts` (in-memory BFS/neighbors, findSymbols).
- **Retrieval** — `retriever.ts` (`retrieveContext` hybrid lexical+neighborhood+recency score, `impactForSymbol`, `formatContextBlock`).
- **Importers** — `scip.ts` (SCIP/LSIF), `codeImpact.ts` (architecture adapter).
- **HTTP** — `http.ts` (Hono app: /health, /context, /search, /symbols, /impact, /dependencies, /architecture, /events, /lsp, /bootstrap, /plane/coding-event — peers with architecture/memory/outcome planes), `client.ts` (typed `IntelligenceClient`).
- **Bus plumbing** — `architectureReviewPort.ts` (wire arch governance), `hash.ts`, `queue.ts`, types.ts.

### State owned
`<workspace>/.singularity/intelligence/graph.sqlite` (or `.json` fallback) — the only package with a *real* SQLite graph store.

### Databases / tables (`sqliteGraphStore.ts` SCHEMA)
`nodes` (id,kind,label,content,hash,version,token_count,embedding,dependencies,last_modified,meta), `edges` (id,src,dst,kind,weight), `files` (uri,file_id,content_hash,last_indexed_at,git_commit,branch,language_id,stale), `stages` (name,status,progress,updated_at,detail), `kv` (key,value). WAL mode.

### Storage backends
node:sqlite (WAL); else JSON snapshot. Index built from **prompt**: uses `DefaultIncrementalIndexer` + `InMemoryContextGraph` + `defaultExtractors/pickExtractor` from `@singularity/prompt`.

### External events
**Daemon mounts other planes' routes** (mountArchitectureRoutes/mountMemoryRoutes/mountOutcomeRoutes) and forwards `/plane/coding-event` → architecture/memory/outcome `emit`. Also `createArchitectureReviewPort` bridges arch ↔ outcome. So intelligence is both an instrument exposing an HTTP controller and a relay fan-out.

### Model calls
**None.** All matching is lexical/hash; "embeddings" stage is hash-embedded digits (symbol content), no remote model. Architecture plane does LLM work; intelligence itself never forms an LLM call.

### Dependencies
- `@singularity/prompt` — types, graph,-indexer.
- `@singularity/architecture` — ports, `emptyCodeImpact/mergeCodeImpact`, routes.
- `@singularity/memory` — memory plane routes.
- `@singularity/outcome` — outcome plane routes/ReviewPort types.

### Callers / consumers
- `vscode/extensions/singularity-ai/src/intelligenceWorkerProcess.ts` — hosts `IntelligenceEngine` + expose `IntelligenceClient`.
- `intelligenceBridge.ts`, `intelligenceRemoteEngine.ts`, `architectureBridge.ts`/`outcomeBridge.ts` — `IntelligenceClient`.
- `packages/neural-relay/src/retrieval/intelligenceIndex.ts` documents that the host already has the engine (but does not import it).
- `packages/neural-relay` reads `IntelligenceContextItem` reference type (not package import).
- The `/plane/coding-event`, `/context`, `/impact` endpoints are consumed by arch/mem/outcome planes & engine relays.

### Sync vs async / hot path
- **Bootstrap**: async (yield to event loop, bounded jobs); reads never wait on workers.
- `getContext` is sync query over store (fast read).
- `bumpActiveFile` schedules; no on calls delay.

### User-visible features
Project status + stages, symbol search, impact/dependency analysis, architecture summary, `/plane/coding-event` telemetry.

### Tests
`test/intelligence.test.mjs` (node:test).

---

## DUPLICATES / OVERLAPS ANALYSIS

This is the crux of the mapping exercise.

### Who owns context retrieval + ranking + compression + assembly query?

| Capability | `context` | `prompt` | `intelligence` | `wiki` | Winner/OWNER |
|---|---|---|---|---|
| **Extraction to structured knowledge** | ✓ (`LangExtract`/heuristic — facts) | — | ✓ (symbols/file/edges) | ✓ (pages/entities/concepts) |
| **Relevant retrieval** | Yes — `relevance.ts` gate + `getRelevantContext` (keyword). | Yes — `SemanticRetrievalEngine.retrieve` (graph+lexical). | Yes — `retriever.ts` hybrid graph. | Yes — `searchPages` TF-IDF. | **Three independent implementations** |
| **Ranking** | `pickScored` (lex hits) | `scoreContextNode` + knapsack | `consider` weighted linear | TF-IDF score | **Three rankers** |
| **Compression** | — | `semantic.ts` extractive (conversation) | budget-truncation | excerpt/heading | Prompt only |
| **Assembly to prompt block** | `format.ts` | MultiStage IR blocks + render adapters | `formatContextBlock` | `formatWikiContextBlock` | **Four assemblers** |
| **Token budgeting** | `estimateTokens` + per-category caps | `WeightedKnapsack` + `optimizeBudget` + adaptive budgets | fixed prompt block budget (2000) | none | **Prompt only** |
| **Embedding** | hash | `DefaultHashEmbedder` (no real ML) | hash-embed only | none | None is a real ML embedder |

### The specific overlap facts (real decisions)
- **Context has its own retrieval** (`getRelevantContext`, `retrieval.ts`) — but it only picks from structured ProjectState; it does not pull files/symbols/code. File associations are *passed in* via `fileHints` (code retrieval joins at the *bridge*, e.g. `contextEngineBridge` uses `.getRelevant` and separately slash arch/wiki context).
- **Prompt performs its own retrieval AND ranking AND compression AND budget AND assembly** independent of Context Engine. Its `SemanticRetrievalEngine` + `DefaultContextIntelligenceLayer` + multi-stage compiler are the *most complete* reference implementation of the "Context decides what's relevant NOW" goal.
- **Intelligence also performs its own retrieval, ranking and formatting** (`retrieveContext`) — but only for the *persistent graph* (code symbols), not for project facts. It's a "persistent static index + prompt-block" interrogator used by architecture & impact flows.
- **Wiki performs its own query/draft assembly** (query→draft→file-back) — a separate knowledge lookup that could in principle be a "stored knowledge source" that *Context* queries, but today independently decides relevance & formats its own block.

### "Which owns 'what knowledge is relevant right now'?"
- **Current reality: nobody owns it as a single authority.** Each layer independently decides *and formats* relevant context and each produces its *own* prompt block that the agent composite merges (`engineBridge` concatenates context + arch + wiki knowing nothing about conflict/budget).
- **Goal state (given in this task): Context Engine owns the decision.** The prompt engine currently contains the *most advanced* implementation (ranking-scorer + knapsack + adaptive budgets), but it is *not* wired to be the single owner — `context` and `intelligence` and even `wiki` run parallel.

### Client-side merge point
The true "assembly/decision" today lives in `vscode/extensions/singularity-ai/src/contextEngineBridge.ts` (`buildRuntimeContextPayload`/`prepareContextForPrompt`) + `router/runtime.ts compiler`, which string-concasts architecture+memory+arch+context+wiki into system blocks *after* each plane already produced its own "relevant block".

---

## CLASSIFICATION (KEEP / MERGE / MOVE / REPLACE / DEPRECATE / DELETE / UNKNOWN)

The guiding objective: **ONE capability = ONE owner**; ⇒ "Context Engine" owns *retrieval/ranking/compression/assembly/budget*; Brain keeps knowledge. Given repo as-is:

| Package / Submodule | Classification | Rationale |
|---|---|---|
| `@singularity/context` (whole) | KEEP — but narrow to knowledge intake (extract→merge→store) + *delegate* retrieval to the prompt/context owner. Its `getRelevantContext`+`relevance.ts` +`formatRelevantContextBlock` are a **second owner** of relevant-slice; **MOVE** relevance/budget logic out or make it a thin adapter over the deduplicated owner. Else context becomes the owner itself. |
| `context/src/retrieval.ts` + `relevance.ts` + `format.ts` | **MERGE** into the single retrieval/assembly owner (or delete in favor of prompt's own), or KEEP only as a spine over `Prompt` retrieval. The current kw-retrieval is weak vs prompt's ranked retrieval. |
| `context/src/heuristicExtractor.ts` / `sidecarClient.ts` / `langextractExtractor.ts` | KEEP — this is a _provenance/intake_ capability (Brain write side). Distinct from retrieval. |
| `@singularity/prompt` — `intelligence/`, `retrieval/semanticRetrieval.ts`, `score`+`knapsack`+`adaptiveBudgets`, `multiStageCompiler`, `optimizer` | KEEP — **this is the correct owner of retrieval+ranking+compression+budget+assembly.** Make it the sole authority Context surfaces. |
| `@singularity/prompt` — indexer/graph/`repo/DurableRepoMap` | **MOVE** toward knowledge store (these fill the graph to power retrieval-like graph traversal — more "brain" than "context"). Consider presenting as the Brain's code graph exposed to Context. |
| `@singularity/prompt` — `engine.ts` full plane | KEEP + may absorb / absorb interaction with context states. |
| `@singularity/wiki` — `query.ts`/`search.ts` | **MERGE/REPLACE** — duplicate retrieval/compilation. Wiki should become a **knowledge STORE** (Brain) that the owner queries via one context retrieval; its own answer assembly should retire in favor of Context's assembly. |
| `@singularity/wiki` — `ingest.ts`/`schema.ts`/`lint.ts` | KEEP — document curation (Brain write side), low overlap. |
| `@singularity/cache` — `response/semantic/prefix/context` layers | KEEP — orthogonal capability (reuse computation), not context-relevance decision. It does do L3 semantic prompt-similarity but that is *dedup of provider calls*, not relevance selection for a single task. Keep as cache, not context owner. |
| `@singularity/intelligence` — `retriever.ts` | **DUPLICATE.** Now also does retrieval+compacting (`retrieveContext`, `formatContextBlock`). **MOVE** the *relevance-routing* out to the context owner; intelligence keeps the *index/graph store + impact* (knowledge). `engine.ts` retains indexing/impact; retrieval block formatting belongs to Context. |
| `@singularity/intelligence` — `sqliteGraphStore` / `scip` / `impact` | **KEEP** — the Brain's persistent graph store (ONE owner for stored knowledge). |
| `@singularity/intelligence` — `http.ts` (plane fan-out), `architectureReviewPort`, `codeImpact` | KEEP (daemon/plane coordination; unrelated to context-selection). |
| `router/runtime.ts` / `vscode/.../contextEngineBridge.ts` — merge-concatenation of blocks | **REPLACE** — stop string-concatenating per-plane blocks. Route all "relevantness" through a single owner (Context), which consumes knowledge behind a stable graph+history map. |

### Final owner assignment (goal state)
- **KEEP + strengthen:** `@singularity/context` = the **intake/write surface** (document/project facts) and the **owner of relevance** (via a single retrieval/ranking/budget solution — reuse **prompt's** composition internally).
- **KEEP as the retrieval/assembly authority:** `@singularity/prompt` (its ranking+knapsack+multi-stage = the "Context Engine" brain).
- **KEEP as knowledge store:** Brain (`@singularity/architecture` + `@singularity/memory` + `@singularity/intelligence` graph + `@singularity/wiki`) — all *store*. Their output is knowledge states the Context owner queries.
- **MERGE/REPLACE:** `wiki.ts`/query+assembly and `intelligence/retriever.format` merge into the Context relevance owner; indexes/graph stay in their owner.

**Bottom line:** The impossible-to-attribute problem is *not a missing package*; it's the absence of a **single decision authority**. As built, context = a fact skeleton, prompt = full-fledged selector, intelligence = big-index hash reuse, wiki = retrieval. All four *each decide relevance and format a block* and the host splice merges — this is the overlap to remove. The stated goal (Brain stores, Context decides relevance now) suggests the durable fix is:

1. Make `@singularity/prompt`'s `(SemanticRetrievalEngine + intelligence + knapsack)` the single **context retrieval/assembly** engine (`@singularity/context` delegates to it, or it self-serves into a unified `ContextEngine.getRelevantTask`).
2. Make `@singularity/intelligence`/wiki/architecture/memory expose **knowledge states** but *no independent "relevant block" builders*; contexts retrieve/rank/assemble their content.
3. Merge the host splice into one `ContextEngine`-based contextAssembly step.

---

### Classification matrix (summary)

| Component | Class |
|---|---|
| context (whole package) | KEEP (narrow: intake owner; may thin out over time). |
| context/retrieval+relevance+format | **MERGE** → into prompt (retrieval owner) |
| context/heuristic+sidecar+extractors | KEEP (intake) |
| prompt intelligence/budget/multistage/compiler | KEEP (the retrieval/assembly owner) |
| prompt indexer/graph/repo-map | KEEP (knowledge graph) |
| prompt full engine | KEEP |
| wiki (stored) | KEEP (knowledge store) |
| wiki search/query block-builder | **MERGE →** single retrieval owner |
| cache (all layers) | KEEP (I/O reuse; separate owner) |
| intelligence engine+store+scip+impact | KEEP (Brain graph store) |
| intelligence retriever+format | **MERGE →** single owner (leave the graph; move ranking/assembly to Context) |
| intelligence http/plane routes | KEEP |
| host merge-concatenation (contextEngineBridge+router runtime) | **REPLACE** with unified ContextEngine assembly |

---

## Tests inventory
1. context: `test/contextEngine.test.ts`, `test/benchmark.test.ts`.
2. prompt: 10 test files listed in the prompt section.
3. wiki: `test/wikiEngine.test.ts`.
4. cache: `test/fingerprint.test.ts`, `manager.test.ts`, `response-cache.test.ts`, `semantic-cache.test.ts`.
5. intelligence: `test/intelligence.test.mjs`.

## End note
All *confirmed model calls are none* in these 5 packages — the "LLM" boundary lives in the router/provider/LLM plane and in `services/langextract-sidecar`; these packages are intentionally instrumented compilers, stores, and caches. Any future plan must not duplicate retrieval *in* wiki/intelligence once the single Context owner is respected.