import type { ContextBus } from '../bus/contextBus.js';
import type { EditPort, LlmPort, WorkspacePort } from '../ports.js';
import { normalizePath } from '../ports.js';
import {
  PARALLEL_IO_LIMIT,
  STAGE_DEFAULT_DEADLINES,
  parallelLimit,
  stageDeadlineMs,
  withDeadline,
} from '../parallel.js';
import type {
  DiffHunk,
  ExecutionPlan,
  RuntimeEvent,
  WorkerResult,
} from '../types.js';

export interface IntegratorOptions {
  edit: EditPort;
  workspace: WorkspacePort;
  llm: LlmPort;
  bus: ContextBus;
  onEvent?: (event: RuntimeEvent) => void;
  sessionId?: string;
  /** Cancellation propagated into the integrator LLM pass. */
  signal?: AbortSignal;
}

export interface IntegrateResult {
  appliedPaths: string[];
  conflicts: string[];
  events: RuntimeEvent[];
  ok: boolean;
  summary: string;
}

const INTEGRATOR_SYSTEM = `You are the Singularity Runtime integrator.
Resolve residual merge conflicts and shared import/export issues.
Return ONLY JSON:
{
  "diffs": [
    { "path": string, "unifiedDiff": string, "newContent": string (optional) }
  ],
  "summary": string
}`;

/**
 * Apply worker diffs in completion order. On residual conflicts, one LLM pass.
 */
export async function integrateResults(
  plan: ExecutionPlan,
  results: WorkerResult[],
  opts: IntegratorOptions,
): Promise<IntegrateResult> {
  const events: RuntimeEvent[] = [];
  const emit = (
    kind: RuntimeEvent['kind'],
    message: string,
    data?: Record<string, unknown>,
  ): void => {
    const ev: RuntimeEvent = { kind, ts: Date.now(), message, data };
    events.push(ev);
    opts.onEvent?.(ev);
  };

  emit('integrate_started', 'Integration started', {
    resultCount: results.length,
  });

  const appliedPaths: string[] = [];
  const allConflicts: string[] = [];

  // Completion order as provided by scheduler results array
  for (const result of results) {
    if (result.status !== 'ok' || result.diffs.length === 0) {
      continue;
    }
    const { applied, conflicts } = await opts.edit.applyDiffs(result.diffs);
    appliedPaths.push(...applied.map(normalizePath));
    allConflicts.push(...conflicts.map(normalizePath));
  }

  // ChangeRequests from bus — fold into conflict set for LLM pass
  const changeReqs = opts.bus
    .getEvents()
    .filter((e) => e.kind === 'ChangeRequest' && e.path)
    .map((e) => normalizePath(e.path!));
  const uniqueConflicts = [...new Set([...allConflicts, ...changeReqs])];

  if (uniqueConflicts.length > 0) {
    emit('integrate_conflict', 'Residual conflicts detected', {
      paths: uniqueConflicts,
    });
    const repaired = await runIntegratorLlmPass(
      plan,
      uniqueConflicts,
      results,
      opts,
    );
    if (repaired.diffs.length) {
      const { applied, conflicts } = await opts.edit.applyDiffs(repaired.diffs);
      appliedPaths.push(...applied.map(normalizePath));
      // Replace conflict list with remaining
      allConflicts.length = 0;
      allConflicts.push(...conflicts.map(normalizePath));
    }
  }

  const uniqueApplied = [...new Set(appliedPaths)];
  if (opts.edit.format) {
    await opts.edit.format(uniqueApplied);
  }

  const shortGoal = plan.goal.replace(/\s+/g, ' ').trim().slice(0, 80);
  const summary =
    uniqueConflicts.length > 0 && allConflicts.length > 0
      ? `Integrated with remaining conflicts on: ${allConflicts.join(', ')}`
      : `Integrated ${uniqueApplied.length} file(s)${shortGoal ? ` — ${shortGoal}${plan.goal.length > 80 ? '…' : ''}` : ''}`;

  emit('integrate_done', summary, {
    applied: uniqueApplied,
    conflicts: allConflicts,
  });

  return {
    appliedPaths: uniqueApplied,
    conflicts: [...new Set(allConflicts)],
    events,
    ok: allConflicts.length === 0,
    summary,
  };
}

async function runIntegratorLlmPass(
  plan: ExecutionPlan,
  conflictPaths: string[],
  results: WorkerResult[],
  opts: IntegratorOptions,
): Promise<{ diffs: DiffHunk[]; summary: string }> {
  // Conflict file reads are independent — bounded parallel fetch, stable order.
  const contents = await parallelLimit(conflictPaths, PARALLEL_IO_LIMIT, (p) =>
    opts.workspace.readFile(p),
  );
  const fileBlocks: string[] = [];
  for (let i = 0; i < conflictPaths.length; i++) {
    const p = conflictPaths[i]!;
    const content = contents[i];
    fileBlocks.push(
      `### ${p}\n\`\`\`\n${content ?? '(missing)'}\n\`\`\``,
    );
  }

  const workerNotes = results
    .filter((r) => r.changeRequests?.length)
    .map(
      (r) =>
        `- ${r.taskId} changeRequests: ${(r.changeRequests ?? []).join(', ')}`,
    )
    .join('\n');

  const prompt = [
    `Goal: ${plan.goal}`,
    `Project: ${plan.projectSummary}`,
    `Conflict / shared paths:\n${conflictPaths.map((p) => `- ${p}`).join('\n')}`,
    workerNotes ? `Worker change requests:\n${workerNotes}` : '',
    'Current file contents:',
    fileBlocks.join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    // Bounded integrator pass: on timeout the existing "Integrator LLM pass
    // failed" fallback returns empty diffs (behavior-preserving, just bounded).
    const integratorDeadline =
      stageDeadlineMs(
        'SINGULARITY_INTEGRATOR_DEADLINE_MS',
        STAGE_DEFAULT_DEADLINES.integrator,
      ) ?? Number.MAX_SAFE_INTEGER;
    const completion = await withDeadline(
      opts.llm.complete({
        role: 'integrator',
        systemPrompt: INTEGRATOR_SYSTEM,
        prompt,
        preferredTier: 'T5',
        temperature: 0.1,
        sessionId: opts.sessionId ?? 'integrator',
        signal: opts.signal,
      }),
      integratorDeadline,
      'Integrator',
    );
    const parsed = JSON.parse(stripFence(completion.text)) as {
      diffs?: DiffHunk[];
      summary?: string;
    };
    return {
      diffs: (parsed.diffs ?? []).map((d) => ({
        ...d,
        path: normalizePath(d.path),
      })),
      summary: parsed.summary ?? 'Integrator pass complete',
    };
  } catch {
    return { diffs: [], summary: 'Integrator LLM pass failed' };
  }
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fence ? fence[1]!.trim() : trimmed;
}
