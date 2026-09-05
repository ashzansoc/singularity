# NEURAL RELAY MAP (I) and MEMORY MAP (J)

## I. Relay/Event Map — producer → event → consumer

### CURRENT (fragmented — each plane own bus):
| Plane | Producer emits | Events | Consumer subscribes |
|---|---|---|---|
| architecture | subsystem/workers | ADR_CREATED/UPDATED/SUPERSEDED, ARCHITECTURE_VALIDATION_COMPLETED, IMPACT_COMPLETED, production events, drift, evolution | intelligence gateway (wireArchitectureGovernance), memory sink (architecture.decision), outcome review |
| memory | memoryBridge (coding events), architecture/outcome sinks | USER_INTENT_CAPTURED, CODE_CHANGE_COMPLETED, FILE_*, COMMIT_*, ADR_* (25 types) | MemoryPipeline (→ dedup→consolidate→store) |
| outcome | runtime onOutcomeCheckpoint, extension | mission.created/execution.updated, requirements.extracted, verification.requested/planned, requirement.passed/failed, remediation.requested, outcome.achieved/blocked, REVIEW_* | OutcomePipeline (→ judge→store→review gate) |
| runtime | engine.run | RuntimeEventKind (~55: plan/task/subagent/agent/workflow/verify/lock/integrate) | events/store → chatAdapter → Chat UI + IntelligenceShell |
| intelligence | daemon | /plane/coding-event → fans to arch/mem/outcome | architecture presentation |

### TARGET (ONE Neural Relay event fabric):
producer → publish(NeuralRelay) → subscribers
- ALL planes publish inter-plane traffic through ONE relay: USER_INTENT_CAPTURED, mission.*, ADR_*, verification.*, outcome.*, REVIEW_*, CODE_CHANGE_*, FILE_*.
- Neural Relay = transport only (no business logic/planning/retrieval/verification).
- Current packages' InMemoryEventBus+OutboxPublisher+LocalEventBuffer (architecture/memory/outcome) → MERGE into ONE relay implementation.

## J. Memory Map — storage → owner → write path → retrieval path → consolidation

| Knowledge store | Current owner | Write path | Read/retrieval | Consolidation |
|---|---|---|---|---|
| Project state (requirements/constraints/decisions) | @singularity/context (project-context JSON) | LangExtract sidecar / heuristic → merge | context getRelevant; cgE bridge | context merge/supersede |
| Typed project memory (facts/prefs/arch lessons) | @singularity/memory (memory.sqlite + Postgres/pgvector/Neo4j/mem0) | coding events → outbox → pipeline | MemoryRanker hybr | workers/dedup+conflict+consolidation |
| User-level cognitive graph (semantic/episodic/procedural/arch) | @singularity/brain (brain.sqlite) | observeChat/file → runtime loop → extraction | brainSearch (vector+graph) | BrainRuntime + importance + cognitive |
| Code symbol graph + impact | @singularity/intelligence (graph.sqlite) | Tree-sitter/SCIP staged | retriever hybrid | staged pipeline |
| Markdown knowledge base | @singularity/wiki (markdown) | ingest | searchPages | hub/synthesis/contradictions |
| Prompt memory (working/session/project) | @singularity/prompt (in-memory) | run compile | SemanticRetrievalEngine | learning engine |

### TARGET memory ownership (Brain consolidates):
- Brain = single canonical knowledge owner: user (brain) + project (memory merges in) + code graph (intelligence) + wiki + prompt working memory.
- Storage engines (sqlite/postgres/pgvector/neo4j/mem0/json) become connectors behind the Brain.
- Memory retrieval: Brain.expose retrieve → Context Engine decides relevance NOW.
- Memory consolidation: Brain.consolidate (fold memory workers + brain importance + learning).
- Brain API: brain.remember / brain.retrieve / brain.update / brain.relate / brain.consolidate / timeline / forget.
