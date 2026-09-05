# SINGULARITY TARGET ARCHITECTURE — 14 Canonical Systems

Mapping of the 14 target systems → canonical owner package + how the *current* packages/fragments consolidate into it.

| Target System | Canonical owner package(s) | Consolidates (current) |
|---|---|---|
| 1. Chat Runtime | @singularity/runtime events/store + chatAdapter + progress + runtimeChatParticipant | runtime events/chatAdapter, extension chat presenter |
| 2. Neural Relay (event fabric) | (NEW shared singleton bus in packages/neural-relay or a new packages/relay) | triplicated architecture/memory/outcome InMemoryEventBus+OutboxPublisher+WAL |
| 3. Brain | @singularity/brain (BrainEngine+Store+SemanticMemoryApi+Runtime) | MERGE @singularity/memory (project memory) as a project scope; keep Postgres/Neo4j/mem0 as connectors; intelligence graph.sqlite + wiki markdown + prompt repo-map as knowledge sub-stores |
| 4. Context Engine | @singularity/prompt (retrieval+knapsack+multi-stage compiler) as the decision authority; @singularity/context as intake | context retrieval/relevance/format → MERGE; wiki search/query → MERGE; intelligence retriever.format → MERGE; host string-concat → REPLACE |
| 5. Architecture Intelligence | @singularity/architecture | architecture package (ADR/decision/impact/risk/drift/graph) + intelligence code-impact + production; context architecture_decisions + memory ARCHITECTURAL_DECISION → MERGE here as stores |
| 6. Model Router | @singularity/router (+ providers) | router (intent→tier→model), nemotronFlashPro, fastpath classifier, qwen-router sidecar, neural-relay role routing |
| 7. Mission Engine | @singularity/runtime planner/mission/remediation + outcome mission ledger | runtime planner + mission/workflow + allocation + mission/remediation; outcome mission/controller (durable record) |
| 8. Agent Runtime | @singularity/runtime scheduler/worker/subagent + allocation | scheduler, worker/pool, subagent/*, allocation, execution; agent-framework sidecar → DEPRECATE (stub) |
| 9. Tool Runtime | @singularity/runtime tools/* + outcome verification adapters | runtime tools/verifier+riskPolicy+requirementVerifier; outcome verification/runner+adapters; shellTools |
| 10. Verification Engine | @singularity/outcome (authority) | outcome verification/*, planning/verification-planner, domain/judge, evidence/*, review/*; runtime verifier (hot-path pre-control) |
| 11. Observation Engine | @singularity/outcome outcomes + @singularity/architecture production+observations | outcome Outcome/evidence; architecture production/* + architecture_observations (RENAME); runtime synthesis |
| 12. Runtime Persistence | @singularity/brain store + memory sqlite + architecture/outcome sqlite | the SQLite/WAL/json stores; cache was designed as infra |
| 13. Runtime Observability | @singularity/cache telemetry + router requestTracer + neural-relay metrics/cacheStatus | cacheMetrics, requestTracer, CacheStatusSnapshot |
| 14. Policy Layer | @singularity/router resolveToolPermissions + runtime riskPolicy + outcome reviewPolicy | toolPermissions, riskPolicy, human-review reviewerPolicy, security/isolation |

## Key consolidation decisions (from inventory)
1. ONE **event fabric** (Neural Relay as nervous system). architecture/memory/outcome each have InMemoryEventBus+OutboxPublisher+WAL — unify.
2. ONE **Brain** = @singularity/brain, gaining memory's typed project memory + Postgres/pgvector/Neo4j/mem0 backends + intelligence graph store + wiki as knowledge sub-stores.
3. ONE **Context decision** = @singularity/prompt retrieval/ranking/compression/assembly; context/wiki/intelligence become knowledge stores.
4. ONE **Verification** = @singularity/outcome (authority); runtime does hot-path pre-verification.
5. ONE **Mission** = runtime planner/execution + outcome durable mission record unified by mission_id.
6. **Neural-relay package** is NOT an event fabric — it is context minimization/retrieval. Rehome under Context/Model Router; the name "Neural Relay" for the event bus is currently unclaimed → assign to the unified event fabric.

## Multi-agent UX preservation (DO NOT remove)
The runtime events/store + chatAdapter produces the "N agents active / ✓ role / ● running / ○ queued / progress%" team list that surfaces in Intelligence Shell + chat. This is Chat Runtime (target 1) surfacing Agent Runtime (target 8) state — preserve exactly.
