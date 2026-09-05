# CLASSIFICATION MATRIX — every subsystem → KEEP / MERGE / MOVE / REPLACE / DEPRECATE / DELETE / UNKNOWN

## Top-level packages
| Pkg | Class | Rationale (primary target) |
|---|---|---|
| @singularity/router | KEEP | Model Router owner; hot-path hub (SingularityAI). MOVE-out: none. |
| @singularity/prompt | KEEP | Context Engine retrieval/assembly authority; MOVE indexer/graph → Brain knowledge. |
| @singularity/cache | KEEP | I/O reuse layer (Runtime Observability + cache infra). |
| @singularity/context | KEEP (narrow) | Brain/Context *intake* (extract→merge→store); retrieval/relevance/format → MERGE into prompt. |
| @singularity/wiki | KEEP | Brain knowledge store (markdown); search/query assembly → MERGE into Context. |
| @singularity/intelligence | KEEP | Brain project graph/SCIP + deep-path daemon; retriever.format → MERGE into Context. |
| @singularity/architecture | KEEP | Architecture Intelligence owner (ADR/decisions/impact/risk/drift/graph). |
| @singularity/outcome | KEEP | Verification Engine authority + Observation (outcomes) + review gate. |
| @singularity/memory | MERGE | project-scoped project memory → fold into Brain; keep sqlite/pg/neo4j/mem0 as connectors. |
| @singularity/brain | KEEP | The one Brain (semantic+episodic+procedural+architectural). |
| @singularity/neural-relay | REPLACE/REHOME | NOT an event fabric; it is context minimization → Context/Model-Router concern; metrics → Observability. |
| @singularity/runtime | KEEP | Mission Engine + Agent Runtime + Tool Runtime + fast-path; events/chatAdapter → Chat Runtime. |
| @singularity/design | KEEP | Frontend design lane owned by Agent Runtime's frontend workers; special knowledge/tools. |

## Key dry-hits (rule 7 - duplicate detection)
| Duplicate | Canonical owner |
|---|---|
| Event bus (architecture/memory/outcome InMemoryEventBus+OutboxPublisher+WAL) | Neural Relay (1 shared transport) |
| Model client (router providers vs brain modelClient vs neural-relay Nemotron vs design agency vs chat SingularityAutoRouter) | Model Router (router providers + shared decision clients) |
| Tier→model tables (router catalog vs runtime llm.ts TOKENROUTER_TIER_MODELS vs chat SingularityRouterBridge SUB_TIER_MODELS) | Model Router (catalog.ts single source) |
| Retrieval+rank+assembly (context+prompt+intelligence+wiki) | Context Engine (prompt pipeline; others = knowledge stores) |
| Verifier (runtime tools/verifier+requirementVerifier vs outcome verification) | Verification Engine (outcome authority; runtime hot-path pre-check) |
| Mission state (runtime in-memory vs outcome durable) | Mission Engine (durable outcome mission + runtime view) |
| Fastpath classifier vs router classifier | Model Router (one "route as fast" decision) |
| Architecture decision (context dec_store + memory ARCHITECTURAL_DECISION vs architecture ADR) | Architecture Intelligence |
| Cache (memory hub vs cache vs neural-relay cacheStatus) | Runtime Observability / cache infra |
| Architecture observations vs outcome observations | Observation Engine (rename arch→ArchObservation) |

## Per-component classification detail
See the 7 cluster reports (.arch-inventory/*.md) for per-file classification of every subsystem, with exact paths.
