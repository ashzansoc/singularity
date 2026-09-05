import type { Tier } from '@singularity/router';
import type { DiffHunk } from './types.js';
import type { TaskNode, WorkerResult } from './types.js';
import type { SubagentResult } from './subagent/types.js';

/** Role of an LLM call inside the runtime pipeline. */
export type LlmRole =
  | 'planner'
  | 'worker'
  | 'integrator'
  | 'design-director'
  | 'visual-critic';

export interface LlmCompleteRequest {
  role: LlmRole;
  prompt: string;
  systemPrompt?: string;
  /** Preferred minimum tier band (planner/integrator use higher tiers). */
  preferredTier?: Tier;
  /** Force a specific model id (retries / escalate). */
  modelId?: string;
  temperature?: number;
  /** Opaque session key for prompt cache affinity. */
  sessionId?: string;
  /** Structured context for Prompt Engine (Context Economy). */
  builderUpdate?: {
    userPrompt?: string;
    systemPrompt?: string;
    files?: Array<{
      uri: string;
      content: string;
      version: number;
      languageId?: string;
    }>;
    conversation?: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      createdAt: number;
    }>;
    intent?: string;
    currentFileUri?: string;
  };
  /** Skip prompt pipeline (integrator may set true). */
  skipPromptPipeline?: boolean;
  cacheable?: boolean;
  /** Cancellation propagated to the provider when supported. */
  signal?: AbortSignal;
}

export interface LlmCompleteResult {
  text: string;
  modelId: string;
  tokensUsed: number;
  tier?: Tier;
}

/**
 * Abstraction over model completion. Production wires createSingularityAI;
 * tests use fixtures.
 */
export interface LlmPort {
  complete(req: LlmCompleteRequest): Promise<LlmCompleteResult>;
  /**
   * Optional streaming variant. Yields text deltas as they arrive; default
   * implementations may fall back to `complete` (single final delta).
   */
  completeStream?(
    req: LlmCompleteRequest,
  ): AsyncIterable<LlmStreamDelta>;
  /**
   * Escalate to a higher-tier / fallback model for the next attempt.
   * Returns undefined when the chain is exhausted.
   */
  escalate?(
    previousModelId: string,
    reason: 'timeout' | 'low_quality' | 'tool_failure' | 'provider_error' | 'quality_score_low',
  ): Promise<{ modelId: string; tier?: Tier } | undefined>;
}

export interface LlmStreamDelta {
  delta?: string;
  reasoningDelta?: string;
  modelId?: string;
  /** Present on the final event when the provider reports usage. */
  tokensUsed?: number;
  done?: boolean;
}

/** Deterministic tools — prefer these over asking the LLM. */
export interface ToolPort {
  searchText?(pattern: string, glob?: string): Promise<Array<{ path: string; line: number; text: string }>>;
  gitDiff?(paths?: string[]): Promise<string>;
  gitStatus?(): Promise<string>;
  typecheck?(paths?: string[]): Promise<{ ok: boolean; output: string }>;
  test?(paths?: string[]): Promise<{ ok: boolean; output: string }>;
}

/** Read / list workspace files. */
export interface WorkspacePort {
  readFile(path: string): Promise<string | undefined>;
  writeFile?(path: string, content: string): Promise<void>;
  listFiles?(glob?: string): Promise<string[]>;
  /** Optional 1-hop neighbors for scoped worker context. */
  neighbors?(path: string): Promise<string[]>;
  /** Optional lexical search (rg). */
  searchText?(pattern: string, glob?: string): Promise<Array<{ path: string; line: number; text: string }>>;
}

/** Apply diffs / format. IDE implements via VS Code edit APIs. */
export interface EditPort {
  applyDiffs(diffs: DiffHunk[]): Promise<{ applied: string[]; conflicts: string[] }>;
  format?(paths: string[]): Promise<void>;
}

/**
 * Human-in-the-loop Design Preview (Penpot / Spec board) before coding.
 * IDE shows modal + webview; headless runtimes may auto-skip.
 */
export interface DesignPreviewGatePort {
  runGate(input: {
    workspaceRoot: string;
    specPath: string;
    goal?: string;
  }): Promise<'approved' | 'skipped'>;
}

/** In-memory workspace for unit tests. */
export class InMemoryWorkspace implements WorkspacePort {
  readonly files = new Map<string, string>();
  private readonly neighborMap = new Map<string, string[]>();

  constructor(initial?: Record<string, string>) {
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        this.files.set(normalizePath(k), v);
      }
    }
  }

  setNeighbors(path: string, neighbors: string[]): void {
    this.neighborMap.set(normalizePath(path), neighbors.map(normalizePath));
  }

  async readFile(path: string): Promise<string | undefined> {
    return this.files.get(normalizePath(path));
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(normalizePath(path), content);
  }

  async listFiles(): Promise<string[]> {
    return [...this.files.keys()].sort();
  }

  async neighbors(path: string): Promise<string[]> {
    return this.neighborMap.get(normalizePath(path)) ?? [];
  }
}

/** EditPort that applies full-content / simple patch replacements into an InMemoryWorkspace. */
export class InMemoryEditPort implements EditPort {
  constructor(private readonly workspace: InMemoryWorkspace) {}

  async applyDiffs(
    diffs: DiffHunk[],
  ): Promise<{ applied: string[]; conflicts: string[] }> {
    const applied: string[] = [];
    const conflicts: string[] = [];
    for (const d of diffs) {
      const path = normalizePath(d.path);
      if (d.newContent !== undefined) {
        await this.workspace.writeFile!(path, d.newContent);
        applied.push(path);
        continue;
      }
      const current = await this.workspace.readFile(path);
      const patched = applyUnifiedDiff(current ?? '', d.unifiedDiff);
      if (patched === null) {
        conflicts.push(path);
        continue;
      }
      await this.workspace.writeFile!(path, patched);
      applied.push(path);
    }
    return { applied, conflicts };
  }

  async format(_paths: string[]): Promise<void> {
    /* no-op for MVP */
  }
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Minimal unified-diff applier for tests. Supports full-file replacement via
 * `newContent` on DiffHunk; for unified diffs, prefers a simple find/replace
 * of removed → added lines within @@ hunks. Returns null on conflict.
 */
export function applyUnifiedDiff(original: string, unifiedDiff: string): string | null {
  if (!unifiedDiff.trim()) {
    return original;
  }
  // If the diff embeds a full-file marker, treat trailing content as replacement.
  const fullMatch = unifiedDiff.match(/<<<FULL\n([\s\S]*?)>>>/);
  if (fullMatch) {
    return fullMatch[1];
  }

  const lines = original.split('\n');
  const hunks = unifiedDiff.split(/^@@/m).slice(1);
  if (hunks.length === 0) {
    // Bare patch body without headers: treat as append if original empty, else conflict.
    if (!original) {
      return unifiedDiff;
    }
    return null;
  }

  let working = [...lines];
  for (const hunk of hunks) {
    const hunkLines = hunk.split('\n').slice(1); // drop header residue
    const removed: string[] = [];
    const added: string[] = [];
    for (const hl of hunkLines) {
      if (hl.startsWith('-') && !hl.startsWith('---')) {
        removed.push(hl.slice(1));
      } else if (hl.startsWith('+') && !hl.startsWith('+++')) {
        added.push(hl.slice(1));
      } else if (hl.startsWith(' ')) {
        // context — ignored for simple matcher
      }
    }
    if (removed.length === 0) {
      // Pure addition: append
      working = [...working, ...added];
      continue;
    }
    const needle = removed.join('\n');
    const hay = working.join('\n');
    const idx = hay.indexOf(needle);
    if (idx < 0) {
      return null;
    }
    const before = hay.slice(0, idx);
    const after = hay.slice(idx + needle.length);
    working = (before + added.join('\n') + after).split('\n');
  }
  return working.join('\n');
}

/** Context passed to an agent executor for a single task. */
export interface AgentTaskContext {
  executionId: string;
  task: TaskNode;
  workspaceRoot: string;
  sessionId?: string;
  worktreePath?: string;
  signal?: AbortSignal;
}

/** Result from executing a single task via an external agent. */
export interface AgentTaskResult {
  taskId: string;
  ok: boolean;
  error?: string;
  failureClass?: string;
  subagentResult?: SubagentResult;
  workerResult?: WorkerResult;
  modelId?: string;
  tokensUsed?: number;
}

/**
 * Port for spawning isolated agent sessions to execute tasks.
 * Agent Host implements this with worktree-per-task subagent spawning.
 */
export interface AgentExecutor {
  executeTask(ctx: AgentTaskContext): Promise<AgentTaskResult>;
  /** Optional concurrency pool size override. */
  maxConcurrency?: number;
}
