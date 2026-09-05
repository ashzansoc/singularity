# Execution Engine — Durable Resume Decision

## Context

Phase 5 evaluates whether SQLite + event WAL + checkpoint/resume is sufficient
for crash recovery across Agent Host restarts, or whether Temporal is needed.

## Decision: SQLite-first (no Temporal)

**Status:** Accepted for Phase 5

### Rationale

1. **Checkpoint boundaries** — `ExecutionEngine` saves checkpoint state at each
   batch boundary via `ExecutionStore.saveCheckpoint()` (`.singularity/execution/execution.sqlite`).
2. **Event WAL** — append-only `events/events.wal` provides audit trail for replay/debug.
3. **Resume API** — `ExecutionEngine.resume(executionId)` reloads plan + checkpoint and continues.
4. **Agent Host scope** — restarts are process-level; SQLite WAL survives normal crashes.
5. **No distributed workers** — parallel tasks are in-process subagent spawns, not separate VMs.

### When to revisit Temporal

- Cross-machine task workers
- Long-running executions (>30 min) with frequent host kills
- Need for automatic activity retry with visibility UI beyond our graph panel

### Mitigations without Temporal

- Checkpoint on batch boundary (implemented)
- `canResume()` guard before resume (implemented)
- Integration/verification reports persisted before marking execution complete
