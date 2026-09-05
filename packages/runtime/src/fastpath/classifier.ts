/**
 * Fast path (Phase 13 P0): smallest safe mechanism for simple tasks.
 *
 * Classification is deterministic and cheap (regex only, zero LLM calls) and
 * decides on SCOPE + RISK signals rather than imperative wording: "fix" /
 * "add" / "rename" are eligible when the blast radius is one file or none;
 * architectural intent, schema/deps/public-API/security surfaces, multi-file
 * scope, or explicit planning/verification asks force the deep pipeline.
 * Uncertain ⇒ deep.
 */
import { classifyTask } from '@singularity/router';
import type {
  DiffHunk,
  RuntimeEvent,
  RuntimeRunResult,
  WorkerResult,
} from '../types.js';
import type { WorkspacePort, EditPort, LlmPort } from '../ports.js';
import { normalizePath } from '../ports.js';
import { parseWorkerJson } from '../worker/worker.js';

export type FastPathReason =
  | 'kill_switch'
  | 'trivial_chat'
  | 'pre_built_plan'
  | 'explicit_subagents'
  | 'blocking_tool_or_engine'
  | 'risky_scope'
  | 'multi_file_build'
  | 'planning_or_verification_requested'
  | 'goal_too_long_uncertain'
  | 'single_file_edit'
  | 'short_question';

export interface FastPathDecision {
  /** True when the single-call lane may run. */
  use: boolean;
  /** Audit trail — logged with every decision. */
  reason: FastPathReason;
  detail?: string;
}

/** Mirrors isTrivialChatPrompt (singularityPromptEngineBridge.ts) — greetings/identity. */
function isTrivialChatPrompt(prompt: string): boolean {
  const raw = prompt.trim();
  if (!raw || raw.length > 120) {
    return false;
  }
  const p = raw.toLowerCase().replace(/\s+/g, ' ');
  if (
    /\b(code|file|bug|error|fix|implement|build|create|refactor|function|component|page|api|design|landing)\b/.test(
      p,
    )
  ) {
    return false;
  }
  if (/^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|great|bye)[ !.]*$/i.test(p)) {
    return true;
  }
  if (/^what is singularity\b/.test(p)) {
    return true;
  }
  if (
    /\b(who are you|what are you|what'?s your name|how (are|have|is) (you|things)|what can you do)\b/.test(
      p,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Cross-file / tool-dependent asks — deep. A SINGLE file mention is fine
 * (checked separately by countFileMentions); two or more is cross-file work.
 */
function needsBlockingToolOrEngine(prompt: string): boolean {
  const p = prompt.toLowerCase();
  const mentions = prompt.match(/\.(tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|swift|css|json|md|vue|svelte)\b/gi)?.length ?? 0;
  if (mentions > 1) {
    return true;
  }
  if (/\b(in this (file|project|repo|codebase|workspace)|search the (repo|codebase)|read (the )?file)\b/.test(p)) {
    return true;
  }
  if (/\b(notion|slack|linear|jira|figma|github|gitlab|sentry|mcp|connectors?)\b/.test(p)) {
    return true;
  }
  if (/\b(run (the )?tests?|git (status|diff|log|commit))\b/.test(p)) {
    return true;
  }
  return false;
}

/**
 * Risk-scope signals — ANY hit forces the deep lane regardless of how small
 * the edit sounds (auth, schema, deps, public API surface, infra, security,
 * destructive ops). These map to the same families as riskPolicy.ts.
 */
const RISKY_SCOPE = new RegExp(
  [
    // auth / security
    '\\b(auth(?:entication|orization)?|login|logout|sessions?|jwt|oauth2?|access tokens?|permissions?|secrets?|encryption|passwords?|api[_ -]?keys?|credentials?)\\b',
    // database / schema
    '\\b(schema|migrations?|database|postgres(?:ql)?|mysql|sqlite|mongo\\w*|prisma|drizzle|orm model|dependency|dependencies)',
    // dependencies
    '\\b(npm install|yarn add|pnpm add|new dependency|package\\.json|lockfile|bump .*version)',
    // public API surface
    '\\b(public api|export(?:ed)? (?:interface|type|function|class|const|api)|breaking change|barrel (?:file|index)|semver)',
    // infrastructure / deploy
    '\\b(deploy(?:ment)?|docker|kubernetes|k8s|terraform|ci\\/cd|pipeline config|production[- ]safe|infrastructure)',
    // high-stakes business logic
    '\\b(payments?|billing|checkout|stripe|subscriptions?)',
    // destructive operations
    '\\b(delete (?:the )?(?:database|table|branch|directory|folder)|drop table|truncate table|wipe|purge|force push|rm -rf)',
    // explicit architecture intent
    '\\b(architect(?:ure|ural)?|across (?:the )?(?:app|application|codebase|system|services?|modules?|packages?)|all consumers?|every (?:caller|callsite|import)|end[- ]to[- ]end refactor|(?:two|three|four|five|six|seven|eight|nine|ten|\\d+)\\s+(?:files|modules|services|components|packages|layers))',
  ].join('|'),
  'i',
);

/** Multi-surface build verbs — always the deep pipeline's territory. */
const DEEP_BUILD =
  /\b(implement|build|create|scaffold|migrate|dashboard|full[- ]?stack|saas|application|website|landing page|add feature|refactor across|wire up|oauth)\b/i;

/** Explicit fan-out requests. */
const EXPLICIT_SUBAGENTS =
  /\b(use |with )?(sub ?agents?|parallel (tasks|workers)|dag|runtime v4|multi[- ]agent)\b/i;

/** Explicit planning / project-wide verification requests — deep by contract. */
const PLANNING_OR_VERIFICATION_REQUESTED =
  /\b(plan (?:this|the|first)|make a plan|plan it out|step[- ]by[- ]step plan|verify (?:this )?(?:across|the (?:whole|entire|project))|project[- ]wide verif|full verification|regression test|check every|audit)\b/i;

/** Pure knowledge questions — safe for a single streaming answer call. */
const INTERROGATIVE =
  /^\s*(what|how|why|when|which|who|explain|tell me about|can you explain|is|are|does|do)\b/i;

/** Count distinct repo-relative file paths mentioned in the goal. */
function countFileMentions(goal: string): number {
  const matches = goal.match(
    /[\w./@-]+\.(tsx|jsx|ts|js|mjs|cjs|py|go|rs|java|kt|swift|css|scss|json|md|vue|svelte)\b/gi,
  );
  return matches ? new Set(matches.map((m) => m.toLowerCase())).size : 0;
}

/** Hard length ceiling past which classification is "uncertain" ⇒ deep. */
const MAX_FAST_GOAL_CHARS = 400;

// Imperative verbs that describe SMALL, LOCALIZED edits. Scope/risk gates
// above decide safety; the verb itself never implies depth.
const LOCAL_EDIT_VERB =
  /\b(fix|add|update|change|rename|remove|delete|correct|adjust|tweak|clean(?: up)?)\b/i;

// Small-edit objects that keep an imperative in the fast lane when no risky
// scope signal fired (typo, comment, doc, null check…).
const SMALL_EDIT_OBJECT =
  /\b(typo|spelling|null check|guard clause|comment|jsdoc|docstring|documentation|log(ging)? message|error message|naming|variable name|indent(?:ation)?|formatting|whitespace|unused import|dead code|console\.log|readability)\b/i;

/**
 * Classify whether this goal may take the single-call lane.
 * Pure function — zero network, zero LLM calls.
 */
export function classifyFastPath(goal: string): FastPathDecision {
  if (process.env.SINGULARITY_FAST_PATH === '0') {
    return { use: false, reason: 'kill_switch', detail: 'SINGULARITY_FAST_PATH=0' };
  }
  if (isTrivialChatPrompt(goal)) {
    return { use: false, reason: 'trivial_chat' };
  }
  if (EXPLICIT_SUBAGENTS.test(goal)) {
    return { use: false, reason: 'explicit_subagents' };
  }
  if (PLANNING_OR_VERIFICATION_REQUESTED.test(goal)) {
    return { use: false, reason: 'planning_or_verification_requested' };
  }
  if (RISKY_SCOPE.test(goal)) {
    return { use: false, reason: 'risky_scope', detail: 'security/schema/deps/public-API/infra/destructive/architectural signal' };
  }
  if (needsBlockingToolOrEngine(goal)) {
    return { use: false, reason: 'blocking_tool_or_engine' };
  }
  if (DEEP_BUILD.test(goal)) {
    return { use: false, reason: 'multi_file_build' };
  }
  if (goal.trim().length > MAX_FAST_GOAL_CHARS) {
    return { use: false, reason: 'goal_too_long_uncertain' };
  }

  const fileCount = countFileMentions(goal);
  if (fileCount > 1) {
    return { use: false, reason: 'multi_file_build', detail: `${fileCount} files mentioned` };
  }

  // Single-file (or no-file) localized edits → FAST regardless of imperative verb.
  if (fileCount === 1 && LOCAL_EDIT_VERB.test(goal)) {
    return { use: true, reason: 'single_file_edit', detail: 'one file, small-edit verb, no risk signals' };
  }

  const task = classifyTask(goal);
  if (task.taskClass === 'edit_local' || task.taskClass === 'locate') {
    return {
      use: true,
      reason: fileCount === 1 ? 'single_file_edit' : 'short_question',
      detail: `task=${task.taskClass}`,
    };
  }
  // Small-object / local-function imperatives without a file mention ("Add a
  // null check here", "Fix this obvious bug in this function") stay FAST as
  // long as no risk/scope signal fired above.
  const LOCAL_FUNCTION_SCOPE =
    /\b(this (?:function|method|variable|line|block)|local variable|obvious bug)\b/i;
  if (task.taskClass !== 'review' && SMALL_EDIT_OBJECT.test(goal)) {
    return { use: true, reason: 'single_file_edit', detail: 'small localized object, no risk signals' };
  }
  if (task.taskClass !== 'review' && LOCAL_FUNCTION_SCOPE.test(goal)) {
    return { use: true, reason: 'single_file_edit', detail: 'local-function scope, no risk signals' };
  }
  // Pure knowledge questions with no build/tool signals → one answer call.
  if (
    task.taskClass === 'general' &&
    INTERROGATIVE.test(goal.trim()) &&
    goal.trim().length <= 160
  ) {
    return { use: true, reason: 'short_question', detail: 'interrogative-general' };
  }
  // implement/review/debug/general without any of the above ⇒ uncertain ⇒ deep.
  return { use: false, reason: 'multi_file_build', detail: `task=${task.taskClass}` };
}

/** Default enablement: ON unless the env kill-switch flips it off. */
export function isFastPathEnabled(): boolean {
  return process.env.SINGULARITY_FAST_PATH !== '0';
}

export type ComplexityLane = 'fast' | 'medium' | 'deep';

/**
 * Deterministic complexity lane (P1 proportionality):
 * - fast   : single-call lane eligible
 * - deep   : risky scope, explicit fan-out/planning asks, multi-file build verbs
 * - medium : everything else (bounded orchestration — planner + minimal workers,
 *            no review tail, capped fan-out)
 * Pure function — zero network, zero LLM calls.
 */
export function classifyComplexity(goal: string): ComplexityLane {
  if (classifyFastPath(goal).use) {
    return 'fast';
  }
  const deepSignals =
    EXPLICIT_SUBAGENTS.test(goal) ||
    PLANNING_OR_VERIFICATION_REQUESTED.test(goal) ||
    RISKY_SCOPE.test(goal) ||
    DEEP_BUILD.test(goal) ||
    countFileMentions(goal) > 1 ||
    goal.trim().length > MAX_FAST_GOAL_CHARS;
  return deepSignals ? 'deep' : 'medium';
}

const FASTPATH_SYSTEM = `You are Singularity's fast-path executor for small, well-scoped tasks.
Produce the minimal correct change. Return ONLY valid JSON:
{
  "summary": string,
  "diffs": [{"path": string, "newContent"?: string, "unifiedDiff"?: string, "isNew"?: boolean}]
}
Rules:
- Only touch files explicitly named by the user or strictly required by the change.
- Use "isNew": true only when creating a file that does not exist yet.
- Never invent paths. If the change cannot be done confidently, return {"summary": "...", "diffs": []}.`;

/** A diff is "invented" when the file doesn't exist, isn't marked new, or escapes the workspace. */
async function isInventedPath(
  workspace: WorkspacePort,
  d: DiffHunk,
): Promise<boolean> {
  const p = normalizePath(d.path);
  if (!p || p.startsWith('/') || p.includes('..') || /^[a-zA-Z]:\//.test(p)) {
    return true;
  }
  if (d.isNew) {
    return false;
  }
  const existing = await workspace.readFile(p);
  return existing === undefined;
}

export interface FastPathOutcome {
  ranFast: boolean;
  escalated?: boolean;
  result?: RuntimeRunResult;
}

/**
 * Execute the single-call lane. On lightweight-check failure or any error,
 * returns `ranFast: false` so the caller retries through the deep path once.
 */
export async function tryFastPath(input: {
  goal: string;
  llm: LlmPort;
  workspace: WorkspacePort;
  edit: EditPort;
  structuredContext?: string;
  sessionId?: string;
  signal?: AbortSignal;
  onEvent?: (event: RuntimeEvent) => void;
}): Promise<FastPathOutcome> {
  const started = Date.now();
  const emit = (event: Omit<RuntimeEvent, 'ts'>): void => input.onEvent?.({ ...event, ts: Date.now() });

  let text = '';
  let modelId = '';
  let tokensUsed = 0;
  try {
    const prompt = [
      input.structuredContext ? input.structuredContext : '',
      `Task: ${input.goal}`,
      'Apply the smallest correct change.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const llm = input.llm as LlmPort & {
      completeStream?: (req: unknown) => AsyncIterable<{
        delta?: string;
        reasoningDelta?: string;
        modelId?: string;
        tokensUsed?: number;
        done?: boolean;
      }>;
    };

    if (typeof llm.completeStream === 'function') {
      for await (const ev of llm.completeStream({
        role: 'worker',
        systemPrompt: FASTPATH_SYSTEM,
        prompt,
        preferredTier: 'T2',
        temperature: 0.1,
        sessionId: `${input.sessionId ?? 'runtime'}-fastpath`,
        skipPromptPipeline: false,
        signal: input.signal,
      })) {
        if (ev.delta) {
          text += ev.delta;
          emit({
            kind: 'subagent_progress_delta',
            taskId: 'fastpath',
            message: ev.delta,
            data: { lane: 'fastpath' },
          });
        }
        if (ev.tokensUsed) {
          tokensUsed += ev.tokensUsed;
        }
        if (ev.modelId) {
          modelId = ev.modelId;
        }
        if (input.signal?.aborted) {
          throw new Error('fast path aborted');
        }
      }
    } else {
      const r = await input.llm.complete({
        role: 'worker',
        systemPrompt: FASTPATH_SYSTEM,
        prompt,
        preferredTier: 'T2',
        temperature: 0.1,
        sessionId: `${input.sessionId ?? 'runtime'}-fastpath`,
        signal: input.signal,
      });
      text = r.text;
      modelId = r.modelId;
      tokensUsed = r.tokensUsed;
    }

    const parsed = parseWorkerJson(text);
    const diffs: DiffHunk[] = (parsed.diffs ?? [])
      .filter((d) => String(d.path ?? '').trim())
      .map((d) => ({
        path: normalizePath(String(d.path)),
        unifiedDiff: d.unifiedDiff ? String(d.unifiedDiff) : '',
        ...(d.newContent !== undefined ? { newContent: String(d.newContent) } : {}),
        ...(d.isNew ? { isNew: true } : {}),
      }));

    // Lightweight check #1: non-empty useful output.
    const summary = String((parsed as { summary?: unknown }).summary ?? '').trim();
    if (!summary && diffs.length === 0) {
      return { ranFast: false, escalated: true };
    }
    // Lightweight check #2: no invented paths.
    for (const d of diffs) {
      if (await isInventedPath(input.workspace, d)) {
        return { ranFast: false, escalated: true };
      }
    }

    emit({ kind: 'plan_created', message: `Fast path: ${input.goal.slice(0, 80)}`, data: { lane: 'fastpath' } });
    emit({ kind: 'integrate_started', message: 'Applying fast-path diffs', data: { count: diffs.length } });
    const { applied, conflicts } = await input.edit.applyDiffs(diffs);
    emit({
      kind: 'integrate_done',
      message: conflicts.length
        ? `Fast path applied ${applied.length} file(s), ${conflicts.length} conflict(s)`
        : `Fast path applied ${applied.length} file(s)`,
    });

    const workerResult: WorkerResult = {
      taskId: 'fastpath',
      diffs,
      busEvents: [],
      tokensUsed: tokensUsed || Math.max(1, Math.ceil(text.length / 4)),
      modelId: modelId || 'unknown',
      status: conflicts.length ? 'error' : 'ok',
      ...(conflicts.length ? { error: `conflicts: ${conflicts.join(', ')}` } : {}),
    };

    return {
      ranFast: true,
      result: {
        plan: {
          id: 'fastpath',
          goal: input.goal,
          projectSummary: '',
          nodes: [],
          estimates: {
            totalTokens: workerResult.tokensUsed,
            taskCount: 0,
            criticalPathLength: 0,
          },
          createdAt: started,
          ...(input.structuredContext ? { structuredContext: input.structuredContext } : {}),
        },
        results: [workerResult],
        appliedPaths: applied,
        events: [],
        ok: conflicts.length === 0 && Boolean(summary || diffs.length),
        summary:
          summary ||
          `Fast path completed (${applied.length} file${applied.length === 1 ? '' : 's'} changed)`,
        usage: {
          inputTokens: Math.floor(workerResult.tokensUsed * 0.6),
          outputTokens: Math.ceil(workerResult.tokensUsed * 0.4),
          cachedTokens: 0,
          estimatedCost: 0,
          latencyMs: Date.now() - started,
          model: modelId || 'unknown',
        },
        verification: { summary: 'Skipped (low-risk fast path)' },
        fastPath: true,
      },
    };
  } catch {
    // Any failure escalates to the deep path exactly once.
    return { ranFast: false, escalated: true };
  }
}
