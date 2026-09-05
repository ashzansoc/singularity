/**
 * Bounded multi-iteration tool-using subagent loop.
 */

import type { ContextBus } from '../bus/contextBus.js';
import type { LlmPort, ToolPort, WorkspacePort } from '../ports.js';
import { normalizePath } from '../ports.js';
import type {
  BusEvent,
  DiffHunk,
  ExecutionPlan,
  RuntimeEvent,
  TaskNode,
  WorkerResult,
} from '../types.js';
import {
  buildSubagentContext,
  collectDependencyResults,
} from './context.js';
import { resolveModelRouting } from './modelPolicy.js';
import {
  createPermissionedPorts,
  executeToolCall,
} from './permissions.js';
import {
  READONLY_TOOL_CONCURRENCY,
  isReadOnlyTool,
  parallelLimit,
} from '../parallel.js';
import { enrichTaskNodeAsSubagent, workerDiffsToFileLists } from './mappers.js';
import type {
  AgentLoopTurn,
  FailureClass,
  SubagentDependencyRequest,
  SubagentResult,
  SubagentUsage,
} from './types.js';
import { emptySubagentResult } from './types.js';

const AGENT_SYSTEM = `You are a Singularity bounded subagent.
Edit ONLY owned paths. Respect tool permissions.
Return ONLY valid JSON each turn (no markdown fences):
{
  "progress": string (optional safe summary — no hidden chain-of-thought),
  "toolCalls": [{"name": "read_file"|"search_files"|"list_directory"|"write_file"|"terminal"|"typecheck"|"test"|"git_status"|"git_diff", "args": {}}],
  "diffs": [{"path": string, "unifiedDiff": string, "newContent": string, "isNew": boolean}],
  "changeRequests": string[],
  "messages": [{"type":"dependency_request","from":string,"requestedRole":string,"objective":string,"ownedPaths":string[]}],
  "result": {
    "status": "success"|"partial"|"failed",
    "summary": string,
    "filesCreated": string[],
    "filesModified": string[],
    "filesDeleted": string[],
    "testsRun": string[],
    "testsPassed": string[],
    "testsFailed": string[],
    "issues": string[],
    "recommendations": string[],
    "review": {"approved": boolean, "issues": [{"severity":"critical"|"major"|"minor","file":string,"line":number,"description":string}], "recommendations": string[]}
  },
  "needs_more_context": boolean,
  "requested_files": string[],
  "reason": string
}
When finished, omit toolCalls and provide result. Prefer newContent for full-file writes.
If a required file is missing from context, set needs_more_context true with requested_files and reason instead of guessing.
Do not invent edits outside owned paths.`;

export interface SubagentLoopOptions {
  llm: LlmPort;
  workspace: WorkspacePort;
  tools?: ToolPort;
  bus: ContextBus;
  plan: ExecutionPlan;
  modelId?: string;
  sessionId?: string;
  onEvent?: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
  shellExec?: (command: string) => Promise<{ ok: boolean; output: string }>;
  /** Called when the agent requests a child subagent. Return false to reject. */
  onDependencyRequest?: (
    req: SubagentDependencyRequest,
    parent: TaskNode,
  ) => Promise<boolean>;
  /** Neural Relay: append extra files and continue the same task. */
  onContextRequest?: (req: {
    requested_files: string[];
    reason: string;
  }) => Promise<string | undefined>;
}

function emitSubagent(
  onEvent: SubagentLoopOptions['onEvent'],
  kind: RuntimeEvent['kind'],
  taskId: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  onEvent?.({
    kind,
    ts: Date.now(),
    taskId,
    message,
    data,
  });
}

export function parseAgentTurn(text: string): AgentLoopTurn {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence ? fence[1]!.trim() : trimmed;
  try {
    return JSON.parse(jsonText) as AgentLoopTurn;
  } catch {
    // Tolerate trailing prose: find first { ... last }
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(jsonText.slice(start, end + 1)) as AgentLoopTurn;
    }
    throw new Error('Subagent response was not valid JSON');
  }
}

export function classifyFailure(error: string | undefined): FailureClass {
  if (!error) {
    return 'unknown';
  }
  const e = error.toLowerCase();
  if (/abort|cancel/.test(e)) {
    return 'cancelled';
  }
  if (/lock.?timeout|locktimeout/.test(e)) {
    return 'lock_timeout';
  }
  if (/tool|permission|not permitted/.test(e)) {
    return 'tool_failure';
  }
  if (/review|rejected|critical|major/.test(e)) {
    return 'review_reject';
  }
  if (/timeout|timed out/.test(e)) {
    return 'timeout';
  }
  if (/provider|gateway|model_not_found|503|429/.test(e)) {
    return 'provider_error';
  }
  if (/quality|low_quality/.test(e)) {
    return 'low_quality';
  }
  return 'unknown';
}

/**
 * Run a bounded tool-using agent loop for a TaskNode/subagent.
 */
export async function runSubagentLoop(
  task: TaskNode,
  opts: SubagentLoopOptions,
): Promise<WorkerResult> {
  const node = enrichTaskNodeAsSubagent(task);
  const started = Date.now();
  const maxIter = node.maxIterations ?? 8;
  const timeoutMs = node.timeoutMs ?? 240_000;
  const routing = resolveModelRouting(node.modelPolicy);

  const depResults = collectDependencyResults(opts.plan, node);
  let filtered = buildSubagentContext({
    task: node,
    plan: opts.plan,
    parentContext: node.filteredContext ?? opts.plan.structuredContext,
    dependencyResults: depResults,
  });
  node.filteredContext = filtered;

  const ports = createPermissionedPorts(
    { workspace: opts.workspace, tools: opts.tools },
    node.tools ?? [],
    {
      allowedPaths: node.ownedPaths,
      deniedPaths: node.deniedPaths,
    },
  );

  emitSubagent(
    opts.onEvent,
    'subagent_started',
    node.id,
    `Subagent ${node.role} started: ${node.id}`,
    {
      role: node.role,
      modelPolicy: node.modelPolicy,
      tools: node.tools,
    },
  );

  const allDiffs: DiffHunk[] = [];
  const allBus: BusEvent[] = [];
  const changeRequests: string[] = [];
  let tokensUsed = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let modelId = opts.modelId ?? routing.modelId ?? 'unknown';
  const toolTrace: string[] = [];
  let lastSummary = '';

  const transcript: Array<{ role: 'user' | 'assistant' | 'tool'; content: string }> =
    [];

  const deadline = started + timeoutMs;

  for (let iter = 0; iter < maxIter; iter++) {
    if (opts.signal?.aborted) {
      return failResult(node.id, modelId, tokensUsed, 'Aborted', started, {
        inputTokens,
        outputTokens,
      });
    }
    if (Date.now() > deadline) {
      return failResult(node.id, modelId, tokensUsed, 'Subagent timeout', started, {
        inputTokens,
        outputTokens,
      });
    }

    const prompt = [
      filtered,
      `Iteration: ${iter + 1}/${maxIter}`,
      `Goal: ${opts.plan.goal}`,
      `Task: ${node.title}`,
      `Objective: ${node.objective ?? node.title}`,
      `Expected output: ${node.expectedOutput}`,
      `Allowed tools: ${(node.tools ?? []).join(', ')}`,
      toolTrace.length
        ? `Recent tool results:\n${toolTrace.slice(-6).join('\n\n')}`
        : '',
      transcript.length
        ? `Prior turns:\n${transcript
            .slice(-4)
            .map((t) => `${t.role}: ${t.content.slice(0, 1500)}`)
            .join('\n')}`
        : '',
      'Respond with the next JSON turn.',
    ]
      .filter(Boolean)
      .join('\n\n');

    let completion;
    try {
      // Prefer streaming so the panel renders output incrementally; the agent
      // turn itself is still parsed from the fully-buffered text.
      if (typeof opts.llm.completeStream === 'function') {
        let streamed = '';
        let streamedModelId: string | undefined;
        let streamedTokens = 0;
        let lastEmit = 0;
        for await (const ev of opts.llm.completeStream({
          role: 'worker',
          systemPrompt: AGENT_SYSTEM,
          prompt,
          preferredTier: routing.preferredTier,
          modelId: opts.modelId ?? routing.modelId,
          temperature: routing.temperature,
          sessionId: opts.sessionId ?? `subagent-${node.id}`,
          builderUpdate: {
            userPrompt: prompt,
            systemPrompt: AGENT_SYSTEM,
            intent: routing.intent,
            currentFileUri: node.ownedPaths[0],
          },
        })) {
          if (ev.delta) {
            streamed += ev.delta;
            const now = Date.now();
            if (now - lastEmit >= 100) {
              lastEmit = now;
              emitSubagent(opts.onEvent, 'subagent_progress_delta', node.id, '', {
                delta: ev.delta,
              });
            }
          }
          if (ev.modelId) {
            streamedModelId = ev.modelId;
          }
          if (ev.tokensUsed) {
            streamedTokens = ev.tokensUsed;
          }
        }
        completion = {
          text: streamed,
          modelId: streamedModelId ?? opts.modelId ?? routing.modelId ?? '',
          tokensUsed: streamedTokens || Math.ceil(streamed.length / 4),
        };
      } else {
        completion = await opts.llm.complete({
          role: node.role === 'reviewer' ? 'worker' : 'worker',
          systemPrompt: AGENT_SYSTEM,
          prompt,
          preferredTier: routing.preferredTier,
          modelId: opts.modelId ?? routing.modelId,
          temperature: routing.temperature,
          sessionId: opts.sessionId ?? `subagent-${node.id}`,
          builderUpdate: {
            userPrompt: prompt,
            systemPrompt: AGENT_SYSTEM,
            intent: routing.intent,
            currentFileUri: node.ownedPaths[0],
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return failResult(node.id, modelId, tokensUsed, message, started, {
        inputTokens,
        outputTokens,
      });
    }

    modelId = completion.modelId;
    tokensUsed += completion.tokensUsed;
    // Approximate split when provider doesn't break out usage
    inputTokens += Math.floor(completion.tokensUsed * 0.6);
    outputTokens += Math.ceil(completion.tokensUsed * 0.4);

    let turn: AgentLoopTurn;
    try {
      turn = parseAgentTurn(completion.text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitSubagent(
        opts.onEvent,
        'subagent_progress',
        node.id,
        `Parse error on turn ${iter + 1}`,
        { error: message },
      );
      transcript.push({ role: 'assistant', content: completion.text.slice(0, 2000) });
      toolTrace.push(`parse_error: ${message}`);
      continue;
    }

    if (turn.progress) {
      lastSummary = turn.progress;
      emitSubagent(
        opts.onEvent,
        'subagent_progress',
        node.id,
        turn.progress,
        { iteration: iter + 1 },
      );
    }

    transcript.push({
      role: 'assistant',
      content: JSON.stringify({
        progress: turn.progress,
        toolCalls: turn.toolCalls?.map((t) => t.name),
        hasResult: Boolean(turn.result),
        diffCount: turn.diffs?.length ?? 0,
      }),
    });

    // Tool calls — read-only tools run with bounded concurrency; write tools
    // stay sequential (ordering-sensitive).
    if (turn.toolCalls?.length) {
      const calls = turn.toolCalls;
      const readonlyIdx = calls.map((c, i) => (isReadOnlyTool(String(c.name)) ? i : -1)).filter((i) => i >= 0);
      const runOne = async (i: number) => {
        const call = calls[i]!;
        emitSubagent(
          opts.onEvent,
          'subagent_tool_call',
          node.id,
          `tool:${call.name}`,
          {
            name: call.name,
            args: summarizeArgs(call.args),
          },
        );
        const result = await executeToolCall(
          ports,
          String(call.name),
          call.args ?? {},
          opts.shellExec,
        );
        return { i, call, result };
      };
      let executed: Array<{ i: number; call: (typeof calls)[number]; result: { ok: boolean; output: string } }>;
      if (readonlyIdx.length > 1 && readonlyIdx.length === calls.length) {
        // All read-only → bounded parallel batch.
        const done = await parallelLimit(
          readonlyIdx,
          READONLY_TOOL_CONCURRENCY,
          (i) => runOne(i),
        );
        executed = done.sort((a, b) => a.i - b.i);
      } else {
        executed = [];
        for (let i = 0; i < calls.length; i++) {
          executed.push(await runOne(i));
        }
      }
      for (const { call, result } of executed) {
        const snippet = result.output.slice(0, 4_000);
        toolTrace.push(`${call.name}: ${result.ok ? 'ok' : 'err'}\n${snippet}`);
        transcript.push({
          role: 'tool',
          content: `${call.name}: ${snippet.slice(0, 1500)}`,
        });
      }
    }

    // Diffs this turn
    if (turn.diffs?.length) {
      const owned = new Set(node.ownedPaths.map((p) => normalizePath(p)));
      const { kept, rejected } = filterDiffsByOwnership(turn.diffs, owned);
      allDiffs.push(...kept);
      if (rejected.length) {
        changeRequests.push(...rejected);
        for (const path of rejected) {
          allBus.push(
            opts.bus.emitKind(
              'ChangeRequest',
              node.id,
              `Needs edit outside ownership: ${path}`,
              { path },
            ),
          );
        }
      }
    }

    if (turn.changeRequests?.length) {
      changeRequests.push(...turn.changeRequests);
    }

    if (
      turn.needs_more_context &&
      turn.requested_files?.length &&
      opts.onContextRequest
    ) {
      const extra = await opts.onContextRequest({
        requested_files: turn.requested_files.map(String),
        reason: String(turn.reason ?? 'needs more context'),
      });
      if (extra?.trim()) {
        filtered = `${filtered}\n\n${extra.trim()}`;
        toolTrace.push(
          `context_expansion: ${turn.requested_files.join(', ')}\n${extra.slice(0, 2_000)}`,
        );
        emitSubagent(
          opts.onEvent,
          'subagent_progress',
          node.id,
          `Retrieved ${turn.requested_files.length} additional context file(s)`,
          { files: turn.requested_files, reason: turn.reason },
        );
        continue;
      }
    }

    // Dependency / clarification messages
    if (turn.messages?.length) {
      for (const msg of turn.messages) {
        if (msg.type === 'dependency_request') {
          emitSubagent(
            opts.onEvent,
            'subagent_waiting',
            node.id,
            `Waiting on ${msg.requestedRole}: ${msg.objective}`,
            { request: msg },
          );
          node.waitingReason = msg.objective;
          opts.bus.emitKind(
            'DependencyRequest',
            node.id,
            msg.objective,
            { payload: msg as unknown as Record<string, unknown> },
          );
          if (opts.onDependencyRequest) {
            const accepted = await opts.onDependencyRequest(msg, node);
            toolTrace.push(
              `dependency_request ${msg.requestedRole}: ${accepted ? 'accepted' : 'rejected'}`,
            );
          }
        }
      }
    }

    for (const be of turn.busEvents ?? []) {
      allBus.push(
        opts.bus.emit({
          kind: (be.kind as BusEvent['kind']) || 'Custom',
          taskId: node.id,
          message: be.message ?? '',
          path: be.path,
          payload: be.payload,
        }),
      );
    }

    // Final result
    if (
      turn.result ||
      ((turn.diffs?.length || turn.changeRequests?.length) &&
        (!turn.toolCalls || turn.toolCalls.length === 0))
    ) {
      const fileLists = workerDiffsToFileLists(allDiffs);
      const usage: SubagentUsage = {
        inputTokens,
        outputTokens,
        cachedTokens: 0,
        estimatedCost: estimateCost(inputTokens, outputTokens),
        latencyMs: Date.now() - started,
        model: modelId,
      };
      const synthesizedStatus =
        turn.result?.status ??
        (allDiffs.length || turn.diffs?.length ? 'success' : 'partial');
      const subResult: SubagentResult = {
        ...emptySubagentResult(node.id),
        ...turn.result,
        subagentId: node.id,
        status: synthesizedStatus,
        summary:
          turn.result?.summary ??
          lastSummary ??
          turn.progress ??
          `Completed ${node.objective ?? node.title}`,
        filesCreated: turn.result?.filesCreated?.length
          ? turn.result.filesCreated
          : fileLists.filesCreated,
        filesModified: turn.result?.filesModified?.length
          ? turn.result.filesModified
          : fileLists.filesModified,
        filesDeleted: turn.result?.filesDeleted ?? [],
        testsRun: turn.result?.testsRun ?? [],
        testsPassed: turn.result?.testsPassed ?? [],
        testsFailed: turn.result?.testsFailed ?? [],
        issues: turn.result?.issues ?? [],
        recommendations: turn.result?.recommendations ?? [],
        artifacts: turn.result?.artifacts,
        usage,
        review: turn.result?.review,
      };

      // Reviewer rejection → treat as error so scheduler can spawn fixer
      if (
        node.role === 'reviewer' &&
        subResult.review &&
        !subResult.review.approved &&
        subResult.review.issues.some(
          (i) => i.severity === 'critical' || i.severity === 'major',
        )
      ) {
        opts.bus.emitKind('SubagentResult', node.id, subResult.summary, {
          payload: subResult as unknown as Record<string, unknown>,
        });
        emitSubagent(
          opts.onEvent,
          'subagent_failed',
          node.id,
          'Review rejected with critical/major issues',
          { review: subResult.review },
        );
        return {
          taskId: node.id,
          diffs: allDiffs,
          busEvents: allBus,
          tokensUsed,
          modelId,
          status: 'error',
          error: 'review_reject',
          changeRequests: [...new Set(changeRequests)],
          subagentResult: subResult,
          usage,
        };
      }

      opts.bus.emitKind('SubagentResult', node.id, subResult.summary, {
        payload: subResult as unknown as Record<string, unknown>,
      });
      opts.bus.emitKind('TaskSummary', node.id, subResult.summary);

      const ok = subResult.status !== 'failed';
      emitSubagent(
        opts.onEvent,
        ok ? 'subagent_completed' : 'subagent_failed',
        node.id,
        subResult.summary,
        { result: subResult },
      );

      return {
        taskId: node.id,
        diffs: allDiffs,
        busEvents: allBus,
        tokensUsed,
        modelId,
        status: ok ? 'ok' : 'error',
        error: ok ? undefined : subResult.summary,
        changeRequests: [...new Set(changeRequests)],
        subagentResult: subResult,
        usage,
      };
    }
  }

  // Exhausted iterations — partial success if we have diffs
  const fileLists = workerDiffsToFileLists(allDiffs);
  const usage: SubagentUsage = {
    inputTokens,
    outputTokens,
    cachedTokens: 0,
    estimatedCost: estimateCost(inputTokens, outputTokens),
    latencyMs: Date.now() - started,
    model: modelId,
  };
  const partial: SubagentResult = {
    ...emptySubagentResult(node.id),
    status: allDiffs.length ? 'partial' : 'failed',
    summary: lastSummary || 'Reached max iterations without final result',
    filesCreated: fileLists.filesCreated,
    filesModified: fileLists.filesModified,
    issues: ['max_iterations'],
    usage,
  };
  emitSubagent(
    opts.onEvent,
    partial.status === 'partial' ? 'subagent_completed' : 'subagent_failed',
    node.id,
    partial.summary,
    { result: partial },
  );

  return {
    taskId: node.id,
    diffs: allDiffs,
    busEvents: allBus,
    tokensUsed,
    modelId,
    status: partial.status === 'failed' ? 'error' : 'ok',
    error: partial.status === 'failed' ? partial.summary : undefined,
    changeRequests: [...new Set(changeRequests)],
    subagentResult: partial,
    usage,
  };
}

function failResult(
  taskId: string,
  modelId: string,
  tokensUsed: number,
  error: string,
  started: number,
  tokens: { inputTokens: number; outputTokens: number },
): WorkerResult {
  const usage: SubagentUsage = {
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    cachedTokens: 0,
    estimatedCost: estimateCost(tokens.inputTokens, tokens.outputTokens),
    latencyMs: Date.now() - started,
    model: modelId,
  };
  return {
    taskId,
    diffs: [],
    busEvents: [],
    tokensUsed,
    modelId,
    status: 'error',
    error,
    subagentResult: {
      ...emptySubagentResult(taskId),
      status: 'failed',
      summary: error,
      issues: [classifyFailure(error)],
      usage,
    },
    usage,
  };
}

function summarizeArgs(args?: Record<string, unknown>): Record<string, unknown> {
  if (!args) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 200) {
      out[k] = `${v.slice(0, 200)}…`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function estimateCost(input: number, output: number): number {
  // Rough USD estimate ($0.5 / M input, $1.5 / M output) — accounting only
  return (input / 1e6) * 0.5 + (output / 1e6) * 1.5;
}

function filterDiffsByOwnership(
  diffs: DiffHunk[],
  owned: Set<string>,
): { kept: DiffHunk[]; rejected: string[] } {
  const kept: DiffHunk[] = [];
  const rejected: string[] = [];
  for (const d of diffs) {
    const path = normalizePath(String(d.path ?? ''));
    if (!path) continue;
    if (owned.size) {
      const underOwned = [...owned].some(
        (o) => path === o || path.startsWith(`${o.replace(/\/$/, '')}/`),
      );
      if (!underOwned) {
        rejected.push(path);
        continue;
      }
    }
    kept.push({
      path,
      unifiedDiff: d.unifiedDiff ?? '',
      newContent: d.newContent,
      isNew: d.isNew,
    });
  }
  return { kept, rejected };
}
