# A. BEFORE — existing engines/features
13 @singularity packages + 4 services + ~25 extension bridges:
- router (Model Router + SingularityAI hot hub), prompt (Context compilation), cache (I/O cache), context (Context Engine), wiki (LLM Wiki), intelligence (Project Intelligence/graph), architecture (Architecture Intelligence), outcome (Verification), memory (Project Memory), brain (Brain), neural-relay (Context minimization), runtime (Mission+Agent+Tool Execution), design (Frontend Design lane)
- services: langextract (intake), agent-framework (stub), project-intelligence (daemon), qwen-router (local routing classifier)

# B. AFTER — 14 canonical systems (see TARGET.md)
Chat Runtime, Neural Relay (event fabric), Brain, Context Engine, Architecture Intelligence, Model Router, Runtime Mission Engine, Agent Runtime, Tool Runtime, Verification Engine, Observation Engine, Runtime Persistence, Runtime Observability, Policy Layer.

# D. DELETED components (genuinely redundant / dead after consolidation)
- services/agent-framework-sidecar → the Agent-Framework execution path is a stub (healthy=false, run_workflow not_implemented); native runtime scheduler is the de-facto path. DELETE/DEPRECATE the sidecar path; keep native.
- Duplicate InMemoryEventBus/OutboxPublisher/LocalEventBuffer re-implementations in architecture/memory/outcome → replace with ONE shared relay (delete the 2 duplicates).
- Duplicate retrieval/ranking/assembly in context/wiki/intelligence → delete in favor of prompt's single Context authority.
- @singularity/memory's parallel <typed project memory + its own <rankers/conflict/consolidation> → replace with the unified Brain runtime.
- @singularity/neural-relay package's standalone retrieval context-index (FilesystemRepoIndex duplicate of intelligence graph + prompt index).

# E. MOVED components (ownership changed)
- brain model client + embeddings → route through Model Router (remove duplicate invocation); keep Brain reasoning distinct.
- neural-relay cacheStatus/pricing/experimentLog metrics → Runtime Observability.
- architecture production/* observations → Observation Engine (move/reactualized).
- runtime tools/verifier + requirementVerifier + riskPolicy → Tool Runtime/Verification (co-own with outcome adapters).
- runtime workspace/worktreePort → Agent/Engine isolation namespace.
- context architecture_decisions → Architecture Intelligence (as projection/cache).
- intelligence retriever.format block building → Context Engine (relevance), keeping graph store.

# F. PRESERVED capabilities (moat intact — demonstrably NOT lost)
| Moat | Survives in |
|---|---|
| persistent Brain + long-term memory | @singularity/brain (intact) + memory merges in; connectivity not removed |
| episodic memory | brain episodes |
| project understanding | context intake + memory project scope merge |
| architecture understanding | @singularity/architecture (graph + ADR) |
| ADR intelligence + drift detection | architecture domain/adr + drift |
| knowledge graph + decision evolution | architecture graph + evolution; brain graph |
| context intelligence | prompt multi-stage compiler (single Context owner) |
| mission-based execution | runtime planner/execution + outcome missions unified |
| multi-agent orchestration | runtime scheduler/worker/subagent (intact) |
| visible agent progress | runtime events/store + chatAdapter (intact) |
| long-running missions + autonomous exec | runtime mission + outcome recovery (Persistence) |
| independent verification | outcome verification authority (intact) |
| risk assessment | architecture risk + runtime riskPolicy (into Verification safety) |
| production observation | architecture production/* + outcome observations (Observation Engine) |
| outcome-driven execution | outcome mission/outcome (intact) |
| proactive debugging | runtime fixer/agent loop (in-hand) |
| model routing + optimization | router (intact) |
| evidence-based human review | outcome review gate (intact) |
| persistent state + recovery | sqlite/WAL (Runtime Persistence) |
| learning from outcomes | brain improvement + prompt learning (Brain capability) |
| specialized tool execution | runtime tools + sidecars |
| architecture-aware refactoring | architecture impact/drift + runtime planner |

Conclusion: none of the moat capabilities are removed — every one maps to a surviving canonical owner. The consolidation merges *implementation*, never the capability.
