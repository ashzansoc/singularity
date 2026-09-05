# Runtime v4 — Current-State Map

> Cluster mapped: `@singularity/runtime` — *"Runtime v4 — DAG scheduler + ownership-locked parallel workers"*.
> All paths relative to `/Users/ashutosh/Singularity`. Read from live `.ts` source (`packages/runtime/src` = **48 module files**, `packages/runtime/test` = **20 test files**), `index.ts` (189 export lines), `package.json`, plus extension consumers (`vscode/extensions/singularity-ai`), the sidecar stub (`services/agent-framework-sidecar/main.py`), and cross-package overlap targets (`@singularity/outcome`, `@singularity/architecture`, `@singularity/intelligence`, `@singularity/neural-relay`).
> Classification legend: **KEEP / MERGE / MOVE / REPLACE / DEPRECATE / DELETE / UNKNOWN** against a shared target: **Mission Engine** (planning/scheduling/replanning), **Agent Runtime** (worker/agent lifecycle), **Tool Runtime** (tool exec), **Chat Runtime** (session/streaming).

---

## 1. PACKAGE: `@singularity/runtime`

### 1.1 Name / Dir / Purpose
- **NAME**: `@singularity/runtime`
- **DIR**: `packages/runtime`
- **PURPOSE**: Runtime v4 — the **execution/planning core of Singularity's multi-agent plane**. It takes a user goal, decomposes it into a **dependency DAG** of parallel coding agents/subagents, **assigns each to a specialist model**, **schedules them with per-file ownership locks** (no two workers race on the same path), applies their edits, **integrates residual conflicts**, runs **risk-based verification**, synthesizes one user-facing outcome, and emits a full event/chat-progress trail for the IDE shell + chat UI. It owns both the *license hot path* (fast-path simple tasks) and the *deep path* (planner → orchestrator → scheduler → workers → integrator → verifier).
- version 0.1.0, node >=18, MIT. **Wall-clock deps**: `@singularity/context`, `@singularity/design`, `@singularity/router` (declared) + runtime imports of `@singularity/prompt` (LLM pipeline builderUpdate, typed via inline cast).
- **Not a standalone server** — it is an engine library invoked by the VS Code extension (runtimeBridge) and traced via router's `requestTracer`.

### 1.2 Public API (all `src/index.ts` exports)
Grouped by subsystem:

| Export | Source module |
|---|---|
| `TaskStatus`,`TaskNode`,`ExecutionPlan`,`ExecutionPlanEstimates`,`DiffHunk`,`BusEventKind`,`BusEvent`,`WorkerResultStatus`,`WorkerResult`,`RuntimeEventKind`,`RuntimeEvent`,`RuntimeRunRequest`,`RuntimeRunResult` | `types.ts` |
| `LlmRole`,`LlmCompleteRequest`,`LlmCompleteResult`,`LlmPort`,`LlmStreamDelta`,`WorkspacePort`,`EditPort`,`ToolPort`,`DesignPreviewGatePort` **+ values** `InMemoryWorkspace`,`InMemoryEditPort`,`normalizePath`,`applyUnifiedDiff` | `ports.ts` |
| `createLlmPortFromSingularityAI`,`SingularityLlmPortOptions` | `llm.ts` |
| `PARALLEL_IO_LIMIT`,`READONLY_TOOL_CONCURRENCY`,`isParallelIoEnabled`,`isReadOnlyTool`,`parallelLimit` | `parallel.ts` |
| `ShellToolPort`,`ShellToolPortOptions` | `tools/shellTools.ts` |
| `scoreRisk`,`verificationPolicyFor`,`RiskScore`,`RiskTier`,`VerificationPlan` | `tools/riskPolicy.ts` |
| `verifyWithTools`,`VerifyResult` | `tools/verifier.ts` |
| `verifyAgainstRequirements`,`RequirementVerifyItem`,`RequirementVerifyResult` | `tools/requirementVerifier.ts` |
| `DagError`,`buildDag`,`topoSort`,`getReadyNodes`,`pathsIntersect`,`criticalPathLength`,`Dag` | `graph/dag.ts` |
| `LockManager`,`LockTimeoutError`,`LockLease`,`LockManagerOptions` | `locks/lockManager.ts` |
| `ContextBus`,`BusListener` | `bus/contextBus.ts` |
| `createExecutionPlan`,`parsePlanJson`,`finalizePlan`,`createFallbackPlan`,`PlannerOptions`,`PlanRequest`,`RawPlan` | `planner/planner.ts` |
| `runWorkerTask`,`filterOwnedDiffs`,`parseWorkerJson` | `worker/worker.ts` |
| `WorkerPool` | `worker/pool.ts` |
| `runScheduler`,`SchedulerOptions`,`SchedulerResult` | `scheduler/scheduler.ts` |
| `integrateResults`,`IntegratorOptions`,`IntegrateResult` | `integrate/integrator.ts` |
| `createRuntimeEngine`,`createRuntimeEngineFromAI`,`RuntimeEngine`,`RuntimeEngineConfig`,`CreateRuntimeEngineFromAIOptions` | `runtime.ts` |
| `allocateAgents`,`decideExecutionMode` + types `AllocationInput/Result`,`ExecutionMode`,`MultiAgentLimits`,`AllocatedTask`,`DEFAULT_MULTI_AGENT_LIMITS` | `allocation/*.ts` |
| `createMissionWorkflow`,`bumpMissionPhase`,`MissionWorkflowPhase`,`MissionWorkflowState` | `mission/workflow.ts` |
| `createRemediationPlan`,`RemediationReplanRequest` | `mission/remediation.ts` |
| `synthesizeFinalOutcome`,`SynthesizeOptions` | `synthesis/synthesizer.ts` |
| `detectRecommendationConflicts`,`resolveConflicts`,`DetectedConflict`,`ConflictResolution` | `conflict/resolver.ts` |
| `createExecutionSubstrate`,`NativeExecutionSubstrate`,`AgentFrameworkExecutionSubstrate`,`ExecutionSubstrate`,`WorkflowExecutionContext`,`AgentFrameworkSidecarClient` | `execution/substrate.ts` |
| `StdioAgentFrameworkSidecar`,`SidecarClientOptions` | `execution/sidecarClient.ts` |
| `WorkspaceWorktreePort` helpers `workspacePortForAgent`,`worktreePathForAgent`,`WorktreeWorkspaceOptions` | `workspace/worktreePort.ts` |
| `WorkflowEventStore`,`buildAgentRows`,`buildAgentTeamSummary` + types `AgentEvent`,`AgentEventType`,`AgentTeamAgentRow`,`AgentTeamSummary`,`WorkflowSnapshot` | `events/store.ts` |
| `snapshotToChatPayload`,`compactTeamMarkdown`,`expandedAgentsMarkdown`,`ChatAgentTeamProgressPayload` | `events/chatAdapter.ts` |
| `calculateWorkflowProgress`,`agentProgressLabel`,`isTaskCompleted`,`isTaskRunning`,`isTaskQueued`,`isTaskBlocked`,`WorkflowProgress` | `progress/calculator.ts` |
| `classifyComplexity`,`classifyFastPath`,`isFastPathEnabled`,`tryFastPath`,`ComplexityLane`,`FastPathDecision`,`FastPathReason` | `fastpath/classifier.ts` |
| `export *` → full **subagent** subsystem (see 2.8) | `subagent/index.ts` |

### 1.3 Internal architecture (module map — all 48 `.ts`)
| Subsystem | Path | Role |
|---|---|---|
| **Core types** | `types.ts` | TaskNode (extends to SubagentRole/ModelPolicy/tool policy), ExecutionPlan, WorkerResult, RuntimeEvent kinds, RunRequest/Result |
| **Ports/IO** | `ports.ts` | LlmPort, WorkspacePort, EditPort, ToolPort, DesignPreviewGatePort; in-memory fixtures; unified-diff applier |
| **LLM wiring** | `llm.ts` | Adapter over `@singularity/router` `createSingularityAI` → `LlmPort`; tier→model allowlist, escalation, prompt-pipeline injection |
| **Parallel/IO helpers** | `parallel.ts` | `parallelLimit`, deadline wrapper, kill-switch, readonly-tool concurrency |
| **DAG graph** | `graph/dag.ts` | build/validate (cycles, dup ids), topo sort, ready-node selection, path intersection, critical path |
| **Planner** | `planner/planner.ts` | LLM prompt for structured task DAG, JSON parse, finalize (role/specialty/tier enrichment), deterministist fallback plan, Design-fanout injection |
| **Allocation** | `allocation/*.ts` | size specialist teams, decide execution mode (single/parallel/large_team), assign agent ids/models/context scopes/deliverables, concurrency ceiling |
| **Scheduler** | `scheduler/scheduler.ts` | DAG scheduler: ready queue, concurrency cap, ownership-conflict avoidance, retry+escalate, spawn hooks |
| **Ownership locks** | `locks/lockManager.ts` | optimistic per-pathlease lock manager |
| **Workers** | `worker/*` | `runWorkerTask` dispatches by specialty (design dir, visual critic, capture, frontend implement, generic, subagent loop); scoped context; ownership filter; determinist parse |
| **Subagent sys** | `subagent/*` (index, types, roleCatalog, mappers, manager, orchestrator, agentLoop, context, modelPolicy, permission) | role defaults, models, bounded agent tool loop, spawn/cancel, filtered context, permissioned tool wrappers |
| **ContextBus** | `bus/contextBus.ts` | in-process typed bus: worker→worker/integrator coordination |
| **Integrator** | `integrate/integrator.ts` | apply diffs in completion order; LLM repair pass on conflicts |
| **Mission lifecycle** | `mission/*` | workflow state machine (planning→running→…→complete/failed) + remediation replan wrapper |
| **Synthesis** | `synthesis/*` | final user-facing outcome LLM pass |
| **Conflict** | `conflict/resolver.ts` | detect contradictory agent recommendations, LLM resolution |
| **Verification** | `tools/*` | determinist typecheck/test via ToolPort + risk-policy + LLM requirement check |
| **Execution substrate** | `execution/*` | native scheduler vs optional Agent Framework sidecar |
| **Worktree workspace** | `workspace/worktreePort.ts` | git-worktree isolated per-agent workspace ports |
| **Fastpath** | `fastpath/*` | determinist classifier + single-call lane |
| **Events/observability** | `events/store.ts` `events/chatAdapter.ts` `progress/calculator.ts` `subagent/orchestrator.ts` | agent team rows, chat payloads, workflow progress %, snapshots |
| **Main engine** | `runtime.ts` | `createRuntimeEngine` → orchestrates planner → substr → scheduler → integrator → verifier → registry view; traces via router `requestTracer` |

---

## 2. INTERNAL SUBSYSTEMS — DEEP DIVING

### 2.1 Mission workflow & lifecycle
- **Purpose**: Bind a Runtime run to a lightweight lifecycle phase (`planning → running → integrating → verifying → synthesizing → completed/failed/cancelled`) + workflow id, used only for UI phase label + snapshot.
- **State owned**: `MissionWorkflowState` { workflowId, missionId?, sessionId, goal, phase, executionMode, agentCount, startedAt, completedAt?, progress?, cancelled? }. **In-memory only; not persisted.**
- **Maps to target**: **Mission Engine** — this is the *runtime-side* mission view; **outcome package also owns a mission record** (see §13). The runtime mission is only a phase cursor, **not** authoritative.
- **Related**: `mission/remediation.ts` `createRemediationPlan` — planner wrapper that folds an outcome planner_prompt into a new goal and replans. This is the runtime→outcome remediation handoff seam.

### 2.2 Planner (intent → task DAG)
- **Purpose**: LLM decomposes goal into a parallelizable task/agent DAG (JSON schema with role/deps/ownedPaths/tier/specialty/modelPolicy), then `finalizePlan` enriches into TaskNodes + injects Design intelligence pipeline (Design Director → Browser capture → Visual Critic → refine loop via `@singularity/design`).
- **State owned**: none at module level (pure functions); takes `FileHints` and `PlanRequest`. Parse via `SubagentOrchestrator.coerceRawPlan` (also accepts `subagents[]` alias).
- **Fallback**: `createFallbackPlan` — heuristic single/multi-surface decomposition for Vite/React/notes-app style goals when the LLM fails.
- **Maps to**: **Mission Engine** (planning). **Overlaps**: `@singularity/architecture`#intelligence has no planning, but `@singularity/intelligence` (StyleBoost/search) is separate; the architecture ADR/impact plane intentionally *does not* plan. See §13.

### 2.3 Scheduler + dependency resolution
- **Purpose**: event-driven DAG scheduler. Ready queue sorted by priority; concurrency cap; avoids scheduling nodes whose `ownedPaths` intersect in-flight workers; optimistic per-path lease; commit/abort/release; retry with escalate (LLM `escalate` on provider error/low quality/tool failure/timeout), rate-limit backoff, cancelled-cascade, failure classification (provider_error/tool_failure/low_quality/review_reject/timeout/cancelled/unknown).
- **State owned**: `dag`, `WorkerPool` (in-memory), `LockManager`, in-flight path set, preferred-model map, `done/failed` sets. In-memory only.
- **Maps to**: **Mission Engine** (scheduling constraints) + **Agent Engine** (worker dispatch). Overlaps with `@singularity/outcome`'s `verification/scheduler.ts` and `mission/controller.ts` — see §4.

### 2.4 Worker / worker pool / agent allocation
- **Purpose**: `WorkerPool` is a tiny concurrency-cap; `runWorkerTask` dispatches by specialty (design-director, frontend-implement, visual-capture, visual-critic, generic, subagent-loop). Ownership enforcement: only owned paths may be edited; out-of-ownership edits become `changeRequests`.
- **Allocation**: `allocation/engine.ts` sizes teams by lane + repo scale; `decideExecutionMode` → single/parallel/large_team; assigns id/model/context scope; caps concurrency.
- **State**: none persistent; per-run in-memory pools/spawn counts.
- **Maps to**: **Agent Runtime** (worker/agent lifecycle). Overlap: `AgentFrameworkExecutionSubstrate` + `StdioAgentFrameworkSidecar` vs `services/agent-framework-sidecar/main.py` (stub; `healthy=false`→native). §4.

### 2.5 Tool execution (verifier, shellTools, riskPolicy, requirementVerifier)
- `toolVerifier`: deterministic typecheck/tests via `ToolPort`.
- `ShellToolPort`: wraps rg/git/npm test/tsc with env-deadlines.
- `riskPolicy`: deterministic diff-risk scoring (auth/db/deps/env/destructive-signals, file count) → tier low/medium/high → `VerificationPlan` (run checklist verifier? run full?).
- `readme`: requirement checklist LLM verify with fail-open unknown; deadline-bounded.
- **Maps to**: **Tool Runtime** (tool exec + verification decision).

### 2.6 Execution substrate / sidecar agent framework
- `ExecutionSubstrate` interface → `NativeExecutionSubstrate` (runs `runScheduler`) and `AgentFrameworkExecutionSubstrate` (delegates to a sidecar that can build MAF workflows from DAG; **falls back to native on unhealthy**).
- `StdioAgentFrameworkSidecar` spawns `services/agent-framework-sidecar/main.py` — which is currently a **stub**: `health` returns false unless agent_framework installed; `run_workflow` returns `not_implemented_use_native`. → **the sidecar path is effectively dead/wire-only**; native is the de-facto substrate.
- **Maps to**: **Agent Runtime** executor seam (socket/process boundary).

### 2.7 Fast-path classifier (hot path LLM single-call lane)
- Deterministic regex classifier (zero LLM) → `classifyComplexity` → fast / medium / deep lane. `tryFastPath` runs a single streaming completes→ parse→apply→ return (skips DAG/schedule/verify). Escalates to deep path once if the lightweight checks fail. Default ON unless `SINGULARITY_FAST_PATH=0`; embed-allowlist forces deep.
- **State**: none (pure).
- **Maps to**: hot single-turn chat path; adapter restart allows a prompt chat to skip the deep pipeline.

### 2.8 Subagent system (~largest subsystem)
- `SubagentSys` module-directory (`subagent/…`) is the cursor-style bounded tool agent:
  - `types.ts`: SubagentRole/Status/ModelStrategy/ModelPolicy/Artifact/Usage/Result/ReviewResult/Bounds/Spec/Message/DependencyRequest/FailureClass.
  - `roleCatalog.ts`: ROLE_DEFAULTS mapping each role → tools (READ/EDIT/REVIEW/TEST), ModelPolicy strategy+tier, maxIters/timeouts/retryLimit, specialty.
  - `mappers.ts`: SubagentSpec↔TaskNode enrichment both directions.
  - `manager.ts`: SubagentManager — spawn bounds (depth/total/children), live DAG insertion, spawnFixer (debugger spawned on review-reject), usage aggregation.
  - `orchestrator.ts`: SubagentOrchestrator — normalize plan (enrich, optional review tail: `maybeAppendTest+Review`), prepare filtered per-node context, parse raw-plan JSON.
  - `agentLoop.ts`: `runSubagentLoop` — multi-iteration loop (tools, diffs, changeRequests, dependency_requests, needs_more_context → context expansion, reviewer-reject → error → fixer).
  - `context.ts` + `modelPolicy.ts` + `permissions.ts`: scoped filtered output, model routing, permissioned ports (ToolPermission, ownership check, executeToolCall).
- **Maps to**: **Agent Runtime** (tool-enabled agent lifecycle) and shadows a true "agent-framework" process sidecar — see §13.

---

## 3. STATE OWNED (in-memory + persisted)
| Module | State | Persisted? |
|---|---|---|
| scheduler | dag/map, pool, locks, `done`/`failed`, in-flight owned paths | **in-memory only** |
| locks | `held` map path→leaseId, leases, waiters (FIFO/timeouts) | memory |
| contextBus | typed bus: emitted events + history (read via `clear()`), agent messages | memory |
| events/store | `AgentEvent[]`, WorkflowSnapshot {workflow,plan,progress,agents} | memory (ring buffer, `MAX_EVENTS=2000`) |
| mission/workflow | MissionWorkflowState | **not persisted** |
| spaces/Design DNA | **persisted by @singularity/design** (loadDesignDna/saveDesignDna to `.singularity/design-dna.json`, design-spec.json, skill.json, design-preview.json) **through worktree/workspace** — minted **by **Runtime* **worker** calls into `@singularity/design` | **disk** (`.singularity/`) |
| — | — | — |
**No runtime-owned DB or SQLite.** Persistence is via **@singularity/design DNA** (`DAG` inside `.singularity/`) and the **framework** edit port; **workflow/plan/agents are ephemeral per engine.run () call.**

---

## 4. DATABASES / TABLES
**None defined/dase in `@singularity/runtime`.** No `.sqlite`/store. The only durable artifacts live under `.singularity/` (design DNA/spec/skill/preview) written by worker → `@singularity/design`, plus the **`engine` writes via EditPort into the user workspace** (applied files). Persisted mission/runtime events are not in this package (outcome/architecture own their stores).

---

## 5. RELAY EVENTS (bus/contextBus + events/store)
Two parallel event layers exist:
### 5.1 ContextBus (typed in-process, `bus/contextBus.ts`)
- `BusEventKind`: CreatedFile, ModifiedInterface, ModifiedExport, ChangeRequest, TaskSummary, SubagentResult, DependencyRequest, Custom. Listener set + `history` ring. **Not a relay** — memory-only.
- AgentMessage types (Finding/Question/DependencyRequest/Blocker/Evidence/Recommendation/Result) via `onMessage`.

### 5.2 RuntimeEvent / EventStore (`types.ts` + `events/store.ts`)
- `RuntimeEventKind` (~55): plan/task/subagent/agent/workflow/verify/lock/integrate lifecycle.
- `WorkflowEventStore.ingestRuntimeEvent` maps RuntimeEventKind → AgentEventType (e.g. subagent_completed → agent.completed), emits snapshots (custom `onWorkflowSnapshot`), publish etc.

### 5.3 Cross-package relays **consumed** by:
- `runtime.ts` uses `requestTracer` (router) `begin/marked/setMeta/addUsage/setTokenFlow/finish`.
- `runtimeBridge` (ext) emits `READY_FOR_VERIFICATION` → outcome bridge → **`@singularity/outcome`** event bus (`onOutcomeCheckpoint`).
- `runtime.ts` never itself pipes into `neural-relay`. The extension's `expandNeuralRelay` is wired into the engine via `onContextRequest` (files out).

---

## 6. MODEL / LLM CALLS (provider/router)
All LLM goes **exclusively** through `LlmPort.complete / completeStream` (`ports.ts`); production wiring is `createLlmPortFromSingularityAI` (`llm.ts`):
- **Back-office provider** = `@singularity/router`'s `createSingularityAI` + engine.route (deepseek-v4-flash-0731 is the only allow-listed model; gemini-2.5-flash for vision; tuple-matched by specialty; new tier-flow; `engine.escalate` on catalog).
- **Roles**: `planner` (T5), `worker`/`subagent` (T2–T4 by role/strategy), `design-director` (T0-perm), `visual-critic` (T2), `integrator` (T5), `worker` (req-verify T2).
- **Pipeline-aware**: `complete` sends `builderUpdate` for planner/worker (prompt-engine context economy) unless `skipPromptPipeline`.
- **Fastpath**: T2 single call.
- **`@singularity/design` runners** (design director/visual-critic) are invoked by the **worker* code with the same `ctx.llm.complete` passed-through.
- **Escalation** is orthogonal in `scheduler.handleFailure` → `LlmPort.escalate`.

## 7. DEPENDENCIES ON `@singularity/*` (imports)
| Import | Used from |
|---|---|
| `@singularity/router` | `llm.ts`, `runtime.ts` (requestTracer); `tiers/feish` in planner/modelPolicy/classifier; rate-limit backoff helpers in scheduler; TracePhase |
| `@singularity/design` | planner (`injectFrontendDesignPipeline`), scheduler (frontend-owner model), worker (whole frontend/design pipeline: design director/critic/dna/skill), `browser`/preview |
| `@singularity/context` (declared, listed in package.json) | (spot check—context is referenced in request enrichment; not a hard import at 1st read) |
| `@singularity/prompt` (typed via router builderUpdate casts) | `llm.ts` (ConversationTurn), Prompt engine |
| — | — |
`package.json` declares only context/design/router (consolidated via router). `@singularity/outcome` / `@singularity/neural-relay` are **not imported by runtime** — they are bridged from the extension instead.

## 8. CALLERS / CONSUMERS (extension drives missions/agents)
Grep of `vscode/extensions/singularity-ai/src`:
- **`runtimeBridge.ts`** (main driver): `runRuntimeInIde` → `createRuntimeEngineFromAI` with aroutine `createVsCodeWorkspacePort`, `createVsCodeEditPort`, `ShellToolPort`, `ideShellExec`; calls outcome `createMission` + `emitOutcomeEvent('USER_INTENT_CAPTURED')`; `onContextRequest` → `expandNeuralRelay`; `onOutcomeCheckpoint` → `emitOutcomeEvent('READY_FOR_VERIFICATION')`. Builds final `RunRuntimeResponse` incl. `agentTeam = snapshotToChatPayload(...)`.
- **`extension.ts`** as a command `singularity.ai.runtimeExecution` registers the DAG, opens IntelligenceShell('tasks') panel, streams `RuntimeEvent` into output channel + panel, forwards snapshots to `handleRuntimeEvent`.
- **`shellPanel.ts`** (intelligenceShell) paints `subagent_progress_delta` streaming and maps `RuntimeEvent`.
- **`runtimeChatParticipant.ts`**: the chat participant that **claims `singularity.dag`**. Important: **Runtime subagent / DAG execution is currently PAUSED** — the participant just informs the user "Runtime subagent / DAG execution is paused. Use default Agent mode." and returns. Only `formatRuntimeMarkdown` / `tasksToMermaid` remain functional. This is a current-state fact to record.
- **`engineCatalog.ts` / `tokenPricing`** routed inside-extension, not runtime package.
- **`cobuild/*`** does **not** import runtime — cobuild is a separate multi-user GPU inference plane (`cobuildService.ts` talks to hyperspace runtime CLI, not DAG).

## 9. CALLERS / CONSUMERS — how the extension drives
- `RunRuntimeRequest { goal, projectSummary, codingStandards, structuredContext, verificationChecklist, concurrency, lockTimeoutMs, signal/cancelSignal, missionId }` → `runRuntimeInEngine` → `engine.run()`.
- Bridge creates an **outcome mission record** (`createMission`) for every Runtime run to give it a missionId and fire `USER_INTENT_CAPTURED`.
- On `READY_FOR_VERIFICATION` calls it re-emits as `@singularity/outcome`, the outcome investigator then can adopt the runtime's verification from there.
- The **agent team list / progress** `snapshotToChatPayload → `agentTeam`, pushed back as part of RunRuntimeResponse for the "agent team" renderer; and snapshots streamed live to `IntelligenceShell`.
- **`runtimeChatParticipant` = DAG mode is PAUSED but still registered** — `singularity.ai.runtimeExecution` command remains, real consumers call `runRuntime` via API.

## 10. SYNC vs ASYNC / hot vs deep
| Path | Deterministic |
|---|---|
| **Deep path** | `runScheduler` executes **concurrently** (NW concurrency `>=2) awaiting in-flight; planner/workers/integrator are `async` LLM awaits; **runs single-shot per mission** — not a persistent async service |
| **Fast/hot path** | `tryFastPath` single call, streamed deltas, returns fast |
| **Integration / verify/ synthesizer** | awaited LLM passes inside `engine.run` (deterministic result at end) |
| vs **architecture/outcome** | those run **as background workers / relay pipeline** (`WAL→outbox→bus`), while runtime is a **blocking engine run** |
| Subagent loop | bounded iteration, awaited; cross-agent only via `dependency_request` (spawn into DAG) — not async process |

---

## 11. USER-VISIBLE FEATURES
- **Agent team progress list**: `AgentTeamAgentRow[]` (agentId/role/status/progress/model/findings/blockedBy/activity) rendered via `event` chatAdapter markdown (`compactTeamMarkdown`/`expandedAgentsMarkdown`) **or** via Intelligence Shell panel.
- **Live workflow snapshots** (`WorkflowSnapshot` → `onWorkflowSnapshot`) feeding a Gantt/agent-team panel.
- **Parallel agents**: a DAG of 1..~30 specialist agents running concurrently (visible in shell + chat), each with tool calls streamed (`subagent_progress_delta`).
- **Requirement-schedule matrix** → inputs=mermaid flowchart of the run dialog.
- **Diagnostics/Gantt events**: `RuntimeEventKind` list is explicitly "for a future debug / Gantt panel".
- **Fast path / Smart So sure** for simple chats returns single-call directly.

---

## 12. TESTS (`packages/runtime/test/*.ts`, 20 files)
Test files: allocation, conflict, contextIntegration, dag, deadlines, events, fallbackPlan, fastpath, fastpathExecution, frontendPipeline, integrator, locks, ownership, parallel, progress, riskPolicy, scheduler-retry-identity, scheduler, smoke, subagents.
Good coverage of the DAG planner/scheduler/worker/agent/lock/test surface; no persistence/event-relay legacy coverage (there is none). Tests target **unit behavior** (in-memory).

## 13. DUPLICATES / OVERLAP (critical mapping)

| Concept | Runtime module | Overlap target | Verdict |
|---|---|---|---|
| **planner** | `planner/planner.ts`, `mission/remediation.ts` | `@singularity/outcome` `planning/verification-planner`, `extraction/requirement-extractor`; `@singularity/architecture/intelligence` has **no task planner** | Runtime planner = decomposition into agent tasks; outcome planner = requirement/verification planning for mission evidence. **Both plan, different granularity.** → **MERGE/ALIGN (distinct resource), keep runtime planner.**
| **scheduler** | state scheduler; execution substrate (native/agent-framework) | `@singularity/outcome` `mission/controlled.ts` (mission lifecycle) + `verification/scheduler` (verification queue) | **Two schedulers.** Runtime schedules agent workers; outcome schedules mission LLM behaviors. Overlap in the mission concept only. → **KEEP runtime; outcome mission should be the long-lived durable Mission, runtime a per-run view.**
| **worker / agent pool** | `worker/pool.ts` + `subagent/orchestrator` (+ `subagent/agentLoop`) | `services/agent-framework-sidecar` (MAF, stub) | the pool/loop is the **in-process** agent; the sidecar is a **process**. The sidecar is effectively **redundant/stub** → **MERGE/DEPRECATE the sidecar** (native remains the live path), keep the runtime worker/agent loop.
| **verifier/tools env** | `tools/verifier` + `tools/riskPolicy` + `tools/requirementVerifier` | `@singularity/outcome` `verification/runner.ts`, `adapter.ts` (`adapters/command/test/compiler`) | **Two live verifiers.** Runtime = per-agent tool-check + LLM check inline; outcome = requirement-evidence end-line verification with typed Evidence. → **MERGE** one shared executor (runtime ToolPort adapters ↔ outcome `CommandExecutor`), clarify which owns persistence/mission evidence.
- **fastpath** | `fastpath/classifier` | `router` (task classifier, `intent/classifier`, localRoutingClassifier) | Overlap is real: `classifyFastPath` already delegates `classifyTask` from the router and also has its own embedded regex scope/risk lists. → **DEPRECATE/CLASSIFY (merge into router)**; expose a single "request is routable to single_call" decision.
- **events/chatAdapter** | `events/store`, `events/chatAdapter` | `neural-relay` **event transport** (memoryBus/outbox) | neural-relay is the **delivery fabric**; runtime store is the **UI snapshot**. Not an overlap — they feed different surfaces. → **KEEP runtime store; do not duplicate relays.**

| For other cross-package pathways: |
| **outcome remediation** `remediation/planner.ts` (buildRemediation → planner_prompt) vs runtime **`createRemediationPlan`** — runtime is a thin wrapper over `planner.planner`; outcome builds the *reason/evidence-first* planner_prompt. These are **complementary**: outcome says *why* something failed; runtime says *how* to replan the DAG. → **KEEP both but define a "remediation_request" handshake flow.**

---

## 13. Consolidated @runtime classification (against 4 targets)
Targets: Mission Engine; Agent Runtime; Tool Runtime; Chat Runtime.

### KEEP (core, no overlap):
- runtime.ts (engine) — **KEEP** orchestrator (Mission Engine seam via mission engine, Agent Runtime controller, Tool Runtime driver).
- scheduler/scheduler.ts — **KEEP** (Agent Runtime execution) — could be **merged** with outcome's mission record only if runtime adopts the durable scheduler; otherwise keep local.
- worker/pool + worker/worker + subagent/orchestrator+agentLoop → **KEEP** under **Agent Runtime**, do **MOVE** agent-loop into a runtime agent module if a separate agent-runtime layer emerges.
- planner/planner + mission/workflow + mission/remediation + allocation — **MERGE** under **Mission Engine** bag, replace scheduling with durable mission + replan handshake.
- locks/release + graph/dag + parallel — **KEEP** (foundation lib).
- integrator + synthesis + conflict → **KEEP** as Mission "integrate/stitch" stage.
- events/store + chatAdapter + progress calc → **KEEP** (Chat Runtime / UI).

### MOVE:
- `tools/*` verify/risk/require → **MOVE** toward a shared **Tool Runtime / verification executor** (co-own with outcome adapters), so typecheck/test/git execution is one surface.
- `execution/substrate` + `execution/sidecarClient` → **MOVE/DEPRECATE** — the agent-framework sidecar is a stub; decide if the Agent engine should be a process (rewrite in Python) or drop to native-only. Currently **native-only in practice**.
- `workspace/worktreePort` → **MOVE** to Agent/Engine (agent isolation namespace).

### MERGE / REPLACE:
- Scheduler vs outcome-mission/controller → **to be resolved**: outcome mission record is durable (needed) but runtime scheduling must run concurrently → keep runtime scheduler as the **active engine**, outcome mission as durable record.
- verificationRunner → **MERGE** (see above).
- fastpath vs router → **REPLACE** classifier with a router flag (avoid two classificers).

### NOTHING marked DELETE outright, but **sidecar runtime path is effectively dead**: keep only if MAF integration is actually built; else DEPRECATE the substrate.

---

## 14. What's already consolidated vs still fragmented
**Consolidated here (unified):**
- Planner → sort → allocation → planner → executor + subagent loop + integrator + verifier all in **one process** done by `runtime.ts`.
- Owner-locking (lockManager) → scheduler serial/concurrency.
- Event store + progress + chat adaptation one observation module.
- DAG model with subagent overlay (one TaskNode dual-typed).
- Risk-based verification (deterministic + requirement).

**Fragmented / dependencies:**
- Type management spread across `types.ts`, `subagent/types.ts`, `allocation/types.ts`, `mission/workflow.ts`, `events/store.ts`; some types duplicate (TaskStatus vs SubagentStatus; RuntimeEventKind vs AgentEventType).

- Two execution metaphors: native vs "substrate-level MAF-sidecar" — **unsettled/undulous**.
- Verification split: `runtime/tools/verifier` + `outcome/verification/…`.
- Fastpath classifier duplicated with router's own classifier.
- `@singularity/design` pipeline is injected but lives outside runtime (worker calls into it); healthy overlay seam, but adds a design-specialty count to workers.
- **Two definitions of mission**: runtime-rich in-memory view vs durable outcome mission record and lifecycle.

---

## 15. Quick verdict (one line each)
| Area | Class |
|---|---|
| runtime.ts (engine) | KEEP – orchestrate draws on all four targets |
| planner | MERGE into Mission engine (intent→DAG) |
| scheduler/runScheduler | KEEP active engine (Agent executions); reconcile with outcome mission |
| worker/pool/worker | KEEP (Agent Runtime core) |
| subagent/orchestrator/loop | KEEP; possibly provide an Agent-Runtime SDK |
| locks + dag | KEEP (pure util) |
| tools/verifier/risk/requirement | MERGE with outcome verification executor |
| execution/substrate+sidecar | DEPRECATE unless agent-framework proven; else native-only |
| fastpath | REPLACE with a centralized router/hot-path flag |
| events/store+chatAdapter | KEEP (Chat Runtime) |
| progress/calculator | KEEP |
| conflict/resolver | KEEP |
| workspace/worktreePort | MOVE to Agent/workspace isolation |

---
*Report generated from live source; revision `runtime-ctx-v0`.*