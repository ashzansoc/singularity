import type { ContextBus } from '../bus/contextBus.js';
import { buildDag, getReadyNodes, pathsIntersect, type Dag } from '../graph/dag.js';
import { LockManager, LockTimeoutError } from '../locks/lockManager.js';
import type {
  DesignPreviewGatePort,
  LlmPort,
  ToolPort,
  WorkspacePort,
} from '../ports.js';
import type {
  ExecutionPlan,
  RuntimeEvent,
  TaskNode,
  WorkerResult,
} from '../types.js';
import { WorkerPool } from '../worker/pool.js';
import { runWorkerTask } from '../worker/worker.js';
import {
  FRONTEND_OWNER_MODEL_ID,
  modelIdForSpecialty,
  type BrowserPort,
  type FrontendPipelineSpecialty,
} from '@singularity/design';
import {
  computeBackoffMs,
  extractRetryAfterFromText,
  sleepAbortable,
} from '@singularity/router';
import { classifyFailure } from '../subagent/agentLoop.js';
import { resolveModelRouting } from '../subagent/modelPolicy.js';
import type { SubagentOrchestrator } from '../subagent/orchestrator.js';
import type { SubagentDependencyRequest } from '../subagent/types.js';

export interface SchedulerOptions {
  llm: LlmPort;
  workspace: WorkspacePort;
  bus: ContextBus;
  concurrency?: number;
  lockTimeoutMs?: number;
  onEvent?: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
  sessionId?: string;
  /** Root used for Design DNA / Design Spec persistence (frontend lane). */
  workspaceRoot?: string;
  browser?: BrowserPort;
  previewUrl?: string;
  designPreviewGate?: DesignPreviewGatePort;
  tools?: ToolPort;
  orchestrator?: SubagentOrchestrator;
  enableSubagentLoop?: boolean;
  shellExec?: (command: string) => Promise<{ ok: boolean; output: string }>;
  onContextRequest?: (req: {
    requested_files: string[];
    reason: string;
  }) => Promise<string | undefined>;
}

export interface SchedulerResult {
  results: WorkerResult[];
  events: RuntimeEvent[];
  ok: boolean;
}

/**
 * DAG scheduler: ready queue, concurrency cap, ownership conflict avoidance,
 * lock acquire/release, retry with escalate, subagent spawn hooks.
 */
export async function runScheduler(
  plan: ExecutionPlan,
  opts: SchedulerOptions,
): Promise<SchedulerResult> {
  const concurrency = opts.concurrency ?? 4;
  let dag = buildDag(plan.nodes);
  const pool = new WorkerPool(concurrency);
  const locks = new LockManager({ timeoutMs: opts.lockTimeoutMs ?? 30_000 });
  const events: RuntimeEvent[] = [];
  const results: WorkerResult[] = [];
  const done = new Set<string>();
  const failed = new Set<string>();
  const inFlight = new Map<string, string[]>(); // taskId → ownedPaths
  const preferredModel = new Map<string, string>();

  const refreshPreferredModels = (): void => {
  for (const node of plan.nodes) {
    if (preferredModel.has(node.id)) continue;
    const routing = resolveModelRouting(node.modelPolicy);
    const pinned =
      node.assignedModel ??
      node.preferredModelId ??
      routing.modelId ??
      modelIdForSpecialty(node.specialty as FrontendPipelineSpecialty | undefined);
      if (pinned) {
        preferredModel.set(node.id, pinned);
      } else if (
        node.specialty === 'frontend' ||
        node.specialty === 'frontend-refine'
      ) {
        preferredModel.set(node.id, FRONTEND_OWNER_MODEL_ID);
      }
    }
  };
  refreshPreferredModels();

  const pendingWork: Promise<void>[] = [];

  // Event-driven wakeup: tasks completing resolve this promise instead of the
  // main loop polling with setTimeout(0) spins. Falls back to a bounded poll
  // only when nothing is in flight and work may still arrive.
  let notifyScheduler: (() => void) | undefined;
  const wakeScheduler = (): void => {
    const n = notifyScheduler;
    notifyScheduler = undefined;
    n?.();
  };
  const waitForWakeupOrIdle = async (): Promise<void> => {
    if (pendingWork.length === 0 && inFlight.size === 0) return;
    await new Promise<void>((resolve) => {
      notifyScheduler = resolve;
    });
    wakeScheduler();
  };

  const emit = (
    kind: RuntimeEvent['kind'],
    message: string,
    extra?: Partial<RuntimeEvent>,
  ): void => {
    const ev: RuntimeEvent = {
      kind,
      ts: Date.now(),
      message,
      ...extra,
    };
    events.push(ev);
    opts.onEvent?.(ev);
  };

  const rebuildDag = (): void => {
    dag = buildDag(plan.nodes);
    refreshPreferredModels();
  };

  const trySchedule = (): void => {
    if (opts.signal?.aborted) {
      return;
    }

    while (true) {
      if (inFlight.size + pool.pending >= concurrency) {
        break;
      }

      const busyPaths = [...inFlight.values()];
      const ready = getReadyNodes(
        dag,
        done,
        new Set([...inFlight.keys(), ...failed]),
      );
      const candidate = ready.find(
        (n) => !busyPaths.some((paths) => pathsIntersect(n.ownedPaths, paths)),
      );
      if (!candidate) {
        break;
      }

      candidate.status = 'ready';
      emit('task_ready', `Task ready: ${candidate.id}`, {
        taskId: candidate.id,
        data: { role: candidate.role, status: candidate.status },
      });

      inFlight.set(candidate.id, [...candidate.ownedPaths]);
      candidate.status = 'running';
      pendingWork.push(pool.run(() => executeWithLocks(candidate)));
    }
  };

  const handleFailure = async (
    task: TaskNode,
    result: WorkerResult,
  ): Promise<void> => {
    const attempts = (task.attempts ?? 0) + 1;
    task.attempts = attempts;
    const failureClass = classifyFailure(result.error);

    if (result.subagentResult) {
      task.result = result.subagentResult;
    }

    // Review reject → spawn fixer once (bounded)
    if (
      failureClass === 'review_reject' &&
      opts.orchestrator &&
      attempts <= task.retryLimit
    ) {
      const fixer = opts.orchestrator.manager.spawnFixer(
        plan,
        task,
        result.subagentResult?.summary ?? result.error ?? 'review rejected',
      );
      if (fixer) {
        // Mark reviewer as done (review delivered); fixer continues work
        task.status = 'done';
        done.add(task.id);
        results.push(result);
        emit('task_done', `Review recorded; spawned fixer ${fixer.id}`, {
          taskId: task.id,
          data: { fixerId: fixer.id, failureClass },
        });
        rebuildDag();
        return;
      }
    }

    // Aborts must not retry into pending — that leaves the DAG stuck and the
    // cleanup loop mislabels leftovers as "deps unmet".
    if (failureClass === 'cancelled' || opts.signal?.aborted) {
      task.status = 'cancelled';
      failed.add(task.id);
      results.push(result);
      emit('task_failed', `Task cancelled: ${task.id}`, {
        taskId: task.id,
        data: { error: result.error, failureClass: 'cancelled' },
      });
      emit('subagent_cancelled', `Subagent cancelled: ${task.id}`, {
        taskId: task.id,
      });
      cancelDependents(dag, task.id, failed, emit);
      return;
    }

    if (attempts <= task.retryLimit) {
      // Rate-limited tasks wait out the shared cooldown before re-queueing so
      // parallel workers don't hammer a throttled gateway (P0 amplification fix).
      if (failureClass === 'provider_error' && isRateLimitError(result.error)) {
        const retryAfterMs = extractRetryAfterFromText(result.error);
        const waitMs = computeBackoffMs(attempts - 1, { retryAfterMs });
        emit('task_retry', `Rate limited; ${task.id} backing off ${(waitMs / 1000).toFixed(1)}s`, {
          taskId: task.id,
          data: { error: result.error, failureClass, backoffMs: waitMs },
        });
        task.status = 'pending';
        pendingWork.push(pool.run(() => rateLimitedRetryWait(task.id, waitMs, opts.signal)));
        return;
      }

      emit('task_retry', `Retrying ${task.id} (attempt ${attempts})`, {
        taskId: task.id,
        data: { error: result.error, failureClass },
      });
      task.status = 'pending';

      const escalateReason =
        failureClass === 'low_quality' || failureClass === 'review_reject'
          ? 'low_quality'
          : failureClass === 'tool_failure'
            ? 'tool_failure'
            : failureClass === 'timeout'
              ? 'timeout'
              : 'provider_error';

      if (opts.llm.escalate) {
        const next = await opts.llm.escalate(result.modelId, escalateReason);
        if (next) {
          preferredModel.set(task.id, next.modelId);
          if (next.tier) {
            task.recommendedTier = next.tier;
          }
        }
      }

      // Expanded context / simplified objective on later retries
      if (attempts >= 2 && task.objective) {
        task.objective = `Simplified: ${task.objective}`.slice(0, 400);
      }
      return;
    }

    task.status = 'failed';
    failed.add(task.id);
    results.push(result);
    const errDetail = result.error ? `: ${result.error}` : '';
    emit('task_failed', `Task failed: ${task.id}${errDetail}`, {
      taskId: task.id,
      data: { error: result.error, failureClass },
    });
    emit('subagent_failed', `Subagent failed: ${task.id}${errDetail}`, {
      taskId: task.id,
      data: { error: result.error, failureClass },
    });
    cancelDependents(dag, task.id, failed, emit);
  };

  const onDependencyRequest = async (
    req: SubagentDependencyRequest,
    parent: TaskNode,
  ): Promise<boolean> => {
    if (!opts.orchestrator) {
      return false;
    }
    const child = opts.orchestrator.manager.spawnChild(plan, parent, req);
    if (!child) {
      return false;
    }
    rebuildDag();
    // Parent continues; child will run when ready (depends on parent currently —
    // for mid-run help, clear the dep so child can run in parallel after unlock)
    child.deps = child.deps.filter((d) => d !== parent.id);
    try {
      rebuildDag();
    } catch {
      child.deps = [parent.id];
      rebuildDag();
    }
    wakeScheduler();
    return true;
  };

  const executeWithLocks = async (task: TaskNode): Promise<void> => {
    const prepared = opts.orchestrator
      ? opts.orchestrator.prepareTaskContext(plan, task)
      : task;

    emit('task_started', `Task started: ${prepared.id} (target ${prepared.recommendedTier})`, {
      taskId: prepared.id,
      data: {
        tier: prepared.recommendedTier,
        attempt: prepared.attempts ?? 0,
        role: prepared.role,
        modelPolicy: prepared.modelPolicy,
      },
    });

    let leaseId: string | undefined;

    try {
      const lease = await locks.acquire(
        prepared.ownedPaths,
        prepared.id,
        opts.lockTimeoutMs,
      );
      leaseId = lease.id;
      emit('lock_acquired', `Locks acquired for ${prepared.id}`, {
        taskId: prepared.id,
        data: { paths: lease.paths },
      });

      const result = await runWorkerTask(prepared, {
        llm: opts.llm,
        workspace: opts.workspace,
        bus: opts.bus,
        plan,
        modelId: preferredModel.get(prepared.id),
        sessionId: opts.sessionId,
        workspaceRoot: opts.workspaceRoot,
        browser: opts.browser,
        previewUrl: opts.previewUrl,
        designPreviewGate: opts.designPreviewGate,
        tools: opts.tools,
        onEvent: opts.onEvent,
        signal: opts.signal,
        enableSubagentLoop: opts.enableSubagentLoop,
        onDependencyRequest,
        shellExec: opts.shellExec,
        onContextRequest: opts.onContextRequest,
      });

      if (result.subagentResult) {
        prepared.result = result.subagentResult;
        const idx = plan.nodes.findIndex((n) => n.id === prepared.id);
        if (idx >= 0) {
          plan.nodes[idx]!.result = result.subagentResult;
        }
      }

      if (result.status === 'ok') {
        locks.commit(lease.id);
        prepared.status = 'done';
        done.add(prepared.id);
        results.push(result);
        emit('task_done', `Task done: ${prepared.id} · ${result.modelId}`, {
          taskId: prepared.id,
          data: {
            diffs: result.diffs.length,
            modelId: result.modelId,
            role: prepared.role,
            usage: result.usage,
            result: result.subagentResult,
          },
        });
        emit('subagent_completed', `Subagent completed: ${prepared.id}`, {
          taskId: prepared.id,
          data: { result: result.subagentResult, usage: result.usage },
        });
      } else {
        locks.abort(lease.id);
        leaseId = undefined;
        await handleFailure(prepared, result);
      }
    } catch (err) {
      if (leaseId) {
        locks.abort(leaseId);
        leaseId = undefined;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof LockTimeoutError) {
        emit('lock_timeout', message, { taskId: prepared.id });
      }
      await handleFailure(prepared, {
        taskId: prepared.id,
        diffs: [],
        busEvents: [],
        tokensUsed: 0,
        modelId: preferredModel.get(prepared.id) ?? 'unknown',
        status: 'error',
        error: message,
      });
    } finally {
      if (leaseId) {
        locks.release(leaseId);
        emit('lock_released', `Locks released for ${prepared.id}`, {
          taskId: prepared.id,
        });
      }
      inFlight.delete(prepared.id);
      trySchedule();
      wakeScheduler();
    }
  };

  trySchedule();

  while (pendingWork.length > 0 || inFlight.size > 0) {
    if (pendingWork.length === 0) {
      // Nothing dispatchable right now — sleep until a task completion (or
      // spawned child) wakes us. Bounded poll as a safety net for edge paths
      // that don't route through wakeScheduler.
      const woke = await Promise.race([
        waitForWakeupOrIdle().then(() => 'wake' as const),
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 50)),
      ]);
      if (
        woke === 'timeout' &&
        pendingWork.length === 0 &&
        inFlight.size === 0
      ) {
        break;
      }
      continue;
    }
    const batch = pendingWork.splice(0, pendingWork.length);
    await Promise.all(batch);
    trySchedule();
  }

  const leftoverReason = opts.signal?.aborted
    ? 'run aborted'
    : 'never scheduled (upstream unfinished or aborted)';
  for (const n of plan.nodes) {
    if (n.status === 'pending' || n.status === 'ready' || n.status === 'running') {
      n.status = 'cancelled';
      failed.add(n.id);
      emit('task_failed', `Task cancelled (${leftoverReason}): ${n.id}`, {
        taskId: n.id,
      });
      emit('subagent_cancelled', `Subagent cancelled: ${n.id}`, {
        taskId: n.id,
      });
    }
  }

  return {
    results,
    events,
    ok: failed.size === 0 && done.size === plan.nodes.length,
  };
}

/** Abort-aware backoff sleep for rate-limited tasks. */
async function rateLimitedRetryWait(
  taskId: string,
  waitMs: number,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await sleepAbortable(waitMs, signal);
  } catch (err) {
    throw Object.assign(new Error(`Task cancelled during rate-limit backoff: ${taskId}`), {
      cause: err,
    });
  }
}

function isRateLimitError(error: string | undefined): boolean {
  if (!error) {
    return false;
  }
  const e = error.toLowerCase();
  return /429|rate.?limit|too many requests/.test(e);
}

function cancelDependents(
  dag: Dag,
  failedId: string,
  failed: Set<string>,
  emit: (
    kind: RuntimeEvent['kind'],
    message: string,
    extra?: Partial<RuntimeEvent>,
  ) => void,
): void {
  const stack = [...(dag.dependents.get(failedId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (failed.has(id)) {
      continue;
    }
    const node = dag.nodes.get(id);
    if (!node || node.status === 'done') {
      continue;
    }
    node.status = 'cancelled';
    failed.add(id);
    emit('task_failed', `Task cancelled (upstream failure): ${id}`, {
      taskId: id,
    });
    emit('subagent_cancelled', `Subagent cancelled: ${id}`, { taskId: id });
    stack.push(...(dag.dependents.get(id) ?? []));
  }
}
