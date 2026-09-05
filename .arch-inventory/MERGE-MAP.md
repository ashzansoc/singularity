# MERGE & OWNERSHIP MAP — current fragmented engines → 14 canonical systems

## C. Merge Map (fragments → canonical owner)
### → Mission Engine (7)
Mission Controller (outcome), Executive Planner (runtime planner), Requirement Extraction (outcome extraction + context intake), Task Planner (runtime planner), Execution Scheduler (runtime scheduler), Dependency Scheduler (runtime dag), Replanner (runtime mission/remediation), Retry strategy (runtime scheduler), Mission state (runtime mission/workflow + outcome mission/controller → unified by mission_id), Task DAG (runtime graph/dag)

### → Agent Runtime (8)
Worker Factory/Manager/Coordinator (runtime worker/pool + subagent/orchestrator), Agent Lifecycle (runtime subagent + allocator), Agent Scheduler (runtime scheduler), Agent Communication (runtime bus/contextBus + subagent messages), Agent State (runtime events/store), Agent Retry/Cancellation (runtime scheduler failure handling), Agent Result Aggregation (runtime integrate/integrator)

### → Tool Runtime (9)
Tool Registry/Executor (runtime tools + outcome CommandVerifier/TestVerifier/CompilerVerifier), Tool Discovery (runtime), Tool Permissions (runtime riskPolicy + router resolveToolPermissions), Tool Timeout/Retry (runtime parallel + scheduler), Tool Result Handling (runtime tools/verifier), Tool Evidence Capture (outcome evidence), Tool Sandbox (runtime shellTools)

### → Context Engine (4)
Context Retrieval (context retrieval + prompt semanticRetrieval + intelligence retriever + wiki search → ONE), Context Ranking (context relevance + prompt ranking + intelligence rank + wiki TFIDF → ONE), Context Compression (prompt compression/semantic), Context Assembly (context format + prompt multiStageCompiler + intelligence formatContextBlock + wiki formatWikiContext → ONE), Token Budgeting (prompt budget optimizer — the authority)

### → Architecture Intelligence (5)
ADR (architecture domain/adr + context architecture_decisions + memory ARCHITECTURAL_DECISION → architecture), Dependency Graph (architecture graph/* + intelligence SCIP), Impact (architecture impact + intelligence codeImpact), Drift (architecture drift + observedGraph), Decision/Evolution (architecture evolution + decisions)

### → Model Router (6)
Model Selection (router engine), Provider Selection (router providers), Task Classification (router taskClassifier + runtime fastpath + localRoutingClassifier + qwen-router sidecar), Fallback/Retry (router fallback + rateLimit), Model Health (router telemetry), Latency/Cost (router score/tiers)

### → Verification Engine (11)
Requirement Validator (outcome judge + runtime requirementVerifier), Test Verifier (outcome TestVerifier + runtime verifier), Code Verifier (outcome CompilerVerifier + CommandVerifier), Architecture Verification (outcome ArchitectureReviewPort + architecture validate), Regression (outcome), Evidence (outcome evidence), Risk Scoring (region: architecture risk + runtime riskPolicy → Verification risk as part of safety), Human Review (outcome review/*)

### → Observation Engine (12)
outcome Outcome/evidence, architecture production/* + observations, runtime synthesis. (Distinct from Verification: "did reality produce the outcome".)

### → Brain convergence (3)
semantic + episodic + procedural + architectural memory ← @singularity/brain merges @singularity/memory's project scope; intelligence graph.sqlite + wiki + prompt repo-map become Brain sub-stores.

## G. Ownership Map (exactly ONE owner per capability)
| Capability | Owner |
|---|---|
| event inter-component transport / bus | Neural Relay (unified event fabric; not the current neural-relay pkg) |
| chat/session/streaming/cancellation | Chat Runtime (runtime events/chatAdapter + participant) |
| knowledge store (what we know) | Brain (@singularity/brain + memory scope; intelligence/wiki as sub-stores) |
| what knowledge is relevant NOW | Context Engine (@singularity/prompt retrieval+budget) |
| how software fits together / ADR / drift / impact | Architecture Intelligence (@singularity/architecture) |
| which model performs reasoning | Model Router (@singularity/router) |
| outcome + sequence of work | Mission Engine (runtime planner + outcome missions) |
| spawn/run/supervise workers | Agent Runtime (runtime scheduler + worker + subagent) |
| execute tools / side effects | Tool Runtime (runtime tools + outcome adapters) |
| is change safe/correct enough | Verification Engine (@singularity/outcome) |
| did reality produce intended outcome | Observation Engine (@singularity/outcome outcomes + arch observations) |
| durable state + recovery | Runtime Persistence (sqlite/WAL/json stores) |
| structured logs/metrics/latency | Runtime Observability (cache + requestTracer + telemetry) |
| auth/authz/permissions/approvals | Policy Layer (router toolPermissions + riskPolicy + reviewPolicy) |
