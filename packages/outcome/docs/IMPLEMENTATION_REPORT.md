# Outcome Achievement & Requirement Verification Engine — Implementation Report

## 1. Architecture implemented

An asynchronous Outcome Engine (`@singularity/outcome`) that sits **beside** the Singularity coding hot path, matching Architecture/Memory:

1. Coding tick: `OutcomeSubsystem.emit` → `LocalEventBuffer.append` (sync, never throws, never awaited).
2. Outbox publisher (~50ms) drains WAL → in-process `InMemoryEventBus`.
3. Intelligence-plane pipeline: extract → compile ACs → plan verification → queue workers → immutable evidence → deterministic judge → mission rollup → optional memory sink + remediation event.

The coding agent does **not** wait for extraction, SQLite, LLM, tests, or memory writes.

Mission Controller lives in this package (`createMission` / lifecycle on `Mission.lifecycle`). Executive planner remains `@singularity/runtime`; remediation emits `remediation.requested` with a planner prompt rather than spawning a second agent.

Runtime DAG may fire-and-forget `READY_FOR_VERIFICATION` via `onOutcomeCheckpoint`. LLM `verifyAgainstRequirements` is **not** written as PASS in the outcome store.

## 2. Files changed

**New package** `packages/outcome/**`

**Wired**

- [`package.json`](../../../package.json) — `build:outcome`, test/typecheck scripts
- [`packages/intelligence/src/http.ts`](../../intelligence/src/http.ts) — `mountOutcomeRoutes`
- [`packages/intelligence/package.json`](../../intelligence/package.json)
- [`packages/runtime/src/runtime.ts`](../../runtime/src/runtime.ts) — optional `onOutcomeCheckpoint`
- [`services/project-intelligence/src/main.ts`](../../../services/project-intelligence/src/main.ts)
- [`vscode/extensions/singularity-ai/src/outcomeBridge.ts`](../../../vscode/extensions/singularity-ai/src/outcomeBridge.ts)
- IDE bridges: `intelligenceBridge.ts`, `contextEngineBridge.ts`, `runtimeBridge.ts`, `extension.ts`, `package.json`

**Benchmarks:** `benchmarks/outcome-verification/`

## 3. New packages/modules

`@singularity/outcome`

| Area | Path |
|---|---|
| Domain | `src/domain/{types,judge,aggregator}.ts` |
| Events | `src/events/{types,localBuffer,memoryBus,outboxPublisher}.ts` |
| Persistence | `src/persistence/{store,memoryStore,sqlite}.ts` |
| Extract/compile/plan | `src/extraction`, `src/compiler`, `src/planning` |
| Verify | `src/verification` + adapters `command`, `test`, `compiler` |
| Judge/remediate | `src/domain/judge.ts`, `src/remediation/planner.ts` |
| API | `src/api/routes.ts` |
| Subsystem | `src/subsystem.ts` |

## 4. Database/schema changes

Workspace SQLite: `<workspace>/.singularity/outcome/outcome.sqlite`

Tables: `missions`, `objectives`, `requirements`, `acceptance_criteria`, `verification_plans`, `verification_runs`, `evidence` (insert-only), `outcomes`, `remediations`, `processed_events`.

WAL: `.singularity/outcome/events.wal`. Fallback: in-memory store if `node:sqlite` is unavailable.

Context Engine `requirements.json` is **not** replaced; outcome rows may carry `source_requirement_id`.

## 5. Event changes

New types include `mission.created|updated|execution.updated`, `requirements.extracted`, `outcome.compiled`, `verification.{planned,requested,started,completed}`, `requirement.{passed,failed,unknown}`, `outcome.{achieved,not_achieved,blocked}`, `remediation.requested`, `READY_FOR_VERIFICATION`.

Hot-path payload is small: `missionId` / `sessionId` / `revision` / `eventId`. Duplicate `verification.requested` is deduped by `event_id` (`processed_events`) and in-flight plan+revision keys.

## 6. Verification adapters implemented

| Adapter | MVP |
|---|---|
| `COMMAND` | allowlisted bins (`npm`/`npx`/`pnpm`/…); exit 0 + optional `success_pattern`; timeout → UNKNOWN |
| `TEST` | `npm test`; parse passed/failed/skipped |
| `COMPILER` | `npx tsc --noEmit` |

Not implemented: browser, database, load, security, architecture, deployment.

Commands inherit `cwd` = workspace, timeout, `NODE_ENV=test`. Secrets redacted before evidence persist (`Authorization`, Bearer, context `redactSecrets`).

## 7. APIs added

Mounted on intelligence daemon (`127.0.0.1:4781`):

- `POST /missions` → 202 queue extract
- `GET /missions/:missionId`
- `GET /missions/:missionId/requirements`
- `POST /missions/:missionId/outcomes/compile` → 202
- `POST /missions/:missionId/verify` → 202
- `GET /requirements/:requirementId`
- `POST /requirements/:requirementId/verify` → `{ verificationRunId, status: "QUEUED" }` 202
- `GET /verification-runs/:id`
- `GET /outcome/metrics`
- `POST /missions/:missionId/reviews/evaluate` → 202
- `GET /missions/:missionId/reviews`
- `GET /reviews/:id`
- `GET /reviews/:id/evidence`
- `POST /reviews/:id/start|approve|reject|request-changes`

Verify endpoints **do not** hold the HTTP request while tests run. Review decisions are identity-gated (`X-Reviewer-Id` / `X-Reviewer-Roles`) and append-only.

## 7b. Human Review Gate

Mission achievement is overlaid with policy-driven human review on the intelligence plane only.

- `HumanReview` is first-class (SQLite `human_reviews` + insert-only `human_review_events` + evidence packages).
- Configurable JSON policies (`review_policies` / `DEFAULT_REVIEW_POLICIES`). Default: `REVIEW_REQUIRED ≠ AGENT_BLOCKED`. `HUMAN_GATE_BLOCKED` is written only to `latest.json` `execution_gate`.
- `rollupMission` evaluates policies and overlays `AWAITING_HUMAN_REVIEW` / `REVIEW_REJECTED` so a last-PASS cannot skip a blocking gate.
- ADR accept/reject still uses `ArchitectureSubsystem.review`; intelligence `wireArchitectureGovernance` forwards `ADR_*` into `REVIEW_EVALUATE_REQUESTED`.
- Coding tick unchanged: `emit()` WAL append + cache `lookup()`. No review DB, graph, or policy on that path.

## 8. Tests added

`packages/outcome/test/outcome.test.mjs` plus `human-review.test.mjs`:

- Judge/aggregator (UNKNOWN ≠ PASS, critical FAIL blocks ACHIEVED, score ≠ completion, stale)
- Heuristic extraction + AC compile
- Command PASS/FAIL/timeout UNKNOWN; unsafe command reject
- Event WAL failure, publisher retry
- Evidence sanitization
- Emit isolation when disabled
- E2E: extract → verify FAIL → remediation → re-verify; duplicate queue
- Singularity hot-file grep (`toolCallingLoop`, `automodeService`, prompt bridge) including review needles
- Review policy, transitions, reviewer auth, stale fingerprint, overlay, mission→decision→outcome, ADR sync
- TPS A–F (disabled / enabled / queue pressure / store failure / review queue pressure / review store throw)

## 9. TPS/latency benchmark before vs after

Mock coding tick = `emit(mission.execution.updated)` + cache `lookup` only. 100 concurrent ticks. Latest `benchmarks/outcome-verification/METRICS.json`:

| Scenario | Mean latency | Approx TPS |
|---|---|---|
| A disabled | ~0.007ms | ~103k |
| B enabled | ~0.034ms | ~29k |
| C queue pressure | ~0.030ms | ~31k |
| D store failure | ~0.031ms | ~31k |
| E review queue pressure | ~0.028ms | ~34k |
| F review store failure | ~0.036ms | ~27k |

Enabled vs overloaded vs failed stay in the same ~0.03ms band (same order as Architecture Intelligence). No synchronous verification/LLM/SQLite/human-review on the tick. Event emission is well under the 1ms typical budget.

## 10. Known limitations

- Heuristic extraction (LangExtract optional adapter); AC generation is 1:1 with requirements, not a full LLM compiler.
- MVP invalidation is mission-scoped on code-change events, not a file dependency graph.
- Runtime checkpoint has no `mission_id`; READY_FOR_VERIFICATION uses the active mission for the project.
- Mission human-review UI lives in the Project Context panel (not a dedicated outcome webview).
- Command allowlist is process-level, not a full OS sandbox (same as Runtime `execFile`).
- Test output parsing is best-effort (vitest/jest-style “N passed”).
- `git rev-parse` on the intelligence plane; tmp test workspaces are not git repos (`code_revision` may be `unknown`).

## 11. Next recommended implementation steps

1. Outcome webview (PASS/FAIL/UNKNOWN + blocking requirements).
2. Wire Context LangExtract extractor into `createRequirementExtractor`.
3. File/task scoped stale invalidation using `ownedPaths`.
4. Browser / database inspection adapters behind the same runner.
5. Consume `remediation.requested` in Runtime `createExecutionPlan` without blocking Singularity.
6. Persist `METRICS.json` in CI and fail if coding-tick mean exceeds an SLO (e.g. 1ms).
