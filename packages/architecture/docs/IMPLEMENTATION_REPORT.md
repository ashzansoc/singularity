# Architecture Intelligence & Decision Memory — Phase 1 Report

## What shipped

An asynchronous Architecture Intelligence plane that records **why** a system is designed the way it is, without touching the coding LLM hot path.

Canonical store is **SQLite** (`<workspace>/.singularity/architecture/architecture.sqlite`). Embeddings, graph projection, and the context cache are derived and rebuildable.

## Files added

- [`packages/architecture/**`](../../packages/architecture) — `@singularity/architecture`
- [`vscode/extensions/singularity-ai/src/architectureBridge.ts`](../../vscode/extensions/singularity-ai/src/architectureBridge.ts)
- [`benchmarks/architecture-intelligence/`](../../benchmarks/architecture-intelligence)

## Files modified

- Root `package.json` (build / test / typecheck)
- [`packages/intelligence/src/http.ts`](../../packages/intelligence/src/http.ts) — mounts `/architecture/*`
- [`vscode/extensions/singularity-ai`](../../vscode/extensions/singularity-ai) — fire-and-forget events, cache inject, ADR review UI, settings
- [`vscode/extensions/singularity-chat/.../singularityPromptEngineBridge.ts`](../../vscode/extensions/singularity-chat/src/platform/endpoint/node/singularityPromptEngineBridge.ts) — documents cache-only inject
- [`services/project-intelligence/src/main.ts`](../../services/project-intelligence/src/main.ts)

## Hot-path contract

Coding request:

1. `LocalEventBuffer.append` (void, never awaited)
2. `lookup` / `lookupCachedContextBlock` (disk/memory cache only)
3. Coding LLM

Never on the coding path: ADR extraction, embeddings, SQLite writes, graph writes, hybrid search, LangExtract, production correlation, Tree-sitter/SCIP, impact analysis, mission risk scoring, architecture graph traversal.

Singularity inject remains `singularity.ai.context.relevant` with a **400ms** race. Architecture context is concatenated there from the precomputed cache.

Hot files (`automodeService`, `toolCallingLoop`, prompt bridge) are grep-tested so they cannot import architecture workers/extraction/sqlite/vector/production correlator modules.

## Flags

| Flag / setting | Default |
|---|---|
| `ARCHITECTURE_MEMORY_ENABLED` / `singularity.ai.architecture.enabled` | true |
| `ADR_EXTRACTION_ENABLED` / `architecture.extractionEnabled` | true |
| `ARCHITECTURE_GRAPH_ENABLED` | true |
| `ARCHITECTURE_VECTOR_SEARCH_ENABLED` | true |
| `ARCHITECTURE_CONTEXT_ENABLED` | true |
| `ARCHITECTURE_DRIFT_DETECTION_ENABLED` | true (Phase 3) |
| `ARCHITECTURE_CONFLICT_DETECTION_ENABLED` | true (Phase 2) |
| `ARCHITECTURE_EVOLUTION_ENABLED` | true (Phase 3) |
| `PRODUCTION_AWARENESS_ENABLED` / `architecture.productionAwarenessEnabled` | true |

Any subsystem can fail; coding continues. Production Awareness is never on the Coding Agent path (no extra tool/model calls, no graph writes, no production API waits).

## API (intelligence daemon, default `127.0.0.1:4781`)

- `GET/POST/PATCH /architecture/decisions`
- `GET /architecture/decisions/:id/evidence`
- `GET /architecture/search` (explicit hybrid — not per token)
- `GET /architecture/context?entity=` (cache only; never dumps production events)
- `GET /architecture/services/:id/decisions`
- `GET /architecture/conflicts`
- `POST /architecture/validate` (queues event)
- `POST /architecture/impact-analysis` (async ingest, 202 `{ analysis_id, status: queued }`; `sync: true` runs on the intelligence plane only)
- `GET /architecture/impact-analysis` (list, or cache-only lookup via `?change=`/`?files=`/`?symbols=`)
- `POST /architecture/risk-assessments` (async ingest, 202 `{ assessment_id, status: queued, assessment_status: PENDING }`; `sync: true` runs on the intelligence plane only)
- `GET /architecture/risk-assessments` (list, `?mission_id=`, or cache-only `?change=`/`?files=`/`?symbols=`)
- `GET /architecture/risk-assessments/:assessmentId` (materialized status/result; STALE on version mismatch, never computes)
- `GET /architecture/graph?entity=`
- `POST /architecture/conflicts`
- `GET /architecture/drift`
- `GET /architecture/drift/:id`
- `PATCH /architecture/drift/:id` (`open` | `acknowledged` | `resolved` | `false_positive`)
- `POST /architecture/drift` (queues `ARCHITECTURE_DRIFT_SCAN_REQUESTED`; `sync: true` runs on the intelligence plane only)
- `GET/POST /architecture/evolution`
- `POST /architecture/evidence` (queues; `sync: true` correlates on the intelligence plane only)
- `POST /architecture/production/events` (canonical async ingest, 202)
- `GET /architecture/production/events/:id`
- `GET /architecture/production/query?q=incidents` (materialized graph/store only)
- `GET /architecture/evidence/:id`
- `GET /architecture/debug/incidents/:id` (pull-only reactive debug context)
- `POST /architecture/validate` (`sync: true` runs deep validation immediately on the intelligence plane)

## Persistence

```
.singularity/architecture/
  architecture.sqlite   ← source of truth
  events.wal            ← local buffer
  cache/*.json          ← precomputed prompt context
```

SQLite additions (Phase 3 fill-gaps): `architecture_production_events` (idempotent raw events), `architecture_correlations` (confidence + reasons), `architecture_debug_contexts` (derived incident summaries), drift `extra` JSON (`status`, `confidence`, `declared`/`observed`).

Impact analysis rows live in `architecture_impact_analyses` (fingerprint, status, request, result, severity, recommendation). Do not store source snapshots; repository/commit references are enough.

## Correlation policy (env)

| Variable | Default |
|---|---|
| `PRODUCTION_DEPLOYMENT_LOOKBACK_MS` | 30m |
| `PRODUCTION_METRIC_LOOKBACK_MS` | 30m |
| `PRODUCTION_INCIDENT_WINDOW_MS` | 30m |
| `PRODUCTION_MAX_PAYLOAD_BYTES` | 65536 |
| `PRODUCTION_RETENTION_RAW_MS` | 7d |
| `PRODUCTION_RETENTION_EVIDENCE_MS` | 90d |

Secrets in payloads are redacted (`token`, `password`, `authorization`, …) before persist. Raw events are pruned by retention; derived evidence/summaries live longer.

## Isolation verification

**Can the coding agent generate and execute code without waiting for production-event ingestion, correlation, evidence generation, architecture drift detection, or impact analysis?** **Yes.**

The coding tick remains `append()` (void) + cache `lookup()`. Production ingest, correlation, reactive debug assembly, drift scans, impact analysis, and mission risk scoring run only in `ArchitecturePipeline` after `OutboxPublisher`. Failures in those workers do not throw into the coding path. Production evidence is never auto-injected into every prompt; debug context is pull-only via `GET /architecture/debug/incidents/:id`. Impact results are pull-only (`GET /architecture/impact-analysis/:id` or cache-only `lookupImpact`). Risk assessments are pull-only (`GET /architecture/risk-assessments/:id` or cache-only `lookupRisk`).

## Model routing

ADR extraction uses the LangExtract sidecar (cheap/structured) with heuristic fallback. It does **not** use the primary coding model pool.

## Phase 2 (graph, evidence, conflicts)

Shipped on top of Phase 1, still off the coding hot path:

- First-class architecture graph (`GraphBackend`): Service / File / Commit / PR / Constraint nodes and `AFFECTS`, `IMPLEMENTED_BY`, `SUPERSEDES`, `CONFLICTS_WITH`, `REJECTED_ALTERNATIVE`, …
- Default persistence: `.singularity/architecture/graph.json` (rebuildable from ADRs). Optional `Neo4jGraphBackend` behind `NEO4J_URI` (no driver required yet).
- Git/PR evidence attached to matching ADRs (`COMMIT_*`, `PR_*` events).
- Conflict detection (default **on**): replace-X-with-Y vs rejected alternatives; pairwise ADR contradictions. `POST /architecture/conflicts`. Cached into prompt context.
- Graph-backed impact correlation (`graphImpact`) reused by the async impact worker; `GET /architecture/graph`.
- Default hybrid search returns **ACTIVE** decisions only; `?historical=1` includes superseded.
- `supersede(oldId, newId)` writes `SUPERSEDES` and keeps the old ADR searchable historically.

## Phase 3 (drift, validation, production evidence, evolution)

Shipped on top of Phase 2, still off the coding hot path:

- Drift detector compares declared ADRs to workspace source (`rejected_in_use`, `constraint_violation`, `missing_declared`, `missing_implementation`, `undeclared_dependency`). File changes **mark architecture stale**; scans run in the background (incremental on affected files). `POST /architecture/drift` queues unless `sync: true`.
- Structural drift compares declared layers (`API → Service → Repository`) and isolation constraints against observed imports.
- Deep validation uses evidence + drift (not a rubber stamp). Implemented ADRs can move to **validated**; high drift or repeated incidents fail.
- Production evidence: `INCIDENT_REPORTED`, `METRIC_OBSERVED`, `DEPLOYMENT_*`, `TEST_*` attach to matching ADRs and the graph (`Incident` / `Deployment` / `Metric` nodes).
- Correlations are scored (HIGH/MEDIUM/LOW) with explicit reasons. Weak string overlap is not stored as fact.
- `INCIDENT_REPORTED` enqueues reactive debug context (recent deployments, metrics, ADRs, drift, potential causes) without modifying code.

## Production Awareness Engine

Asynchronous sidecar of the Architecture Plane. Coding Agent dependencies: **none**.

Flow: adapter → `ingestProductionEvent` (validate + enqueue + return) → OutboxPublisher → normalizer/correlator → Context Graph.

- Canonical `ProductionEvent` types include deployments (started/succeeded/failed/rolled back), incidents (reported/updated/resolved), metrics (observed/threshold/recovered), tests (started/passed/failed/regression).
- Correlation is deterministic and **confidence-aware** (commit, service, repo, deployment, ADR, graph node, configurable lookback). Co-occurrence is `TEMPORALLY_CORRELATED_WITH` / `CORRELATED`, never `CAUSED`.
- Evidence types: `OBSERVED` / `REPORTED` / `MEASURED` / `TESTED` (facts) vs `CORRELATED` / `INFERRED` (engine links). Inferences are not stored as facts.
- Graph nodes: `Deployment`, `Incident`, `MetricObservation`, `TestExecution`, `Environment`. ADR→Deployment uses `RELATED_TO_DEPLOYMENT`; Deployment→Environment uses `DEPLOYED_TO`.
- Adapters: `ProductionEventAdapter` + `GenericWebhookAdapter` + `FixtureAdapter`. GitHub/K8s/Datadog/etc. are slots only.
- Queries read materialized state (`GET /architecture/production/query`). No live monitoring APIs.
- Disable with `PRODUCTION_AWARENESS_ENABLED=false`. Ingest is a no-op; coding is unchanged.

Never on the coding path: production ingest correlation, graph mutation, provider HTTP, extra planner/tool/LLM steps.
- Automated **evolution proposals** create `proposed` candidate ADRs. Accepted decisions are never auto-superseded.

## Impact Analysis (Intelligence Plane)

**Impact Analysis is an Intelligence Plane capability. It is asynchronous and must never block the Coding Agent execution path.**

```
Developer / API
  → POST /architecture/impact-analysis  (validate + fingerprint + enqueue + 202)
  → Architecture WAL / OutboxPublisher
  → Impact worker (Tree-sitter/SCIP via CodeImpactProvider, architecture graph, ADRs, constraints, conflicts, drift)
  → persist + fingerprint cache
  → GET /architecture/impact-analysis/:id
```

Synchronous vs asynchronous:

| Path | Allowed |
|---|---|
| Coding Agent | `emit()` + `lookup()` / optional `lookupImpact()` cache read. Cache miss returns empty; never computes. |
| Intelligence HTTP ingest | Validate, assign `analysis_id`, enqueue. No Tree-sitter, SCIP, graph walk, or ADR correlation before return. |
| Intelligence worker | Symbol blast radius (`POST /impact` / `impactForSymbol`), `graphImpact`, conflicts, drift, deterministic severity + recommendation. |
| `sync: true` | Worker runs on the intelligence plane only (same as drift/production). |

`POST /impact` remains the lower-level symbol/code blast radius. Architecture impact **reuses** it through `CodeImpactProvider`; it does not duplicate Tree-sitter/SCIP.

Fingerprint (not the prompt-cache `fp_v1`): `sha256(repository, commit, files, symbols, change, architecture_version, IMPACT_ANALYSIS_VERSION)`. ADR/file/drift mutations bump `architecture_version`. Duplicate in-flight fingerprints return the existing id. Completed fingerprints are cache hits.

Severity (`low` / `medium` / `high` / `critical`) and recommendation (`SAFE_TO_PROCEED` / `PROCEED_WITH_TESTS` / `REVIEW_REQUIRED` / `ARCHITECTURE_REVIEW_REQUIRED` / `DO_NOT_PROCEED`) are deterministic from counts of symbols, services, public API, ADR/constraint hits, conflicts, and drift. Reasons are evidence strings, not “large change”. No LLM on this path.

Retries: `OutboxPublisher` re-appends on bus failure. Workers are idempotent on `analysis_id` / fingerprint. Failed rows can be re-queued. Pipeline errors never throw into coding.

Metrics: `impact_analysis_queued_total`, `completed_total`, `failed_total`, `duration`, `cache_hits` / `misses`, `affected_symbols` / `affected_services`, severity buckets. Correlate via `trace_id` + `analysis_id`.

## Still optional adapters

- Live Neo4j Bolt driver / Postgres pgvector adapter (interfaces exist; local default remains SQLite + `graph.json`)

## Tests

```bash
npm run test -w @singularity/architecture
```

Latest `benchmarks/architecture-intelligence/METRICS.json` (100 concurrent mock coding ticks):

| Scenario | Mean latency | Approx TPS |
|---|---|---|
| A disabled | ~0.001ms | ~115k |
| B enabled | ~0.031ms | ~30k |
| C queue pressure | ~0.025ms | ~36k |
| D store failure | ~0.032ms | ~29k |
| E embeddings off | ~0.025ms | ~38k |

| F production queue pressure | same band as B |
| G correlation broken | same band as B |
| H impact-analysis queue pressure | same band as B |
| I mission-risk queue pressure | same band as B |

Enabled vs overloaded vs failed intelligence stay in the same ~0.03ms band. The coding tick is `append()` + cache `lookup()` only. Scenarios F–I prove Production Awareness enqueue, correlation failure, impact-analysis enqueue, and mission-risk enqueue do not add graph mutations, Tree-sitter/SCIP, risk scoring, or extra synchronous work to that tick.

## Mission Risk Scoring (Intelligence Plane)

**Mission Risk Scoring is an Intelligence Plane capability; it is asynchronous and must never block the Coding Agent execution path.**

Impact analysis remains the blast-radius API (`POST/GET /architecture/impact-analysis`). Mission risk **aggregates** impact, ADRs (`risks[]` unchanged), constraints, conflicts, drift, production events, historical assessments, verification hints, complexity, and cached prompt-simulator scores into an explainable 0–100 score.

```
Developer / API
  → POST /architecture/risk-assessments  (validate + fingerprint + enqueue + 202 PENDING)
  → Architecture WAL / OutboxPublisher
  → Risk worker (reuse computeImpactAnalysis / stored impact; read ADRs, conflicts, drift, production)
  → persist RiskAssessment + snapshot
  → GET /architecture/risk-assessments/:id  (READY / STALE / FAILED; GET never computes)
```

| Path | Allowed |
|---|---|
| Coding Agent | `emit()` + `lookup()` / optional `lookupRisk()` cache read. Miss returns empty; never scores. |
| Intelligence HTTP ingest | Validate, assign `assessment_id`, enqueue. No graph walk, impact, correlation, or LLM before return. |
| Intelligence worker | Compose existing signals; deterministic weighted factors; recommendations from contributors. |
| `sync: true` | Worker runs on the intelligence plane only. |

`assessment_status`: PENDING (queued/running), READY (completed + matching `source_versions`), STALE (architecture/production versions drifted; detected on read), FAILED.

Score = clamp(sum(weight_i × dimension_score_i) + mitigations, 0, 100). Thresholds: 0–24 LOW, 25–49 MEDIUM, 50–74 HIGH, 75–100 CRITICAL. Weights live in `DEFAULT_RISK_WEIGHTS` / `ARCHITECTURE_RISK_WEIGHTS_JSON`. Prompt simulator and ADR `risks[]` are inputs, not replaced.

Fingerprint: `sha256(mission, repository, commit, files, symbols, services, change, prompt_risk, architecture_version, RISK_ASSESSMENT_VERSION)`. History is insert-only (`architecture_risk_assessments`, nullable `outcome_json` for future calibration).

Metrics: `risk_assessments_total`, `risk_assessments_by_level_*`, `risk_assessment_latency`, `risk_assessment_failures`, `risk_assessment_staleness`, `risk_factor_distribution`, `risk_recomputation_total`, `risk_cache_hits` / `misses` / `hit_rate`. Correlate via `trace_id` + `assessment_id` + `mission_id`.

