# Architecture Intelligence & Outcome Verification — Current-State Map

> Cluster mapped: `@singularity/architecture`, `@singularity/intelligence` (architecture/code-impact facets), `@singularity/outcome`.
> All paths relative to `/Users/ashutosh/Singularity`. Read from live `.ts` source, `index.ts`, `package.json`, `docs/*.md`, and cross-package consumers (bridge + sidecar). Test dirs are **NOT empty** — see §Tests per package.

---

## 1. PACKAGE: `@singularity/architecture`

### 1.1 Name / Dir / Purpose
- **NAME**: `@singularity/architecture`
- **DIR**: `packages/architecture`
- **PURPOSE**: *Architecture Intelligence & Decision Memory* — an async ADR (Architecture Decision Record) plane storing *why* the system is shaped the way it is, plus cache-first context injection, off the coding hot path. Canonical store `/workspace/.singularity/architecture/architecture.sqlite`.
- **version** 0.1.0, node >=18, MIT.

### 1.2 Public API (index.ts exports)
- **Flags/metrics**: `ArchitectureFlags`, `readArchitectureFlags`, `isArchitectureMemoryActive`, `ArchitectureMetricsCollector`, `createEmptyArchitectureMetrics`, `estimateTokens`.
- **ADR domain**: `parseAdr`, `safeParseAdr`, `AdrSchema`, `embedText`(?local), `transitionAdr`, `applySupersession`, `isActiveStatus`, `scoreConfidence`, `confidenceAction`, `inferFactorsFromText`, `classifySignificance`, `shouldEnterAdrPipeline`, `validateAdrDeep`.
- **Events**: `DOMAIN_EVENT_TYPES`, `createDomainEvent`, `LocalEventBuffer`, `InMemoryEventBus`, `OutboxPublisher`, event types/bus types.
- **Context cache**: `ArchitectureContextCache`, `lookupCachedContextBlock`, `guessEntities`, budget constants.
- **Subsystem/facade**: `ArchitectureSubsystem`, `createArchitectureSubsystem`, `createMemoryStore`, `architectureFacade`.
- **Routes**: `mountArchitectureRoutes`.
- **Decision store**: `MemoryDecisionStore`, `SqliteDecisionStore`, `openDecisionStore`, types `DecisionStore`, `Observation`, `StoredConflict/Drift/Evolution/Correlation`, `DriftStatus`.
- **Workers**: `detectDrift`, `detectStructuralDrift`, `buildObservedGraph`, `parseDeclaredLayers`, `proposeEvolution`, `attachProductionEvidence`.
- **Hybrid search**: `hybridSearch`.
- **Graph**: `GraphSink`/`NoopGraphSink`, `MemorySink`/`NoopMemorySink`, `GraphBackend`, `MemoryGraphBackend`, `JsonGraphBackend`, `Neo4jGraphBackend`, `openGraphBackend`, `detectConflicts`, `graphImpact`, `projectAdrToGraph`, `serviceFromPath`, node/edge types.
- **Impact**: `IMPACT_ANALYSIS_VERSION`, `ingestImpactAnalysis`, `parseImpactRequest`, `impactFingerprint`, `scoreImpact`, `computeImpactAnalysis`, `runStoredImpactAnalysis`, `storedToResult`, version bump/read, `emptyCodeImpact`, `mergeCodeImpact`, types.
- **Risk**: `RISK_ASSESSMENT_VERSION`, `ingestRiskAssessment`, `parseRiskRequest`, `riskFingerprint`, `scoreMissionRisk`, `runStoredRiskAssessment`, `storedToRiskResult`, `applyFreshness`, `riskLevelFromScore`, `clampScore`, `DEFAULT_RISK_WEIGHTS`, types.
- **Production awareness** (Phase 3): `PRODUCTION_EVENT_TYPES`, `parseProductionEvent`, `ingestProductionEvent`, `correlateProductionEvent`, `GenericWebhookAdapter`, `FixtureAdapter`, `queryProductionMaterialized`, `ProductionSeenSet`, `readCorrelationPolicy`, debug-context readers, `redactRecord`.

### 1.3 Internal architecture (module map)
| Area | Path | Role |
|---|---|---|
| **ADR domain** | `src/domain/adr/{schema,lifecycle,confidence,significance,validation,index}.ts` | ADR schema, status lifecycle, confidence scoring, supersession, deep validation |
| **Events plane** | `src/events/{types,localBuffer,memoryBus,outboxPublisher,index}.ts` | WAL local buffer + outbox publisher → in-memory event bus |
| **Graph** | `src/graph/{backend,memoryBackend,jsonBackend,neo4jBackend,builder,types,conflicts,evidence,graphSink,memorySink,impact}.ts` | **Graph builder** `projectAdrToGraph`; 3 backends (memory / `graph.json` / Neo4j); conflict detection; graph impact correlation |
| **Memory** | `src/memory/{decisionStore,sqliteStore,vectorStore,hybridRetrieve}.ts` | **Decision store** (SQLite canonical); vector embeddings; hybrid ADR search |
| **Context cache** | `src/context/{cache,index}.ts` | Disk+mem prompt-block cache; coding-plane `lookup` reads only |
| **Impact analysis** | `src/impact/{types,ingest,fingerprint,severity,worker,index}.ts` | Async code-blast-radius via `CodeImpactProvider` (Tree-sitter/SCIP), fingerprint dedupe, deterministic severity/recommendation. **No LLM.** |
| **Risk** | `src/risk/{types,ingest,fingerprint,weights,factors,freshness,recommendations,engine,worker,index}.ts` | Mission risk 0–100 aggregate (reuses impact), STALE detection |
| **Production awareness** | `src/production/{schema,ingest,correlate,policy,evidence,debugContext,query,redact,metrics,adapters,index}.ts` | Incidence/deployment/metric/test ingestion → correlation → ADR evidence + graph nodes |
| **Workers** | `src/workers/{pipeline,drift,observedGraph,evolution,production,pool}.ts` | Backgroud pipeline; drift detector; evolution proposer; production evidence attacher |
| **API/subsystem** | `src/api/routes.ts`, `src/subsystem.ts`, `src/flags.ts`, `src/metrics.ts` | HTTP surface + facade + flags |

### 1.4 State owned + databases/tables
- **`.singularity/architecture/architecture.sqlite`** (WAL) — canonical. Tables (from `src/memory/sqliteStore.ts` SCHEMA):
  `architecture_decisions`, `architecture_decision_versions`, `architecture_alternatives`, `architecture_constraints`, `architecture_consequences`, `architecture_evidence`, `architecture_relationships`, `architecture_observations`, `architecture_validations`, `architecture_conflicts`, `architecture_drifts` (+`extra`), `architecture_evolution`, `architecture_embeddings`, `architecture_outbox`, `architecture_kv`, `architecture_production_events`, `architecture_correlations`, `architecture_debug_contexts`, `architecture_impact_analyses`, `architecture_risk_assessments` (+index on mission).
- **`.singularity/architecture/graph.json`** — default graph persistence (`JsonGraphBackend`); rebuildable from ADRs. Optional Neo4j via `NEO4J_URI` (optional dependency, fire-and-forget; reads still hit the JSON/memory fallback).
- **`.singularity/architecture/events.wal`** — local event buffer; `.singularity/architecture/cache/*.json` — precomputed prompt-context cache.
- Source of truth = SQLite; embeddings + graph + cache are derived/rebuildable.
- Fallback in-memory `MemoryDecisionStore` if `node:sqlite` unavailable.

### 1.5 Relay events (subscribed bus types in `subsystem.start()`)
`USER_INTENT_CAPTURED`, `CODE_CHANGE_COMPLETED`, `FILE_CREATED/MODIFIED/DELETED`, `COMMIT_CREATED/PUSHED`, `PR_CREATED/UPDATED/MERGED`, `ADR_CREATED/UPDATED/SUPERSEDED`, `ARCHITECTURE_VALIDATION_REQUESTED`, `ARCHITECTURE_DRIFT_SCAN_REQUESTED`, `ARCHITECTURE_IMPACT_ANALYSIS_REQUESTED`, `ARCHITECTURE_MISSION_RISK_ASSESSMENT_REQUESTED`, `DEPLOYMENT_CREATED`, `TEST_CREATED`, plus `PRODUCTION_EVENT_TYPES` when `production_awareness_enabled`.
Emits (published): `ADR_CREATED`, `ADR_UPDATED`, `ADR_SUPERSEDED`, `ARCHITECTURE_VALIDATION_COMPLETED`, `ARCHITECTURE_IMPACT_ANALYSIS_COMPLETED`, production events, etc. (via bus, forwarded to other planes by `wireArchitectureGovernance`).

### 1.6 Model calls
- **None on the coding hot path.** ADR extraction uses the **LangExtract sidecar** (cheap/structured) with heuristic fallback (`src/extraction/adrExtractor.ts` + `/heuristic.ts`); it does **not** use the primary coding model pool. Impact, risk, drift, evolution, production correlation are **deterministic (no LLM)**. Embedding via `embedText`/hybrid — no gateway model call. This package itself never calls `LlmPort`.

### 1.7 Dependencies on `@singularity/*`
- **`@singularity/cache`** (`file:../cache`), **`@singularity/context`** (`file:../context`) — package.json `dependencies`.
- External: `hono`, `zod`. Optional: `neo4j-driver`.

### 1.8 Callers/consumers (exact bridges)
- **`services/project-intelligence/src/main.ts`** — creates `createArchitectureSubsystem`, wires `graphSink(engine)` + `codeImpactFromEngine(engine)` + memory sink.
- **`vscode/extensions/singularity-ai/src/architectureBridge.ts`** — `startArchitectureDaemon`, `emitArchitectureEvent` (coding-plane void), `lookupArchitectureContext` (cache-read), `listArchitectureForUi`, `architectureNeighborsForUi`, `architectureDbHint`.
- **`packages/intelligence`** — architecture is a **dependency**: `codeImpact.ts` imports `CodeImpactSlice`/`emptyCodeImpact`/`mergeCodeImpact`; `http.ts` imports `mountArchitectureRoutes` + `ArchitectureSubsystem`; `architectureReviewPort.ts` imports `readArchitectureVersion`, `ArchitectureSubsystem`.
- (No consumers import `@singularity/architecture` subpaths other than intelligence + the two daemon hosts; `neural-relay` mentions intelligence, not architecture directly.)

### 1.9 Sync/async
- **Async intelligence plane.** Coding plane only: `buffer.append` (void, fire-and-forget never awaited) + `lookup` (cache only). Never on coding path: ADR extraction, embeddings, SQLite writes, graph writes, hybrid search, LangExtract, production correlation, Tree-sitter/SCIP, impact analysis, risk scoring, graph traversal.
- HTTP ingest (`POST /architecture/*`) returns 202 immediately; `sync: true` runs on the intelligence plane only. `GET` endpoints are materialized/cache reads (never compute).
- Result race documented as `singularity.ai.context` concatenated from precomputed cache (400ms).

### 1.10 User-visible
- **Architecture shell** (`listArchitectureForUi`): graph nodes/edges, ADRs, drift, conflicts. ADR review UI in VS Code. Route surface (on intelligence daemon `127.0.0.1:4781`): `/architecture/decisions{/:id}{/evidence}`, `/architecture/search`, `/architecture/context`, `/architecture/services/:id/decisions`, `/architecture/conflicts`, `/architecture/graph`, `/architecture/validate`, `/architecture/impact-analysis{/:id}`, `/architecture/risk-assessments{/:assessmentId}`, `/architecture/drift{/:id}`, `/architecture/evolution`, `/architecture/evidence`, `/architecture/production/events{/:id}`, `/architecture/production/query`, `/architecture/evidence/:id`, `/architecture/debug/incidents/:id`, `/architecture/metrics`.

### 1.11 Tests
**Present** (not empty) — `packages/architecture/test/`:
- `architecture.test.mjs` (755 LOC), `drift.test.mjs` (183), `impact.test.mjs` (351), `production.test.mjs` (332), `risk.test.mjs` (440). Total ~2061 lines. Run: `npm run test -w @singularity/architecture`.

### 1.12 Duplicates / overlap (see §4)

---

## 2. PACKAGE: `@singularity/intelligence` (architecture/code-impact facets)

### 2.1 Name / Dir / Purpose
- `@singularity/intelligence` — *Context Intelligence Layer — local daemon, graph store, hybrid retrieval*. This report covers **only its architecture/code-graph/impact responsibilities** (the general context facets are covered by the context agent). It provides the **SCIP/Tree-sitter code-blast-radius provider** consumed by `@singularity/architecture` impact/risk workers.

### 2.2 Public API (relevance to this cluster)
- `IntelligenceEngine` (Tree-sitter index, staged bootstrap, `getContext`/`search`/`impact`/`architecture`/`status`), `codeImpactFromEngine` → provides `impactForSymbols`/`impactForFiles` (`CodeImpactSlice` producer for architecture).
- `createArchitectureReviewPort`, `wireArchitectureGovernance` — bridges architecture + outcome planes (see §4.7).
- Graph stores: `MemoryGraphStore`, `SqliteGraphStore`, `openGraphStore`.
- SCIP: `parseScipJson`, `ingestScipDump`, `ingestScipFile`, `applyLspRelations`.
- Client/server: `IntelligenceClient`, `createIntelligenceApp`, `serveIntelligence` (mounts arch+outcome+memory routes).

### 2.2 Internal architecture
- **Engine** (`src/engine.ts`): Tree-sitter/`InMemoryContextGraph` incremental indexer (from `@singularity/prompt`), regex fallback, priority `JobQueue`, stages tree/ast/scip/docs/embeddings/architecture, passive bootstrap. On demand only.
- **Graph store** (`memoryGraphStore.ts`, `sqliteGraphStore.ts`): symbol/file/document nodes + calls/references/defined_in edges, SCIP ingest, LSP enrich.
- **Retriever** (`retriever.ts`): context block format, `impactForSymbol` (callers/callees/tests/files), `retrieveContext`.
- **CodeImpact** (`codeImpact.ts`): adapts engine symbol graph → `CodeImpactSlice` for architecture workers.
- **ArchitectureReviewPort** (`architectureReviewPort.ts`): reads arch graph/store to produce `ArchitectureSignals` for outcome review (see §6.7).
- **Remote engine bridge** (`intelligenceRemoteEngine.ts` in vscode ext) — thin facade over remote worker (read paths async only).

### 2.3 State owned + DB
- **`.singularity/intelligence/graph.sqlite`** — `GraphStore` (files, symbols, docs, adr nodes, edges, stages metadata). Notebook: `hash.ts` sha256 file IDs.

### 2.4 Relay events
- Does **not** own its own event bus; feeds/indexing evented by `notifyFileEvent` (FILE_CREATED/MODIFIED/DELETED). `wireArchitectureGovernance` subscribes to architecture bus and forwards into outcome plane.

### 2.5 Model calls
- **None** — Tree-sitter/scip determinism + regex fallback; skip actual embedding pipeline default. `@singularity/prompt` provides AST extractors (no LLM). The engine is indexing only.

### 2.6 Dependencies on `@singularity/*` (exact)
- `@singularity/prompt`, `@singularity/architecture`, `@singularity/memory`, `@singularity/outcome` (+ `@hono/node-server`, `hono`). It is the **only package that depends on all three of architecture/outcome/memory**.

### 2.7 Callers/consumers
- `services/project-intelligence/src/main.ts` (parent daemon). `vscode/.../intelligenceBridge.ts`, `intelligenceWorkerProcess.ts`, `intelligenceRemoteEngine.ts`, `architectureBridge.ts` (passes engine for graphSink + codeImpact). `packages/neural-relay/src/retrieval/intelligenceIndex.ts` (host already has the engine).

### 2.8 Sync/async
- Index jobs in background `pump`; fast reads never wait on workers. `intelligenceContext` never triggers bootstrap; passive capture keeps index current.

### 2.9 User-visible
- Project Intelligence shell (status bar), symbol search, impact view; Intelligence HTTP `/context`, `/search`, `/symbols`, `/impact`, `/dependencies`, `/architecture`, `/bootstrap`, `/plane/coding-event`.

### 2.10 Tests
- **`packages/intelligence/test/intelligence.test.mjs`** (201 lines) — present, run by `npm run test:intelligence` (points to intel only).

---

## 3. PACKAGE: `@singularity/outcome`

### 3.1 Name / Dir / Purpose
- `@singularity/outcome` — *Outcome Achievement & Requirement Verification Engine* — async intelligence plane that extracts requirements from intent, compiles acceptance criteria, plans + runs verification (command/test/compiler), judges requirements, rolls up a mission outcome, and enforces policy-driven **human review** gate. Canonical `/workspace/.singularity/outcome/outcome.sqlite`.

### 3.2 Public API (index exports)
- Flags/metrics: `OutcomeFlags`, `readOutcomeFlags`, `isOutcomeEngineActive`, `OutcomeMetricsCollector`.
- Domain: types, `judgeCriterion`, `judgeRequirement`, `evidenceIsFresh`, `aggregateOutcome`, `outcomeFromRequirements`.
- Review: `evaluatePolicies`, `applyReviewOverlay`, `canTransitionReview`, `checkReviewerPolicy`, `parseReviewerHeaders`, `reviewFingerprint`, `DEFAULT_REVIEW_POLICIES`, `DEFAULT_REVIEWER_POLICY`, `ArchitectureReviewPort`, `ArchitectureSignals`, `MissionSignals`.
- Events: `OUTCOME_EVENT_TYPES`, `createOutcomeEvent`, `LocalEventBuffer`, `InMemoryEventBus`, `OutboxPublisher`, types.
- Subsystem: `OutcomeSubsystem`, `createOutcomeSubsystem`, `createMemoryStore`.
- Store: `MemoryOutcomeStore`, `openOutcomeStore`, `SqliteOutcomeStore`.
- Extraction/compiler: `heuristicExtractRequirements`, `compileRequirement`, `OutcomeCompiler`.
- Verification: `CommandVerifier`, `TestVerifier`, `CompilerVerifier`, `assertSafeCommand`.
- Evidence: `sanitizeEvidenceText`. Sink: `MemorySink`/`NoopMemorySink`.

### 3.3 Internal architecture (module map)
| Area | Path | Role |
|---|---|---|
| **Domain model** | `src/domain/{types,judge,aggregator}.ts` | Requirements, acceptance criteria, evidence, outcomes; deterministic judge; aggregate/rollup |
| **Mission controller** | `src/mission/controller.ts` | `createMissionRecord`, `draftsToRequirements`, `bumpMission`, lifecycle (CREATED→REQUIREMENTS_EXTRACTED→VERIFICATION_PLANNED→…) |
| **Extract/compile** | `src/extraction/{requirement-extractor,heuristic}.ts`, `src/compiler/outcome-compiler.ts` | Requirement extraction + AC compile (1:1 MVP) |
| **Planning** | `src/planning/verification-planner.ts` | `VerificationPlanner` — plan per criterion (COMMAND/TEST/COMPILER/…), timeouts |
| **Verification** | `src/verification/{adapter,runner,scheduler,exec}.ts` + `adapters/{command,test,compiler}.ts` | runner→adapter dispatch; scheduler (worker pool w/ in-flight dedupe); allowlisted commands |
| **Evidence** | `src/evidence/{collector,sanitize}.ts` | testimony; secret redaction |
| **Review engine** | `src/review/{engine,evaluator,overlay,defaults,evidencePackage,fingerprint,signals,reviewerPolicy,port,transitions}.ts` | policy-driven `ReviewEngine`, ARCHITECTURE/… review-gate, ADR sync, fingerprint staleness |
| **Remediation** | `src/remediation/planner.ts` | `buildRemediation` + `remediation.requested` event (no spawned agent) |
| **Persistence** | `src/persistence/{store,memoryStore,sqlite}.ts` | Outcome store, in-memory + SQLite |
| **Workers** | `src/workers/{pipeline,pool,memorySink}.ts` | `OutcomePipeline` (event→handle), pool |
| **API/subsystem** | `src/api/routes.ts`, `src/subsystem.ts`, `src/flags.ts`, `src/metrics.ts`, `src/ids.ts` | HTTP + facade + flags |

### 3.4 State owned + DB/tables
- **`.singularity/outcome/outcome.sqlite`** — `missions`, `objectives`, `requirements`, `acceptance_criteria`, `verification_plans`, `verification_runs`, `evidence` (insert-only), `outcomes`, `remediations`, `processed_events`, `human_reviews`, `human_review_events`, `review_evidence_packages`, `review_policies`.
- **`.singularity/outcome/events.wal`** buffer; **`.singularity/outcome/cache/latest.json`** prompt/status cache. Fallback in-memory `MemoryOutcomeStore`.

### 3.5 Relay events (subscribed in `subsystem.start()`)
`USER_INTENT_CAPTURED`, `mission.created`, `mission.execution.updated`, `CODE_CHANGE_COMPLETED`, `FILE_CREATED/MODIFIED/DELETED`, `READY_FOR_VERIFICATION`, `verification.requested`, `REVIEW_EVALUATE_REQUESTED`, `REVIEW_REQUIRED`, `REVIEW_STARTED`, `REVIEW_APPROVED`, `REVIEW_REJECTED`, `REVIEW_CHANGES_REQUESTED`, `REVIEW_SUPERSEDED`, `REVIEW_EXPIRED`.
Emits: `mission.*`, `requirements.extracted`, `outcome.compiled`, `verification.planned`, `verification.requested`, `requirement.passed/failed/unknown`, `remediation.requested`, `outcome.achieved/not_achieved/blocked`, `REVIEW_*`.

### 3.6 Model calls
- **None on coding hot path.** `createRequirementExtractor` uses heuristic (no LLM by default; LangExtract optional). The planner/verifier/judge are **deterministic** (allowlisted commands; no LlmPort). Human-review decisions are user-supplied (identity headers). So this package currently makes **no** primary-model calls — the only "intelligence" is heuristic + command execution.

### 3.7 Dependencies on `@singularity/*`
- **`@singularity/context`** (`file:../context`), `hono`, `zod`. Optional dev: typescript.

### 3.8 Callers/consumers
- `services/project-intelligence/src/main.ts` — `createOutcomeSubsystem` + memory sink.
- `vscode/.../outcomeBridge.ts` — start/`emitOutcomeEvent`/remediation replan/`outcomeDbHint`.
- `packages/intelligence/src/http.ts` — `mountOutcomeRoutes` + `OutcomeSubsystem`; `architectureReviewPort.ts` imports `ArchitectureReviewPort` + `OutcomeSubsystem`.
- Runtime: `packages/runtime/src/runtime.ts` fires `onOutcomeCheckpoint` (READY_FOR_VERIFICATION) — outcome is **optional** (catch-only). Runtime does **not** import `@singularity/outcome`.

### 3.9 Sync/async
- Async: coding tick `emit()` (WAL append, never awaited) + cache `lookup()`. Extract→compile→plan→verify→judge→rollup on intelligence plane after OutboxPublisher. Verify endpoints return 202 and never hold the request while tests run. Review decisions append-only and identity-gated.

### 3.10 User-visible
- Mission UI in **Project Context panel** (PASS/FAIL/UNKNOWN + blocking requirements); no dedicated outcome webview yet. Routes (mounted on intelligence daemon): `POST /missions`, `GET /missions/:missionId{/requirements}`, `POST /missions/:missionId/outcomes/compile|verify|reviews/evaluate`, `GET/POST /reviews{/:id/start|approve|reject|request-changes, evidence}`, `GET /requirements/:requirementId{/verify}`, `GET /verification-runs/:id`, `GET /outcome/metrics`.

### 3.11 Tests
- `packages/outcome/test/outcome.test.mjs` (536) + `human-review.test.mjs` (318) — present. Covers judge/aggregator, extraction/compile, command/timeout safety, WAL, sanitize, emit isolation, E2E extract→verify→remediate→reverify, review policy/transitions/auth/stale/overlay, ADR sync; TPS A–F.

---

## 4. DUPLICATES / OVERLAP ANALYSIS (critical)

### 4.1 Who owns "verification" — outcome vs runtime vs brain?
- **`outcome`** owns *mission-scoped, deterministic, evidence-producing verification*: extract→compile AC→plan→run adapters (command/test/compiler)→judge→store `evidence` → rollup `outcomes`. This is the **verification *engine*** (datastore + runner + scheduler + review gate). **KEEP as the engine.**
- **`runtime`** has a separate *LLM-based* verifier: `packages/runtime/src/tools/requirementVerifier.ts` `verifyAgainstRequirements` — a bounded LLM prompt (T2) judging pass/fail/unknown from a checklist, **not written to the outcome store**. Runtime also has `tools/verifier.ts` (deterministic ToolPort typecheck/test). Runtime calls both, and `verifyAgainstRequirements`'s PASS is explicitly **not** written to outcome store (per IMPLEMENTATION_REPORT §1).
- **brain** — no verifier; it's a persistent user-cognitive memory/EMR runtime.
- **Conclusion**: outcome = the *authority store* for requirement/verification truth (missions, criteria, evidence, runs, outcome, review). Runtime's `verifyAgainstRequirements` (LLM) + `tools/verifier.ts` (ToolPort) are **pre-outcome controls** on the hot path. **Verification ownership**: outcome owns the verification *record & gate*; runtime owns *hot-path* verification. This is a **partial duplicate risk not fully reconciled**: two sources of "pass/fail". Recommend outcome become the singleton truth; runtime verify should write PASS/EVIDENCE into outcome rows OR outcome should be the sink. **Classification: outcome = KEEP (verification authority); runtime verifier = keep-hot but must defer/annotate to outcome.**

### 4.2 Who owns "ADR/decision/impact/drift" — architecture vs brain/knowledge/context/wiki?
- **architecture owns**: ADR records, decisions, alternatives, constraints, consequences, conflicts, drifts, evolution, impact analysis, risk, **and the architecture graph** (`ArchNode/Edge`, ADR→Service/File/Commit/PR/Test/Incident). Deterministic, GraphBackend+SQLite. **This is the system-of-record for ADR/decision/impact/drift. KEEP.**
- **context** (`@singularity/context`) ALSO stores architectural decisions: `context.json` `architecture_decisions[]/decision/supersedes` (merge.ts, format.ts, retrieval.ts). **Overlap with architecture ADR.** The `@singularity/context` decision store is the older, prompt-visible decision ledger; architecture ADRs are the richer structured plane. **MERGE/align**: architecture should be the primary; context could project a lighter decision block from ADRs.
- **memory** domain also carries `ARCHITECTURAL_DECISION` / `ARCHITECTURAL_CONSTRAINT` / `TECHNOLOGY_CHOICE` / `REJECTED_APPROACH` types and accepts architecture ADRs via the memory sink (`architecture.decision` event). **Overlap** — memory is the *derived/long-term* cache of architecture decisions, not authoritative. Legit as a consumer only. **KEEP architecture as authoritative, memory as projection.**
- **wiki** (`packages/wiki`) holds markdown docs / decision records likely via frontmatter; **not** a duplicate actor for ADR*store* but may ingest ADRs. Not a data-owner of `architecture.sqlite`.
- **design** (`packages/design`) holds design DNA/spec for frontend lane; separate concern — not decision memory (no ADR store). No overlap.

### 4.3 Who owns "observation/outcomes"? outcome vs anything else?
- **outcome** owns `Outcome` rows + `outcomes` table + `evidence` (the empirical mission outcome: pass/fail counts, score, status). CLEAR owner. KEEP.
- **architecture** also owns a "observation" concept → `architecture_observations` table (`Observation` `DecisionStore.insertObservation/listObservations`). architecture observations are *architecture-quality observations* (declared/observed drift signals), not mission outcomes. **Semantically distinct** but name collision `observation` (arch Observation vs outcome Outcome). Mark **RENAME** to avoid the overlap.
- **runtime** synthesizes a user-facing outcome (`synthesis/synthesizer.ts`, `FinalSynthesizer`, `EventOutcome`) and runtime `types.ts` `synthesized_outcome`. This is *display* outcome aggregation; not a store-of-record. Keep runtime synth; outcome is the record.

### 4.4 outcome's mission/controller.ts, verification/scheduler, planning/verification-planner vs runtime's mission/lane/scheduler/planner/verifier
- **outcome/mission/controller.ts** = `createMissionRecord` + lifecycle bumps for the *outcome engine* mission (its own SQLite mission table). Runtime has its own missions (scheduler/planner `ExecutionPlan`/`TaskNode`, `mission/workflow.ts`, `mission/remediation.ts`). These are **two separate mission concepts**:
  - **outcome mission** = verification unit (mission_id + requirements + outcome);
  - **runtime mission/plan** = execution DAG of coding subagents with `createExecutionPlan`, `runScheduler`, ToolPort verify, synthesize.
  runtime does NOT import outcome; they communicate only via fire-and-forget `onOutcomeCheckpoint`. There is **no shared mission ledger** — runtime `mission_id` vs outcome `mission_id` differ (runtime issue: checkpoint lacks `mission_id`; outcome uses "active mission"). **This is a real seam/overlap**: two mission runtimes with weak linkage. Recommend outcome "mission" be reframed as **verification-group/scenario** OR runtime's outcome checkpoint carry the mission id so the same mission is verified.
- `verification-planner` vs runtime `planner/planner.ts`: outcome planner produces *verification plans* (command/test/compiler per criterion); runtime planner produces *execution task plans*. Not the same job but similar name — worth explicit naming (verification-planner vs execution-planner) to avoid confusion. No functional duplicate.
- `verification/scheduler.ts` vs runtime `scheduler/scheduler.ts`: outcome scheduler is a *worker pool for verification runs*; runtime scheduler is the **DAG task orchestrator**. Different. No change needed but naming overlap.

### 4.5 Duplicate architecture/integration surface
- `intelligence/architectureReviewPort.ts` `wireArchitectureGovernance` forwards `ADR_CREATED/UPDATED/ARCHITECTURE_IMPACT_ANALYSIS_COMPLETED` → `REVIEW_EVALUATE_REQUESTED` into outcome (so BDRC/review gate reacts to ADR + impact). That's a **cross-plane data handoff**, not a duplicate.

### 4.6 Who owns "impact"? architecture.
- `architecture/impact/*` (deterministic, GraphBackend+CodeImpactProvider) + `intelligence` provides the underlying symbol graph via `codeImpactFromEngine`. No other package computes architecture impact. KEEP in architecture; intelligence is the provider.

### 4.7 Observation/outcome naming hazard
- `architecture.sqlite` has `architecture_observations` (arch quality observation) while `outcome.sqlite` has `outcomes` (mission outcome). Recommendations rename architecture's `Observation`→`ArchObservation` to avoid collision.

---

## 5. OVERALL CLASSIFICATION (per package + submodule)

### @singularity/architecture
- **KEEP** (system of record for architecture model: ADR/decisions/impact/drift/risk/conflicts/evolution; no LLM; off hot path).
- Submods:
  - `graph/*` (GraphBackend, builder, json/neo4j/memory) — **KEEP** (the architecture model).
  - `impact/*` + `risk/*` — **KEEP** (deterministic intelligence; no duplicate).
  - `production/*` — **KEEP** but this is almost a distinct "reactive observability" plane; could be **MOVE** into a separate observability/sidecar package if it grows. Currently a lightly-coupled sidecar.
  - `drift`/`observedGraph` — **KEEP**.
  - `context/cache`, `events/*`, `memory/{sqliteStore,vectorStore,hybridRetrieve}` — **KEEP** (owned by architecture ADR plane).
- **DECISION TABLE final**: **KEEP** (whole package). Submodule note: `production/*` → consider **MOVE** to its own `@singularity/observability` later; not a shared-duplicate.

### @singularity/outcome
- **KEEP — Verifi Authority** (mission verification engine, review gate, evidence truth). This is nearest to "Verification Engine consolidates verification" target.
- Submodes:
  - `verification/*`, `planning/verification-planner`, `domain/judge`, `evidence/*` — **KEEP** (engine core).
  - `mission/controller.ts` — **MERGE/MOVE** toward a shared mission-verification model so `runtime` (execution mission) and `outcome` (verification mission) link by mission_id (see §4.4). Mark **MOVE-outcome-mission into a mission*segment / rename to verification-group**.
  - `review/*` — **KEEP** (human-review gate is outcome-domain). Could later MOVE if a governance plane is spun up.
  - `extraction`, `compiler` — **KEEP** (but LLM compiler is MVP; consider delegating extraction to `@singularity/context`/LangExtract).
- Final classification: **KEEP** (engine) with **MOVE (rename)** of `mission/controller` to a shared/mission-verification contract + `review/*` merge into consolidated verification gate.

### @singularity/intelligence (architecture facets)
- Symbol/Code graph + SCIP: **KEEP** — it is the *code-blast provider* for architecture impact/risk; no duplicate.
- `architectureReviewPort.ts` + `wireArchitectureGovernance` — integration glue (keep; could flatten into architecture/outcome so cross-plane handoff lives with outcome).
- `codeImpact.ts` — **KEEP** (adapter).
- Classification: **KEEP** (whole), note `intelligenceRemoteEngine` (vscode) is consumer-side facade (KEEP in vscode ext, not core pkg).

### Unclear/split
- **`@singularity/context` decision store** (`architecture_decisions`) — **MERGE/de-dup into architecture ADR** (architecture is richer/authoritative). Recommended: context becomes a **read-free/cache projection** or emits events to architecture; drop its own `decisions.json`.
- **`@singularity/memory` ARCHITECTURAL_DECISION/CONSTRAINT/TECHNOLOGY_CHOICE/REJECTED_APPROACH** — **MERGE/de-dup with architecture** (memory is a sink, not source). Keep memory as *projection*.
- **`@singularity/runtime` `verifyAgainstRequirements`/`tools/verifier`** — **KEEP hot-path** but outcome is the authority; alias them as "hot-path pre-verif" and route results into outcome rows/EVIDENCE when active.

### who owns what — clear answers
- **Verification**: outcome (authority store; engine). Runtime's LLM+ToolPort verify = hot-path, must defer/annotate to outcome.
- **ADR/decision/impact/drift**: architecture (authoritative). Context acts a cache; memory a projection; wiki a doc surface.
- **Observation/outcome**: outcome owns mission *outcome*; architecture owns architectural *observations*. Rename architecture Observation.

---

## 6. CONSUMER GRAPH SUMMARY (bridge wiring)

```
services/project-intelligence/src/main.ts
  ├─ IntelligenceEngine (intelligence)
  ├─ ArchitectureSubsystem + graphSink(engine) + codeImpactFromEngine(engine) + memorySink(→memory)
  └─ OutcomeSubsystem + memorySink(→memory)
       └─ server = serveIntelligence(engine,{port},architecture,memory,outcome)  # mounts arch+outcome+memory routes

vscode : singularity-ai
  ├─ architectureBridge.ts  (start/emit/lookupCache/UI snapshot)
  ├─ outcomeBridge.ts       (emitOutcomeEvent / remediationReplan)
  ├─ intelligenceBridge.ts / intelligenceWorkerProcess.ts / intelligenceRemoteEngine.ts (remote IntelligenceEngine facade)
  ├─ memoryBridge.ts, runtimeBridge.ts, contextEngineBridge.ts (context plane; not scope)

packages/intelligence
  ├─ http.ts               → mountArchitectureRoutes + mountOutcomeRoutes + wireArchitectureGovernance
  ├─ architectureReviewPort.ts → architecture→outcome governance handoff
  ├─ codeImpact.ts         → architecture adapt(SCIP/Treesitter)
  └─ (memory, outcome as deps)

packages/runtime (not importer)
  → optional onOutcomeCheckpoint fires READY_FOR_VERIFICATION into outcome plane (catch-only)
```

---

## 7. TESTS status (correcting prompt assumption)
- `packages/architecture/test/` — **5 files, ~2061 lines** (architecture, drift, impact, production, risk).
- `packages/outcome/test/` — **2 files, 854 lines** (outcome, human-review).
- `packages/intelligence/test/` — **1 file, 201 lines**.
- The prompt's "empty test dirs" is **incorrect**; all three have real `.mjs` tests.

---

## 8. Quick reference — package manifests
| Pkg | version | depends |
|---|---|---|
| `architecture` | 0.1.0 | cache, context, hono, zod, (neo4j-driver opt) |
| `intelligence` | 0.1.0 | prompt, architecture, memory, outcome, @hono/node-server, hono |
| `outcome` | 0.1.0 | context, hono, zod |

All three: `node >=18`, tsconfig build → `dist/`, main `dist/index.js`, types `dist/index.d.ts`.