# `memory/intelligence` Cluster — Current-State Architecture Map

> Scope: the three "memory cluster" packages of the Singularity monorepo — `@singularity/brain`, `@singularity/memory`, `@singularity/neural-relay` — plus the overlap posture of the five sibling packages (`context`, `prompt`, `wiki`, `cache`, `intelligence`).
> Method: full source read of every `.ts` file in each package's `src/`, plus `package.json`, `index.ts`, `migrations/*.sql`, `docs/*.md`, and all test files; plus targeted grep of `vscode/extensions/singularity-ai/src/*Bridge.ts` and `packages/intelligence/src/http.ts` for callers. All paths are exact.

---

## PART A — per-package reports

---

### A1. `@singularity/brain`

**1. NAME / DIR / PURPOSE**
- Name: `@singularity/brain` (v0.1.0, MIT). Dir: `packages/brain/`
- `package.json` description: *"Singularity Brain — persistent user-level memory graph (entities, relationships, episodes, embeddings)"*.
- One-line purpose: the **user-level** persistent cognitive memory graph (one Brain, one reasoning model, four memory kinds), independent of any single workspace.

**2. PUBLIC API** (everything re-exported from `packages/brain/src/index.ts`, lines 8–47):
- `BrainStore`, `normLabel`, `packEmbedding`, `unpackEmbedding` (`store.js`)
- `HashBrainEmbedder`, `GatewayBrainEmbedder`, `cosine`, type `BrainEmbeddingProvider` (`embeddings.js`)
- `MemoryExtractor`, `isTrivialForBrain`, types `BrainLlmClient`, `ExtractionInput`, `ExtractionResult` (`extraction.js`)
- `computeImportance` (`importance.js`)
- `brainSearch` (`search.ts`)
- `BrainEngine`, type `BrainEngineOptions`, `BrainLlm` (`engine.js`)
- `resolveBrainConfig`, `brainModelConfigured`, type `BrainConfigPartial` (`config.js`)
- `OpenAiCompatibleBrainClient`, `MockBrainModelClient`, `brainLlmFromClient`, types `BrainModelClient`, `BrainChatMessage`, `BrainModelResult` (`modelClient.js`)
- `BRAIN_SYSTEM_PROMPT`, `ULTRATHINK_ADDENDUM`, `buildBrainMessages` (`prompt.js`)
- `scoreAttention` (`attention.js`)
- `BrainBudget` (`budget.js`)
- `minimizeForRemote`, `packSections` (`privacy.js`)
- `SemanticMemoryApi`, `entityToSemantic` (`semantic.js`)
- `ImprovementManager` (`improvement.js`)
- `BrainRuntime`, type `BrainRuntimeOptions` (`runtime.js`)
- `BRAIN_TOOL_DEFS`, `executeBrainTool`, `parseToolCall`, `toolSchemasForPrompt` (`tools.js`)
- full type re-export: `^export * from './types.js'`

**3. INTERNAL ARCHITECTURE**
- `store.ts` (`BrainStore`) — SQLite persistence, the durable heart. Upserts entities, relationships, episodes, type registry, sync state, KV. Embeddings are BLOB columns. Falls back to a JSON file (`brain.json`) when `node:sqlite` is unavailable.
- `engine.ts` (`BrainEngine`) — top-level orchestrator. Owns a `BrainRuntime`, `MemoryExtractor`, `BrainStore`, embedder, model client. Exposes `observeChat`, `observeFileChange`, `observeEvent` (feed into autonomous runtime loop), `ultrathink` (reasoning pass producing insights), `syncWorkspace` (chunked, resumable).
- `runtime.ts` (`BrainRuntime`) — the self-driving event loop: classifies runtime events (`RuntimeEventKind`), scores attention, enqueues for storage/consolidation, exposes `snapshot()`.
- `extraction.ts` (`MemoryExtractor`) — LLM-based extraction from chat/file-save text into entities/relationships/episodes; `isTrivialForBrain` gates noise.
- `importance.ts` — decayed/cognitive importance scoring (`computeImportance`, `refreshImportance`).
- `attention.ts` — `scoreAttention` with default thresholds in types.
- `cognitiveSchema.ts` — `COGNITIVE_SCHEMA`, `EPISODE_COLUMN_MIGRATIONS`, row→object converters for procedures/insights/hypotheses/policies/experiments/evaluations/activity.
- `semantic.ts` (`SemanticMemoryApi`) — facade over durable graph entities that writes as `SemanticMemory` (cluster-aware) and retrieves against importance.
- `search.ts` — hybrid retrieval: vector cosine pass over embedded entities + label/token pass + one-hop graph (3-stage `brainSearch`).
- `embeddings.ts` — `HashBrainEmbedder` (deterministic) and `GatewayBrainEmbedder` (OpenAI-compatible `/embeddings`); `cosine`.
- `modelClient.ts` — OpenAI-compatible `/chat/completions` client (Bearer key); `MockBrainModelClient` for tests.
- `config.ts` — model independent from chat routing; env overrides (`SINGULARITY_BRAIN_API_KEY`, `SINGULARITY_DECISION_API_KEY`, `OPENROUTER_API_KEY`).
- `prompt.ts` — `BRAIN_SYSTEM_PROMPT`, `ULTRADITHINK_ADDENDUM`, message builder.
- `budget.ts` (`BrainBudget`), `privacy.ts` (minimize/truncation for remote), `improvement.ts` (`ImprovementManager`), `tools.ts` (`BRAIN_TOOL_DEFS`, tool-call execution).

**4. STATE OWNED**
- `brain.sqlite` — **user-level** (`engine.ts` line 87: `new BrainStore(join(opts.storageDir, 'brain.sqlite'), opts.userId)`); `engine.ts` line 43 documents "VS Code globalStorage/brain. USER-level", independent of workspaces.
- JSON fallback `brain.json` beside it when SQLite unavailable (`store.ts` `dbPath.replace(/\.sqlite$/, '') + '.json'`).
- Sync progress per-workspace recorded in `sync_state` table (`syncWorkspace`, `getSyncState`).

**5. DATABASES / TABLES** (`store.ts` `SCHEMA`, lines 79–146, plus `cognitiveSchema.ts` `COGNITIVE_SCHEMA`)
- `entities` (id, user_id, type, label, label_norm, description, importance, confidence, source_type, source_ref, project_id, first_seen_at, last_seen_at, degree, embedding BLOB) + indexes on `(user_id,label_norm)`, `(user_id,type)`, `(user_id,importance)`
- `relationships` (id, user_id, source_id, target_id, rel_type, confidence, created/updated, source_event) + index on `(source_id)`, `(target_id)`
- `episodes` (id, user_id, kind, summary, project_id, workspace_root, entity_ids, occurred_at, source_ref) + `idx_episodes_time`
- `type_registry`, `sync_state`, `kv`
- Cognitive store (`COGNITIVE_SCHEMA`): `procedures`, `insights`, `hypotheses`, `policies`, `experiments`, `evaluations`, `activity_log`
- Storage backend: **SQLite** (`node:sqlite`) with JSON-file fallback. No Postgres/Neo4j.

**6. MEMORY TYPE**
- **Mixed user-level semantic + episodic + procedural + architectural knowledge.**
- `MemoryType` (types.ts): project, repository, code, technology, service, layer, architecture, concept, fact, requirement, constraint, assumption, topic, goal, decision, tradeoff, learning, lesson, hypothesis, … — plus `MemoryCluster` (architecture/memory/code/…), `MemoryAuthority` (fact/inference/decision/observation/hypothesis/validated).
- `BrainEpisode` (episodic), `BrainProcedure` (procedural). These are typed for persistence but largely used as shapes today.

**7. RELAY EVENTS EMITTED / CONSUMED**
- No pub/sub bus of its own. **Consumes `RuntimeEvent`** (from `@singularity/runtime`, via `observeEvent` / `handleRuntimeStore`); `runtime.ts` classifies `RuntimeEventKind` (`file|commit|conversation|memory|episode|decision|test|metric`).
- Exposes callbacks: `BrainEngine.onProgress` (`SyncProgressEvent`) and `onMemoryDelta` (memories/relationships/learnings/insights deltas) (`engine.ts` lines 54, 56, 338). These are surfaced to the Springboard UI through `brainBridge.onBrainProgress` / `onBrainMemoryDelta`.

**8. MODEL CALLS**
- **Embeddings:** `GatewayBrainEmbedder` posts to an OpenAI-compatible `/embeddings` endpoint; default fallback `HashBrainEmbedder` is local/deterministic (`embeddings.ts`).
- **Reasoning/LLM:** `OpenAiCompatibleBrainClient` (`modelClient.ts`) calls `{baseUrl}/chat/completions` with `model: cfg.model.model`, timeout + Bearer auth; a single reasoning model (`one Brain. one dedicated reasoning MoE`). Keys from `SINGULARITY_BRAIN_API_KEY` / `SINGULARITY_DECISION_API_KEY` / `OPENROUTER_API_KEY`.
- Deliberately independent of the user's chat routing (`config.ts` line 2). **No `@singularity/router` import.**

**9. DEPENDENCIES (other `@singularity/*`)**
- `grep '@singularity/' packages/brain/src` → **zero imports.** Fully standalone (node:sqlite, node:fs, node:path, fetch). Introduces an *embeddings* and *chat-completions* implementation rather than reusing the router.

**10. CALLERS / CONSUMERS** (from `vscode/extensions/singularity-ai/src`)
- `brainBridge.ts`: `import { BrainEngine, type BrainRuntimeSnapshot } from '@singularity/brain';` — **owns the BrainEngine singleton**, initializes under VS Code `globalStorageUri`, and exposes `onBrainProgress`, `onBrainRuntimeStatus`, `onBrainMemoryDelta`, `startBrainBridge`, `getBrainEngine`, `openBrain`, `reportIntelligenceShellProgress`.
- `globalMemoryBridge.ts`: `getBrainEngine()` — uses the BrainEngine to query the user profile graph (`startGlobalMemoryBridge`, identity memory under `memory-tool/memories/`, `user-profile.md`).
- `intelligenceShell/shellPanel.ts`: `getBrainEngine: () => import('@singularity/brain').BrainEngine` (dep via `brainBridge`).
- `extension.ts`: `startBrainBridge(context, …)` (lines 338, 422).
- No other package imports `@singularity/brain` (grep found none in `packages/`, only the extension shell).

**11. SYNC vs ASYNC**
- Hybrid. `observeChat`/`observeFileChange` run **on the coding hot path but are gated so memory never breaks it**; `engine.ts` line 302 comment: *"memory must never break the coding hot path"* — chunks and caps extraction. `observeEvent` prefers the **background runtime loop** (`rt.enqueue`). `syncWorkspace`, `ultrathink`, embedding/consolidation are async background work. Runtime `enqueue()` is non-blocking.

**12. USER-VISIBLE FUNCTIONALITY**
- The Brain graph UI (via the intelligence shell). The user sees the synced memory graph, sync progress (`onBrainProgress`), memory/relationship/learning deltas, and long-term user identity/architecture knowledge that persists across workspaces (used by global-memory bridge). It is a passive background cog the user mostly views rather than drives.

**13. TESTS** (`packages/brain/test/`)
- `attention.test.mjs` (26 ln) — attention scoring / trivial-chat gating.
- `brain.test.mjs` (101 ln) — `BrainStore`, `normLabel`, embeddings pack/unpack.
- `cognitive.test.mjs` (174 ln) — cognitive schema (procedures/insights/hypotheses …), row converters.
- `engine.test.mjs` (183 ln) — `BrainEngine` end-to-end (observe, syncWorkspace).
- `smoke.mjs` (57 ln) — dist smoke over `index.js`.

**14. OVERLAP WITHIN BRAIN (internal engines)**
- Brain already owns **semantic** (entities/clusters), **episodic** (`episodes`), **procedural** (`procedures` + `BrainProcedure`), and **architectural** (`architecture` cluster/memory type, `Architecture` edges from module sync). It is the closest thing to the target "one Brain with semantic+episodic+procedural+architectural".

---

### A2. `@singularity/memory`

**1. NAME / DIR / PURPOSE**
- Name: `@singularity/memory` (v0.1.0). Dir: `packages/memory/`
- `package.json`: *"Singularity Memory Engine — async project memory off the coding hot path"*.
- One-line purpose: asynchronous **project-scoped** memory engine that records durable project knowledge off the LLM hot path (SQLite WAL → event bus → worker pipeline → Postgres/vector/Neo4j/mem0).

**2. PUBLIC API** (everything re-exported from `packages/memory/src/index.ts`, lines 1–67; plus `./events` subpath in `package.json` exports):
- config: `MemorySettings`, `RankerWeights`, `readMemorySettings`, `isMemoryActive`, `DEFAULT_RANKER_WEIGHTS`
- metrics: `MemoryMetricsCollector`, `createEmptyMemoryMetrics`, `estimateTokens`, type `MemoryMetrics`
- domain: `MemoryTypeSchema`, `MemoryStatusSchema`, `MemoryScopeSchema`, `MemoryRecordSchema`, `MemoryCandidateSchema`, `parseMemory`, `nowIso`, `newMemoryId`; types `MemoryType/Status/Scope/Record/Candidate/SourceType`
- snapshot: type `ProjectSnapshot`; `buildSnapshot`
- events: `MEMORY_EVENT_TYPES`, `createMemoryEvent`, `LocalMemoryBuffer`, `MemoryOutboxPublisher`, `InMemoryEventBus`, `BufferEventPublisher`; types `MemoryEvent`, `EventPublisher`, `EventBus`
- subsystem: `MemorySubsystem`, `createMemorySubsystem`, `createMemorySubsystem`
- api: `mountMemoryRoutes` (Hono router)
- storage: `InMemoryMemoryRepository`, `SqliteMemoryRepository`, `openSqliteMemoryRepository`, `PostgresMemoryRepository`, `openPostgresMemoryRepository`, type `MemoryRepository`
- embeddings: `HashEmbeddingProvider`, `OpenAiCompatibleEmbeddingProvider`, type `EmbeddingProvider`
- retrieval: `MemoryRanker`, `hybridRank`
- extraction: `classifyType`, `classifyScope`, `scoreImportance`, `scoreConfidence`, `isDurableNoise`, `heuristicExtractCandidate`, `extractSecrets`
- dedup/conflict workers: `findDuplicate`, `isDuplicate`, `isConflict`, `applySupersession`, `detectsTechConflict`
- graph: `JsonRelationshipStore`, `Neo4jRelationshipStore`, `openRelationshipStore`, type `RelationshipStore`
- intelligence providers: `LocalMemoryProvider`, `Mem0MemoryProvider`, type `MemoryIntelligenceProvider`
- evidence: `GitEvidenceSource`, type `EvidenceSource`
- security: `assertProjectScope`

**Subsystem class** (`src/subsystem.ts`, methods `start/stop/emit/lookup/snapshot/search/createMemory/getMemory/patchMemory/supersede/consolidate/relationships/compact`).

**3. INTERNAL ARCHITECTURE**
- `subsystem.ts` (`MemorySubsystem`) — orchestrator wiring `LocalMemoryBuffer` (WAL), `InMemoryEventBus`, `MemoryOutboxPublisher`, `MemoryPipeline`, `MemoryRanker`, TTL cache / Redis L2, relationship store, git evidence.
- `workers/pipeline.ts` (`MemoryPipeline`) — the real dispatcher: `handle(event)` → bounded `IntelligenceWorkerPool.run` → `dispatch(event)` (dedup → conflict/supersession → insert → write-behind `embedMemory` + `indexGraph` + snapshot refresh). Circuit breakers on db/embed/graph + retry.
- `workers/pool.ts` — `IntelligenceWorkerPool`, `CircuitBreaker`, `withRetry`. (embeddings.ts, extraction.ts, graph.ts are 1–2 line re-export shims.)
- `workers/dedup.ts`, `workers/conflict.ts`, `workers/consolidation.ts` — pure functions: `isDuplicate`/`findDuplicate`, `isConflict`/`applySupersession`, `consolidateProjectMemories` (clusters + merges synthetic canonical facts). graph.ts re-exports Neo4j/JSON stores.
- `storage/sqlite.ts` (`SQLiteMemoryRepository`), `storage/postgres.ts` (`PostgresMemoryRepository`), `storage/vector.ts` (Hash / OpenAI-compatible embedding providers), `storage/repository.ts` (interface).
- `extraction/extractor.ts` (`HeuristicMemoryExtractor`), `extraction/secrets.ts` (via `@singularity/context`).
- `retrieval/ranker.ts` (`MemoryRanker.score`, `hybridRank`: vector + keyword with source-priority/importance/confidence/recency).
- `events/*`: `buffer.ts`, `publisher.ts`, `priorities.ts`, `schemas.ts`.
- `providers/mem0/provider.ts`, `providers/graph/store.ts`, `providers/evidence.ts`.
- `cache/{l1,snapshot}.ts`, `api/routes.ts`, `security/isolation.ts`, `config/settings.ts`, `metrics.ts`, `domain/{memory,snapshot,provenance}.ts`.

**4. STATE OWNED**
- `<workspaceRoot>/.singularity/memory/events.wal` (WAL, JSONL replay buffer; subsystem.ts line 66).
- `<workspaceRoot>/.singularity/memory/memory.sqlite` (PRAGMA journal_mode=WAL; subsystem.ts line 73, sqlite.ts line 58).
- Optional Postgres (`MEMORY_DATABASE_URL`) with `migrations/001_init.sql` + `CREATE EXTENSION IF NOT EXISTS vector` (pgvector); optional Redis (`MEMORY_REDIS_URL`); optional Neo4j (`NEO4J_URI/USER/PASSWORD`).

**5. DATABASES / TABLES** (from `migrations/001_init.sql`, mirrored in `storage/sqlite.ts`)
- `projects` (id PK, name, repository_url, metadata, created/updated)
- `memories` (id, project_id, type, scope, title, content, reason, status, importance, confidence, source_type, source_id, task_id, **supersedes_id**, entities, **embedding_pending**, timestamps) + `memories_project_idx`, `memories_project_status_idx`, `memories_project_type_idx`
- `memory_versions` (version history / supersession chain)
- `memory_embeddings` (memory_id UNIQUE, **embedding vector(64)**, model, dimensions)
- `processed_events` (idempotency guards)
- `memory_dead_letters` (failed events)
- Storage backends: **SQLite (default, WAL)**, **PostgreSQL + pgvector** (optional), **Neo4j** (optional relationship store), Redis (optional L2), JSON file store fallback / in-memory.

**6. MEMORY TYPE**
- **Semantic + episodic project-scoped memory**, typed:
  `MemoryType`: FACT, PREFENCE, CONSTRAINT, ARCHITECTURAL_DECISION, ARCHITECTURAL_CONSTRAINT, TECHNOLOGY_CHOICE, REJECTED_APPROACH, LESSON_LEARNED, PROJECT_CONVENTION, HISTORICAL_EVENT, DISCOVERY, WARNING.
  `MemoryStatus`: ACTIVE, SUPERSEDED, DEPRECATED, INVALIDATED, ARCHIVED. `MemoryScope`: WORKING, PROJECT, ARCHITECTURAL, HISTORICAL. `SourceType`: CONVERSATION, AGENT, COMMIT, PULL_REQUEST, ADR, DOCUMENT, CODE, TEST, CI, HUMAN, SYSTEM.
- Version history (`memory_versions`) + store memory embeddings. No procedural/tool memory.

**7. RELAY EVENTS EMITTED / CONSUMED**
- Own in-package event bus (not external). `MEMORY_EVENT_TYPES` = 25 strings (incl. USER_INTENT_CAPTURED, CODE_CHANGE_COMPLETED, FILE_CREATED, COMMIT_CREATED, ADR_CREATED, ADR_SUPERSEDED).
- `InMemoryEventBus.publish` / `subscribe`; `MemoryOutboxPublisher.tick` drains 32 events every 50 ms into bus; `MemorySubsystem.start` subscribes `*` → `pipeline.handle`. `MemorySubsystem.emit` = external ingress. Dead-entry replay idempotency via `processed_events`.

**8. MODEL CALLS**
- **Embeddings:** `OpenAiCompatibleEmbeddingProvider` (`storage/vector.ts`, OpenAI-compatible `/embeddings`, default model text-embedding-3-small); default local `HashEmbeddingProvider`.
- **LLM/intelligence:** `MemoryIntelligenceProvider` abstraction (mem0 provider file) — `extract`/`consolidate`/`search`. `Mem0MemoryProvider` hits mem0 `/v1/memories`. **No OpenAI chat model is called by this package**; the default local intelligence is heuristic. Optional mem0 only.
- So: minimal model usage, hash-first embeddings; no router import.

**9. DEPENDENCIES (other `@singularity/*`)**
- grep → exactly two: `extraction/secrets.ts:1 → @singularity/context` (`extractSecrets` base), `storage/vector.ts:1 → @singularity/cache` (`HashEmbeddingProvider`'s HashEmbedder).
- `package.json`: `@singularity/cache`, `@singularity/context`, `hono`, `zod` (dep); optional `neo4j-driver`, `pg` (lazy-loaded).

**10. CALLERS / CONSUMERS**
- `memoryBridge.ts` (vs-code): `import { MemorySubsystem } from '@singularity/memory'`; `startMemoryDaemon(workspaceRoot)` builds a `MemorySubsystem` (intelligence plane only), exposes `getMemorySubsystem`, `disposeMemoryDaemon`, `emitMemoryEvent`, `lookupMemoryContext`, `memoryDbHint`.
- `contextEngineBridge.ts`: imports `getMemorySubsystem, lookupMemoryContext` (from memoryBridge.js) — injects memory lookup into structured context payload; `mem` engine in `collectPlaneEngines`.
- `architectureBridge.ts` / `outcomeBridge.ts`: `getMemorySubsystem()?.emit({…})` fire-and-forget memory events.
- `packages/intelligence/src/http.ts`: `import { mountMemoryRoutes, type MemorySubsystem } from '@singularity/memory';` — mounts memory API onto the intelligence HTTP app and forwards coding-plane events to `memory.emit`.
- The `test/memory.test.mjs` hot-path guard asserts VS Code `automateService.ts`, `toolingLoop.ts`, `singularityPromptEngineBridge.ts` never import `memory/{workers,extraction}` nor the heavy providers (SQLite/Postgres/mem0/Neo4j).

**11. SYNC vs ASYNC**
- **Fire-and-forget `.emit()` on the coding hot path** (non-throwing), snapshot/lookup are sync fast-path. All heavy work (**evacuation, embeddings, Postgres, Neo4j, mem0, consolidation, hybrid search**) is background workers (outbox 50 ms + bounded pool `MEMORY_SUBS_MAX_CONCURRENCY`). HTTP routes return `{ok:true, queued:true}`.

**12. USER-VISIBLE FE**
- HTTP API (`mountMemoryRoutes` at `/projects/:project_id`): CRUD memories, search, ingest events, extract, consolidate, snapshot, decisions, relationships. Programmatic `emit/search/snapshot/lookup/consolidate/compact`. Resilient to SQLite/Postgres/Neo4j/mem0 presence; no LLM-visible memory unless project memory integration enabled.

**13. TESTS**
- `test/memory.test.MJS` (457 ln) — validation, redaction, isolation, dedup/conflict/versions, ranker, extraction + pipeline idempotency, snapshot/search, graph/mem0 adapters, HTTP routes, Postgres smoke (gated), TPS acceptance bands, bounded-queue backpressure.

**14. INTERNAL ENGINES / KNOWLEDGE TYPES**
- Semantic/episodic ingest at `MemoryPipeline` + `HeuristicMemoryExtractor`; dedupe at `workers/dedup`; conflict + supersession at `workers/conflict`; consolidation at `workers/consolidation`; retrieval at `retrieval/ranker`; embeddings write-behind in `pipeline.embedMemory`; graph index in pipeline + relationship store.
- Owns **typed project knowledge** (facts/preferences/constraints/architecture/tech/rejections/lessons). No procedural memory.

---

### A3. `@singularity/neural-relay`

**1. NAME / DIR / PURPOSE**
- Name: `@singularity/neural-relay` (v0.1.0). Dir: `packages/neural-relay/`
- `package.json`: *"Experimental Neural Relay — fast context intelligence for minimum-sufficient DeepSeek context"*.
- One-line: an **in-memory context relay** (not a persistent memory) that retrieves/ranks repo files and optionally uses OpenRouter Nemotron to pick the minimum-sufficient file set for a minimized DeepSeek prompt.

**2. PUBLIC API** (everything from `packages/neural-relay/src/index.ts`, lines 1–98)
- flags: `readNeuralRelayFlags`, `isNeuralRelayEnabled`, `DEFAULT_NEURAL_RELAY_MODEL` (Nemotron), `DEFAULT_CODING_MODEL` (DeepSeek Flash), types
- `roleBinding`, type `ModelRoleBinding`/`ModelRole`
- types: `IndexedFile`, ContextCandidate, RelevantFile, ContextResolution, ConfidenceAction, EgressEntry, BuiltContext, ContextExpansionRequest, NeuralRelayTokenMetrics, NeuralRelayQualityMetrics/PertMetrics/CostMetrics, ExperimentRecord, AnalyzeContextOptions/Result, RelayPrepareResult, RepoIndexPort
- store: `NeuralRelayStore`, `neuralRelayDir`
- cacheStatus: `applyDeepSeekUsage`, `applyNeuralRelayResult`, `averageContextReduction`, `compactTokenCount`, `cumulativeDeepSeekRate`, `cumulativeRelayRate`, `emptyCacheStatusSnapshot`, formatters (`formatNeuralRelayBar`, `formatDeepSeekCacheBar/Tooltip`, `formatSavedBar`, `formatRequestTelemetryDebug`), `isDeepSeekModel`, `isNeuralRelayContextModel`, `setPhase`, 5 types
- hash: `estimateTokens`, `tokenize`, `languageFromPath`
- retrieval: `FilesystemRepoIndex`, `IntelligenceRepoIndex`, `deterministicRetrieve`, `semanticRetrieve`, `rankCandidates`
- intelligence: type `ContextIntelligenceModel`; stub classes `MLXProvider`/`LlamaCppProvider`/`OllamaProvider`/`VllmProvider` (throw "not implemented in this POC"); `OpenRouterNemotronProvider`; `CONTEXT_RESOLUTION_JSON_SCHEMA`, `parseContextResolution`, `deterministicResolution`; `confidenceAction`
- builder: `buildDeepSeekContext`, `renderDeepSeekPrompt`, `appendVolatileContext`
- pipeline: `prepareNeuralRelayContext` (main entry), `applyContextExpansion`, `expandBuiltContext`, `expandFromVerifierFailure`, `pathsFromFailureOutput`
- pricing: `costUsd`, `contextReduction`, `priceFor`; experiment: `buildExperimentRecord`, `successCriteria`
- security: `logEgress`, `makeEgress`

**3. INTERNAL ARCHITECTURE**
- 3-stage local retrieval (`src/retrieval/`): `deterministic.ts` (Stage 1 — imported-neighborhood filename/symbol/keyword, concurrent) → `semantic.ts` (Stage 2: 64-dim FNV-1a hash-embedding cosine, "No new vector database", prefers host `semanticSearch`) → `rank.ts` (Stage 3: score bump, top-50 → `ContextCandidate[]`).
- 2 repo-indexers: `filesystemIndex.ts` (`FilesystemRepoIndex`, regex code index on up to 2000 files), `intelligenceIndex.ts` (`IntelligenceRepoIndex`, duck-typed adapter over host's graph engine, no package import).
- intelligence layers: `ContextIntelligenceModel.ts` (contract + 4 throwing stubs), `OpenRouterNemotronProvider` (real OpenRouter `fetch` JSON-schema call), `confidence.ts` (confidence→action at .85/.6), `schema.ts`.
- pipeline: `orchestrator.ts` (`prepareNeuralRelayContext`: no-op when disabled → parallel retrieval → rank → `callWithRetry` (one retry) → confidence routing → build/render → context-size guard → egress/experiment), `expansion.ts`, `fallback.ts`.
- `builder/contextBuilder.ts` — stable-prefix (system+architecture+tool defs) vs volatile block (selected files); stable hashes to `promptCacheKey` (`nr-<sha256-24>`).
- `roles.ts` — role→provider/model routing. `metrics/` — cacheStatus, experimentLog, pricing.

**4. STATE OWNED**
- `.singularity/neural-relay/` (store.ts `DIR_NAME='neural-relay'`): `experiments/<taskId>.json` (pretty JSON per experiment), `latest.json`, `egress.log` (append-only JSONL), `telemetry.json`.
- JSON-file only; driven by `workspaceRoot` path.

**5. DATABASES / TABLES**
- **None / no SQLite.** grep matches only a comment in `semantic.ts:6` ("No new vector database"). State is plain JSON files (`ExperimentRecord`s, telemetry, egress) under `.singularity/neural-relay/` plus in-memory `FilesystemRepoIndex` maps. No tables, no SQL. (Its `IntelligenceRepoIndex` adapts the host ITSELF's graph store but does not persist anything itself.)

**6. MEMORY TYPE**
- **Not persistent memory.** It relays project code context (symbols, imports, summaries, tests) into the DeepSeek context window; Nemotron picks the **minimum sufficient** file set. No long-term knowledge accumulation; written artifacts are experiment/telemetry records, not knowledge. Embedding is a **stateless hash** placeholder, explicit no-vector-DB.

**7. RELAY EVENTS EMITTED / CONSUMED**
- **No event bus.** grep finds no publish/emit/subscribe. Only a `console.log('[neural-relay] egress')` line and an `AbortSignal`/`addEventListener('abort')` inside `OpenRouterNemotronProvider`. "relay" in the API is naming only.

**8. MODEL CALLS**
- **`OpenRouterNemotronProvider`** — `POST {baseUrl}/chat/completions` to OpenRouter with `response_format.json_schema` (strict context_resolution), temp 0, max_tokens 1200, reasoning off. `flags.ts` defaults `nvidia/nemotron-3-nano-30b-a3b:free`, `deepseek/deepseek-v4-flash-0731`. `roles.ts` routes CONTEXT_INTELLIGENCE→Nemotron, CODING/REASONING/VERIFICATION→DeepSeek Flash. `openrouterEnv.ts` reads `SINGULARITY_DECISION_API_KEY`/`OPENROUTER_API_KEY` + base URL; **deliberately avoids importing `@singularity/router`**. **No embeddings** (hash only).

**9. DEPENDENCIES (other `@singularity/*`)**
- grep → **zero `@singularity/*` imports** (only comments); package.json `dependencies: {}`. Node built-ins (`node:fs/path/crypto/url`) + TS stdlib only. Fully standalone.

**10. CALLERS / CONSUMERS**
- Only its own wrapper `cacheTelemetry.ts` and `benchmark/harness.ts` within the package. **No external caller today**, but architected to be host-driven (host injects an index — e.g. host IntelligenceEngine — and consumes `RelayPrepareResult`/`promptBlock`/`ExperimentRecord`). VS Code cache-bar formatters are exported for the host.

**11. SYNC vs ASYNC**
- **Hot path, async, on the forwarded code-agent loop** (not a background worker). `prepareNeuralRelayContext` awaits retrieval (parallel) + Nemotron (20s timeout). Iterative expansion runs synchronously per follow-up turn. Telemetry/egress are synchronous `writeFileSync`.

**12. USER-VISIBLE FE**
- None of its own screens. Surfaces VS Code **status-bar telemetry** (cache bar, "neural relay %" hit, "▾ saved ctx", tooltip, request-debug panel) via the `format*` helpers. The benchmark harness (`benchmark/harness.ts`) writes `benchmarks/neural-relay/METRICS.json`.

**13. TESTS** (`packages/neural-relay/test/`)
- `neuralRelay.test.ts` (507 ln), `cacheStatus.test.ts` (304 ln), `benchmarkTasks.test.ts` (20 ln). Vitest-based. No test targets `IntelligenceRepoIndex` directly.

**14. INTERNAL ENGINES / KNOWLEDGE TYPE**
- `FilesystemRepoIndex` = built-in in-memory code index/retrieval backstop. `IntelligenceRepoIndex` = thin adapter over the host's graph. Neither is persistent memory; both feed candidate selection. It is a **retrieval/context-relay engine**, not a memory.

---

## PART B — cross-package consumer map (`vscode` bridges)

| consumer (file) | brain | memory | neural-relay |
|---|---|---|---|
| `brainBridge.ts` | **BrainEngine singleton** (user-level globalStorage) | — | — |
| `globalMemoryBridge.ts` | `getBrainEngine()` writes user-profile/identity into brain graph | — | — |
| `memoryBridge.ts` | — | `MemorySubsystem` (intelligence plane) | — |
| `contextEngineBridge.ts` | — | `getMemorySubsystem`/lookupMemoryContext | — |
| `architectureBridge.ts`, `outcomeBridge.ts` | — | `sys.emit(...)` fire-and-forget | — |
| `intelligenceShell/shellPanel.ts` | `getBrainEngine()` graph UI | — | — |
| `cacheTelemetry.ts` | — | — | `@singularity/neural-relay` (CacheStatusSnapshot, NeuralRelayStore) |
| `neuralRelayBridge.ts` | — | — | `NeuralRelayStore`, `FilesystemRepoIndex`, `IntelligenceRepoIndex`, `prepareNeuralRelayContext`, flags/modes |
| `packages/intelligence/src/http.ts` | — | `mountMemoryRoutes(app, memory)`, `memory.emit` | — |

---

## PART C — overlap with the five sibling packages

(from separate grep of `packages/context`, `packages/prompt`, `packages/wiki`, `packages/cache`, `packages/intelligence` + the three cluster maps)

| pkg | persistent knowledge role | retrieval/RAG | consolidation | embeddings | scope |
|---|---|---|---|---|---|
| **context** | `.singularity/project-context/*.json` (ProjectStateStore) | structured project state via LangExtract | extract→merge | — | project |
| **prompt** | **in-memory** `MemoryManager`/`WorkingMemory`/`MemoryNode` + optional durable IR-cache/repo-map; defines its **own MemoryScope** | `SemanticRetrievalEngine.retrieve`, `MemoryManager.semanticSearch` | in-memory learning engine / graph-diff | hash `DefaultHashEmbedder` (64) | session+project |
| **wiki** | markdown + meta under workspace wiki root (Karpathy compounding) | `wiki.searchPages` keyword | ingest→hub/synthesis/contradictions | — | project |
| **cache** | **not knowledge** — InMemoryMemoryHub only; SqliteStore is JSON-backed cache | `SemanticPromptCache.query` (vector) | invalidation only | `HashEmbedder` | all namespaces, in-memory |
| **intelligence** | **real graph.sqlite** (`SqliteGraphStore`), `IntelligenceEngine` | `retriever.retrieveContext` (hybrid lexical) | **staged** pipeline (tree→ast→scip→docs→embeddings→architecture) | embedding column | project |

**Where the cluster overlaps each of these in responsibility:**

**`@singularity/brain` vs the others:** vs `intelligence` — brain has its own user-level graph (SQLite) duplicating `intelligence`'s project graph store; vs `context` — both store durable project state (brain's architectural/decision clusters vs context JSON); vs `prompt` — brain stores `Memory`/`SemanticMemory` but prompt keeps its own in-memory `MemoryManager` with overlapping notion of memory types/scopes; vs `cache` — brain's own embedding/vector pass replicates `cache`'s semantic cache retriever and the shared hash embedder.

- **`@singularity/memory` vs the others:** vs `intelligence` — memory delegates its HTTP and store to intelligence's project graph where applicable (clean boundary, `mountMemoryRoutes`); vs `context` — memory and context both infer/derive project knowledge (memory: typed MemoryRecords incl. architectural; context: extracted project state); vs `prompt` — the biggest overlap: prompt defines its own `MemoryNode`/`MemoryManager`/semantic search and its own user/project memory while memory implements a parallel typed `MemoryRecord`/`MemoryRanker`/`hybridRank`; vs `wiki` — memory's durable per-project memoro vs wiki's durable markdown knowledge; vs `cache` — memory reuses `@singularity/cache`'s `HashEmbedder`; vs `intelligence` — both maintain graph SQLite (memory via providers; intelligence via `SqliteGraphStore`), with memory's `mountMemoryRoutes` being fully hosted inside intelligence's HTTP app.

- **`@singularity/neural-relay` vs the others:** vs `prompt` — relay and prompt both keep a hash-embed semantic-retrieval + budget (minimum-sufficient context) concern; relay overlaps `prompt`'s `SemanticRetrievalEngine` window and `prompt`'s cacheable-stable-prefix idea; vs `cache` — relay exposes the DeepSeek KV-cache status-bar and prompt cache-key, duplicating `cache`'s cache instrument; vs `context`/`intelligence` — relay re-uses the intelligence/Custom graph index rather than owning knowledge; vs `wiki` — no overlap.

---

## PART D — classification

Per consolidation goals — **Brains should merge into one 'Brain' owning semantic+episodic+procedural+architectural knowledge** — classify each package and its internal engines.

| item | class | rationale |
|---|---|---|
| `@singularity/brain` | **KEEP (as the one Brain)** | Already owns semantic + episodic (`episodes`) + procedural (`procedures`) + architectural clusters in a user-level SQLite. It is the consolidation target, not the orphan. |
| `BrainEngine` | KEEP | Orchestrator; single reasoning model per the brain vision. |
| `BrainRuntime` | KEEP | Background autonomous event loop; feeds storage/consolidation. |
| `BrainStore` + cognitive schema | KEEP | The durable backend for the unified Brain graph. |
| `SemanticMemoryApi`, `brainSearch` | MERGE | Semantic/retrieval surface should complement rather than duplicate other engines (see below). |
| `@singularity/memory` | **MERGE** | Project-scoped duplicate of the Brain's semantic+episodic+procedural knowledge with its own typed MemoryType tables (FACT/ARCHITECTURAL_DECISION/…). Its durable value (SQLite/Postgres/pgvector, WAL, workers) should fold into the single Brain rather than remain a parallel project memory span. |
| `MemorySubsystem` | MERGE | pipeline/orchestration should ride the Brain runtime. |
| `MemoryRanker`/`hybridRank`, `workers/dedup`, `workers/conflict`, `workers/consolidation` | MERGE | retrieval + consolidation responsibilities overlap brain's graph & importance. |
| `memory providers (Postgres/pgvector, Neo4j, mem0)` | KEEP (as backends behind the merged Brain) | optional backends can be preserved as connectors into the consolidated brain. |
| `@singularity/neural-relay` | **REPLACE / largely consume (reuse), minimize** | It is **not a persistent memory** at all — it is a retrieval + context-minimization relay. The relay's retrieval/ranking overlaps brain+memory and prompt; its Nemotron-LLM context-selection may be an ingredient, but it does not belong in the memory cluster. It is better: routed through the Brain's retrieval (or prompt engine) rather than a separate package. |
| `FilesystemRepoIndex` (neural-relay) | MERGE/REPLACE | duplicate of project code retarget from intelligence's graph + prompt retrieval. Prefer host graph (`IntelligenceRepoIndex`). |
| `IntelligenceRepoIndex` (neural-relay adapter) | KEEP as adapter | thin glue to the host graph; belongs to whatever owns context retrieval. |
| `metrics/cacheStatus`, `pricing`, `experimentLog` | MOVE | telemetry/experiment bookkeeping doesn't belong in a memory package; move toward cache/telemetry owned by the plan. |

**What this means for the consolidation:** `@singularity/brain` is the surviving "one Brain"; `@singularity/memory`'s typed project-memory machinery merges into it (fold MemorySubsystem/pipeline/workers into BrainEngine+runtime; keep SQLite/Postgres/Neo4j/mem0 as connectors). `@singularity/neural-relay` is a retrieval/context minimization layer — not a memory — reuse via the Brain/prompt engine (KEEP its `IntelligenceRepoIndex` adapter + context builder as a MOVE), and do not grow it into a memory store.

---

*Method note: maps assembled from full source reads of the three cluster packages plus targeted greps. Max-fidelity sources: packages/{brain,memory,neural-relay}/src/*.ts, package.json, migrations/001_init.sql, docs/IMPLEMENTATION_REPORT.md, vscode/extensions/singularity-ai/src/{brainBridge,memoryBridge,neuralRelayBridge,globalMemoryBridge,contextEngineBridge,architectureBridge,outcomeBridge,cacheTelemetry}.ts, packages/intelligence/src/http.ts.*