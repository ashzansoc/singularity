# SINGULARITY — ARCHITECTURAL CONSOLIDATION DELIVERABLE

Status: INVENTORY COMPLETE · ARCHITECTURE MAPPED · REGRESSION GREEN
All maps written to `.arch-inventory/*.md` (7 cluster reports + 8 synthesis maps). This file is the index + plan.

## 1. What was done (this session)
- **Phase 1–3 (Inventory / Ownership / Dependency) COMPLETE.** Read every package source tree,
  27 extension bridges, 4 sidecars, all tests. Produced 7 deep current-state reports.
- **Dependency graph** (cross-package @singularity/* imports) built by script (DEPENDENCY-GRAPH.md).
- **Classification matrix** (KEEP/MERGE/MOVE/REPLACE/DEPRECATE/DELETE/UNKNOWN) per package + submodule (CLASSIFICATION.md).
- **Bug fix:** `packages/router/test/openrouter.test.ts` stale assertion (expected ai-gateway.vercel.sh,
   provider defaults to openrouter.ai). MERGE fix → full package suite green (was 1 pre-existing failure).
- **Regression baseline GREEN:** `npm run test:packages` → exit 0, all 13 packages pass.

## 2. Current vs Target (summarized)
Current: 13 @singularity packages + 4 services + ~25 extension `*Bridge` files, with 8 structural duplicates
(event bus, model client, tier tables, retrieval, verifier, mission state, fastpath classifier, arch decisions).
Target: 14 canonical systems. See `.arch-inventory/TARGET.md`.

### The 8 real duplicates → canonical owner
| Duplicate | Canonical owner (rule 8: single source of truth) |
|---|---|
| InMemoryEventBus+OutboxPublisher+WAL × 3 (arch/mem/outcome) | Neural Relay (1 fabric) |
| Model client ×5 (router providers, brain, neural-relay, design agency, chat auto-router) | Model Router (router providers) |
| Tier→model tables × 3 (router catalog, runtime llm.ts, chat auto-router) | Model Router (catalog.ts) |
| Retrieval+rank+assembly × 4 (context, prompt, intelligence, wiki) | Context Engine (prompt retrieval+budget) |
| Verifier × 2 (runtime tools vs outcome verification) | Verification Engine (outcome authority) |
| Mission state × 2 (runtime in-memory vs outcome durable) | Mission Engine (outcome durable) |
| Fastpath classifier vs router classifier | Model Router ("route-as-fast") |
| Arch decisions × 3 (architecture ADR, context decisions, memory ARCHITECTURAL_DECISION) | Architecture Intelligence |

## 3. Preserved moat
See `BEFORE-AFTER-DELETED-MOVED-PRESERVED.md` §F — every moat capability (persistent brain, episodic memory,
ADR/drift, architecture graph, mission/agent execution, visible progress, verification, risk, observation,
model routing, human review, recovery, learning, relay, tool execution, architecture-aware refactor) maps to
a surviving canonical owner. **Nothing is removed — merged implementation, not capability.**

## 4. Hot Path Profile (deliverable K)
Existing `benchmarks/latency-ladder/` measures TTFT/latency across tiers (A direct → B provider → C
SingularityAI → D runtime). 2026-08-21 live baseline (deepseek-v4-flash-0731):
  streaming TTFT ~1.7–3.7s; layer attribution B−A ≈1.3–1.5s (provider), C−B ≈0–1.7s (routing+prompt pipeline).
  Flag: tier-C cold routing includes a Nemotron specialty-classifier hop — target: remove from hot path
  (mission §9 fast path). The fast path (User→Chat→Relay→ModelRouter→stream) already avoids
  Brain/Architecture/Mission/Agent.

## 5. Implementation plan for deeper consolidation (Phase sequence)
The physical merge into 14 systems is a staged migration **per the mission's own non-destructive rules**
(do not delete until tests pass; migrate callers; keep compatibility layers). The maps in `.arch-inventory/`
define exactly: what to merge, into whom, and the caller list in every report. Execution phases:
  1. Unify event fabric (architecture/memory/outcome) behind one relay transport with compat re-exports. 
  2. Point runtime + chats at router catalog as the single tier→model table.
  3. Route brain/design/neural-relay LLM calls through router providers (or a shared provider primitive).
  4. Make prompt the Context relevance authority; decommission context/wiki/intelligence block-builders. 
  5. Fold memory project-scope into Brain (keep Postgres/Neo4j/mem0 as connectors).
  6. Delete the two dead sidecar/duplicate paths (agent-framework substrate fallback, FilesystemRepoIndex).
Each step: migrate → test → delete → test. Suggested package order (lowest risk first): router, runtime,
architecture, outcome, context, prompt, then brain/memory/wiki intelligence.

## 6. Regression evidence (deliverable L)
- Full `npm run test:packages` GREEN (exit 0) after the OpenRouter fix. See REGRESSION-BASELINE-FIXED.md.
- Re-run the full chain after each future consolidation phase.

## 7. Files (primary outputs)
- `.arch-inventory/`  — 7 cluster reports + 8 synthesis maps (CURRENT-STATE, DEPENDENCY-GRAPH [current+target],
  TARGET, MERGE-MAP, CLASSIFICATION, RELAY-AND-MEMORY-MAP, BEFORE-AFTER-DELETED-MOVED-PRESERVED,
  REGRESSION-BASELINE-FIXED).

## Execution log (Round 1 continuation)
- `packages/outcome/src/evidence/collector.ts` — **deleted** (verified dead: unexported from index.ts,
  zero imports across packages/services/vscode/tests; stale copy existed only in dist/). Outcome build +
  32 tests + typecheck pass after removal. Confirmed regenerated dist contains only the live `sanitize` module.
- Full package suite re-run (all 13 packages) after removal — awaiting result.

## Next safe consolidation (documented, build-ready)
Unify the byte-identical architecture/outcome event-bus + outbox into a shared generic in `@singularity/context`
(every intelligence package already depends on context; it is a leaf). Keeps each package's public symbol names
via thin re-exports. THEN run each package's tests before deleting the per-package duplicate files.

## Executed: Neural Relay event-fabric unification (round 3)
- Created `packages/context/src/relay/fabric.ts` — ONE generic in-process event
  bus (`InMemoryRelayBus`) + WAL buffer (`RelayEventBuffer`) + outbox publisher
  (`RelayOutboxPublisher`), parameterized over event type + metrics + optional
  shed policy + test saturator. Transport-only (no business logic).
- `@singularity/context` exports it via package.json `"./relay"` subpath (additive).
- `@singularity/architecture`, `@singularity/outcome`, `@singularity/memory`
  now delegate: each keeps its public symbols (`InMemoryEventBus`,
  `LocalEventBuffer`/`LocalMemoryBuffer`, `OutboxPublisher`/`MemoryOutboxPublisher`)
  but all implementation lives in ONE shared relay. Behavior preserved per plane:
  - architecture: FIFO buffer, 50ms outbox, type-name matching bus.
  - outcome: FIFO buffer, 1000ms outbox.
  - memory: priority-based shed (eventPriority), recordReceived metric,
    `saturateForTest`, `*` wildcard subscription, 40-tick flush.
- Verified: architecture (71), outcome (32), memory (19) — all pass; builds clean.
- This deletes duplicate event-transport implementations (mission rule: duplicate
  event buses → Neural Relay).

### Round-3 completion detail (helper dedup + verification)
- Event name/id helpers deduplicated too: `newEventId`, `eventTypeName`,
  `parseEventTypeName` in architecture/outcome/types.ts + memory/schemas.ts now
  re-export from the shared relay (import-for-local-binding + re-export pattern).
- Final verification: per-plane suites (arch 71 / outcome 32 / memory 19 pass),
  FULL chained package suite exit 0, FULL packages build exit 0.

## Executed: Verification write-through — runtime hot-path verify → Outcome Evidence (round 4)
Mission rule satisfied: "Verification Engine is the canonical verification authority."
Runtime's fast hot-path verifier still runs (no latency added), but its structured
observations are now PERSISTED by the Outcome plane instead of being dropped:

- packages/runtime/src/types.ts — new `RuntimeVerifyEvidence` (riskTier/riskScore,
  toolChecks, requirementChecks, appliedPaths, checkedAt); exported from index.
- packages/runtime/src/runtime.ts — builds `verifyEvidence` at the existing
  READY_FOR_VERIFICATION checkpoint (fire-and-forget; zero new awaits on hot path).
- vscode/.../runtimeBridge.ts + outcomeBridge.ts — forwards evidence in the event
  payload (`verification_evidence`) for both remote and local modes.
- packages/outcome/src/workers/pipeline.ts — `ingestRuntimeVerifyEvidence()`:
  persists tool checks as `static_analysis` + requirement checks as `runtime`
  Evidence rows (sanitized, insert-only), idempotent per (mission, revision) via a
  source marker. Outcome remains the single verification authority.

### New regression test
`outcome.test.mjs › READY_FOR_VERIFICATION with runtime hot-path evidence persists
Evidence rows (write-through)` — asserts typecheck=FAIL/static_analysis,
tests=PASS, requirement=PASS/runtime rows land, no duplicates on re-emit, and a
new revision records fresh rows.

### Verification evidence (all exit 0)
- architecture 71 pass · outcome 33 pass (incl. new test) · memory 19 pass
- FULL chained package suite: exit 0 · FULL packages build: exit 0
- Extension typecheck (vscode/extensions/singularity-ai): exit 0

### Fix discovered during verification
The relay fabric import initially used the `./relay` package subpath; the
extension host resolves @singularity/* under Node10 rules ("Module resolution kind
not specified"), which cannot read exports subpaths. Re-exported the fabric from
the @singularity/context ROOT barrel and switched all three planes to it —
resolves under NodeNext AND Node10.
