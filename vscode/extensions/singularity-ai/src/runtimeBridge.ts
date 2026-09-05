import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createExecutionSubstrate,
  createRuntimeEngineFromAI,
  normalizePath,
  ShellToolPort,
  snapshotToChatPayload,
  StdioAgentFrameworkSidecar,
  type DiffHunk,
  type EditPort,
  type RuntimeEvent,
  type RuntimeRunResult,
  type WorkflowSnapshot,
  type WorkspacePort,
} from '@singularity/runtime';
import type { SingularityAI } from '@singularity/router';
import { type PenpotManager } from './penpotManager.js';
import { emitOutcomeEvent, getOutcomeSubsystem } from './outcomeBridge.js';
import { expandNeuralRelay, resolveNeuralRelay } from './neuralRelayBridge.js';
import { setRequestPhase } from './cacheTelemetry.js';

const execFileAsync = promisify(execFile);

/**
 * Shell execution for runtime verification (typecheck/test/git). Commands run
 * in the workspace root with hard timeouts and bounded output.
 */
async function ideShellExec(
  command: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', command], {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      timeout: 120_000,
      maxBuffer: 4_000_000,
    });
    return {
      ok: true,
      output: `${stdout || ''}${stderr || ''}`.slice(0, 40_000),
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: (e.stdout || e.stderr || e.message || String(err)).slice(0, 40_000),
    };
  }
}

export interface RunRuntimeRequest {
  goal: string;
  projectSummary?: string;
  codingStandards?: string;
  structuredContext?: string;
  verificationChecklist?: string;
  concurrency?: number;
  lockTimeoutMs?: number;
  signal?: AbortSignal;
  /** Cancellation propagated into engine + provider calls (chat UI stop). */
  cancelSignal?: AbortSignal;
  missionId?: string;
}

export function getMultiAgentLimitsFromConfig(): {
  maxAgents: number;
  maxConcurrentAgents: number;
  maxAgentRetries: number;
  maxTotalTokenBudget: number;
  maxWorkflowDurationMs: number;
} {
  const cfg = vscode.workspace.getConfiguration('singularity.ai.multiAgent');
  return {
    maxAgents: cfg.get<number>('maxAgents', 30),
    maxConcurrentAgents: cfg.get<number>('maxConcurrentAgents', 8),
    maxAgentRetries: cfg.get<number>('maxAgentRetries', 2),
    maxTotalTokenBudget: cfg.get<number>('maxTotalTokenBudget', 2_000_000),
    maxWorkflowDurationMs: cfg.get<number>('maxWorkflowDurationMs', 1_800_000),
  };
}

export function isMultiAgentEnabled(): boolean {
  return false;
}

export interface RunRuntimeResponse {
  ok: boolean;
  summary: string;
  error?: string;
  appliedPaths: string[];
  events: Array<{ kind: string; message: string; taskId?: string; data?: Record<string, unknown> }>;
  plan?: {
    id: string;
    taskCount: number;
    tasks: Array<{
      id: string;
      title: string;
      ownedPaths: string[];
      deps: string[];
      role?: string;
      objective?: string;
      status?: string;
      specialty?: string;
    }>;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    estimatedCost: number;
    latencyMs: number;
    model: string;
  };
  subagentResults?: Array<Record<string, unknown>>;
  verification?: {
    toolsOk?: boolean;
    requirementsOk?: boolean;
    summary: string;
  };
  synthesis?: string;
  workflowId?: string;
  missionId?: string;
  executionMode?: string;
  agentTeam?: ReturnType<typeof snapshotToChatPayload>;
}

/**
 * VS Code WorkspacePort — reads via workspace.fs relative to the folder root.
 */
export function createVsCodeWorkspacePort(
  folder: vscode.WorkspaceFolder,
): WorkspacePort {
  const root = folder.uri;

  const toUri = (path: string): vscode.Uri => {
    const rootPath = normalizePath(folder.uri.fsPath);
    let rel = normalizePath(path);
    // Absolute paths under the workspace must be stripped — otherwise
    // joinPath(root, "/Users/.../file") double-nests and misses the file.
    if (rel === rootPath || rel.startsWith(`${rootPath}/`)) {
      rel = rel.slice(rootPath.length).replace(/^\//, '');
    } else if (/^[a-zA-Z]:\//.test(rel)) {
      // Windows absolute outside workspace — keep basename-relative best effort
      const idx = rel.toLowerCase().indexOf(rootPath.toLowerCase());
      if (idx >= 0) {
        rel = rel.slice(idx + rootPath.length).replace(/^\//, '');
      }
    }
    return vscode.Uri.joinPath(root, ...rel.split('/').filter(Boolean));
  };

  return {
    async readFile(path: string): Promise<string | undefined> {
      try {
        const data = await vscode.workspace.fs.readFile(toUri(path));
        return new TextDecoder().decode(data);
      } catch {
        return undefined;
      }
    },
    async writeFile(path: string, content: string): Promise<void> {
      const uri = toUri(path);
      const dir = vscode.Uri.joinPath(uri, '..');
      try {
        await vscode.workspace.fs.createDirectory(dir);
      } catch {
        /* may already exist */
      }
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    },
    async listFiles(): Promise<string[]> {
      const pattern = new vscode.RelativePattern(folder, '**/*.{ts,tsx,js,jsx,py,go,rs,java,md}');
      const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 400);
      return uris.map((u) => normalizePath(vscode.workspace.asRelativePath(u, false)));
    },
    async searchText(pattern: string, glob?: string) {
      const include = glob
        ? new vscode.RelativePattern(folder, glob)
        : new vscode.RelativePattern(folder, '**/*.{ts,tsx,js,jsx,py}');
      const uris = await vscode.workspace.findFiles(include, '**/node_modules/**', 80);
      const hits: Array<{ path: string; line: number; text: string }> = [];
      const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      for (const uri of uris) {
        try {
          const data = await vscode.workspace.fs.readFile(uri);
          const text = new TextDecoder().decode(data);
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i]!)) {
              hits.push({
                path: normalizePath(vscode.workspace.asRelativePath(uri, false)),
                line: i + 1,
                text: lines[i]!.slice(0, 240),
              });
              if (hits.length >= 40) {
                return hits;
              }
            }
          }
        } catch {
          /* skip */
        }
      }
      return hits;
    },
  };
}

/**
 * EditPort that applies full-content writes through VS Code FS.
 * Unified-diff-only hunks without newContent are written via WorkspaceEdit when possible.
 */
export function createVsCodeEditPort(folder: vscode.WorkspaceFolder): EditPort {
  const workspace = createVsCodeWorkspacePort(folder);

  return {
    async applyDiffs(
      diffs: DiffHunk[],
    ): Promise<{ applied: string[]; conflicts: string[] }> {
      const applied: string[] = [];
      const conflicts: string[] = [];

      for (const d of diffs) {
        const path = normalizePath(d.path);
        try {
          if (d.newContent !== undefined) {
            await workspace.writeFile!(path, d.newContent);
            applied.push(path);
            continue;
          }
          if (d.unifiedDiff?.includes('<<<FULL\n')) {
            const m = d.unifiedDiff.match(/<<<FULL\n([\s\S]*?)>>>/);
            if (m) {
              await workspace.writeFile!(path, m[1]!);
              applied.push(path);
              continue;
            }
          }
          // Without a structured applier in the IDE, treat missing newContent as conflict
          // so the integrator LLM can rewrite the file.
          conflicts.push(path);
        } catch {
          conflicts.push(path);
        }
      }
      return { applied, conflicts };
    },
    async format() {
      /* optional — IDE formatters can hook later */
    },
  };
}

export async function runRuntimeInIde(
  ai: SingularityAI,
  req: RunRuntimeRequest,
  onEvent?: (event: RuntimeEvent) => void,
  _penpot?: PenpotManager,
  onWorkflowSnapshot?: (snapshot: WorkflowSnapshot) => void,
): Promise<RunRuntimeResponse> {
  if (!isMultiAgentEnabled()) {
    return {
      ok: false,
      summary: 'Multi-agent Runtime is disabled. Use Agent mode for sequential coding.',
      error: 'multi-agent-disabled',
      appliedPaths: [],
      events: [],
    };
  }

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return {
      ok: false,
      summary: 'No workspace folder open',
      error: 'No workspace folder open',
      appliedPaths: [],
      events: [],
    };
  }

  const cfg = vscode.workspace.getConfiguration('singularity.ai.multiAgent');
  const substrateKind = cfg.get<'native' | 'agent-framework'>('substrate', 'native');
  const sidecar =
    substrateKind === 'agent-framework' ? new StdioAgentFrameworkSidecar() : undefined;
  const substrate = createExecutionSubstrate(substrateKind, sidecar);

  let missionId = req.missionId;
  if (!missionId) {
    try {
      const created = getOutcomeSubsystem()?.createMission(
        req.goal,
        `runtime-${Date.now()}`,
      );
      missionId = created?.id;
      if (missionId) {
        emitOutcomeEvent('USER_INTENT_CAPTURED', {
          mission_id: missionId,
          text: req.goal,
          session_id: `runtime-${Date.now()}`,
        });
      }
    } catch {
      /* outcome optional */
    }
  }

  let latestSnapshot: WorkflowSnapshot | undefined;

  const emitProgress = (message: string) => {
    onEvent?.({ kind: 'agent_progress', ts: Date.now(), message });
  };

  emitProgress('Initializing multi-agent runtime…');

  const engine = createRuntimeEngineFromAI({
    ai,
    workspace: createVsCodeWorkspacePort(folder),
    edit: createVsCodeEditPort(folder),
    tools: new ShellToolPort({ cwd: folder.uri.fsPath }),
    shellExec: ideShellExec,
    concurrency:
      req.concurrency ??
      cfg.get<number>('maxConcurrentAgents', 8),
    lockTimeoutMs: req.lockTimeoutMs,
    missionId,
    multiAgentLimits: getMultiAgentLimitsFromConfig(),
    executionSubstrate: substrate,
    onWorkflowSnapshot: (snap) => {
      latestSnapshot = snap;
      onWorkflowSnapshot?.(snap);
    },
    onEvent: (ev) => {
      if (ev.kind === 'verify_started') {
        setRequestPhase('Verifying', 'Verifier → Running tests');
      } else if (ev.kind === 'verify_done' || ev.kind === 'run_done') {
        setRequestPhase('Complete', '✓ Complete');
      } else if (ev.kind === 'verify_failed' || ev.kind === 'run_failed') {
        setRequestPhase('Error', 'DeepSeek → Error');
      }
      onEvent?.(ev);
    },
    workspaceRoot: folder.uri.fsPath,
    onContextRequest: async ({ requested_files, reason }) => {
      return expandNeuralRelay(requested_files, reason);
    },
    onOutcomeCheckpoint: ({ sessionId, goal, ok, missionId: mid }) => {
      emitOutcomeEvent('READY_FOR_VERIFICATION', {
        session_id: sessionId,
        mission_id: mid ?? missionId,
        text: goal,
        task_id: ok ? 'ok' : 'failed',
      });
    },
  });

  const relay = await (async () => {
    emitProgress('Neural Relay — scanning workspace for relevant context…');
    const r = await resolveNeuralRelay(req.goal);
    if (r?.usedRelay && r.built) {
      emitProgress(
        `Neural Relay — prepared ~${Math.round(r.built.estimatedTokens / 1000)}k tokens of context`,
      );
    } else {
      emitProgress('Neural Relay — skipped (empty repo or disabled)');
    }
    return r;
  })();
  const structuredContext = [req.structuredContext, relay?.promptBlock]
    .filter(Boolean)
    .join('\n\n');

  setRequestPhase('DeepSeek', 'DeepSeek → Coding…');
  emitProgress('Planner — decomposing goal into parallel agent tasks…');

  const result: RuntimeRunResult = await engine.run({
    goal: req.goal,
    missionId,
    projectSummary: req.projectSummary,
    codingStandards: req.codingStandards,
    structuredContext: structuredContext || req.structuredContext,
    verificationChecklist: req.verificationChecklist,
    concurrency: req.concurrency,
    lockTimeoutMs: req.lockTimeoutMs,
    multiAgentLimits: getMultiAgentLimitsFromConfig(),
    signal: req.cancelSignal ?? req.signal,
    fastPath: vscode.workspace
      .getConfiguration('singularity.ai')
      .get<boolean>('fastPath.enabled', true),
  });

  sidecar?.dispose();

  const agentTeam = latestSnapshot
    ? snapshotToChatPayload(latestSnapshot, {
        verificationPhase: latestSnapshot.workflow.phase === 'verifying',
        metrics: {
          filesChanged: result.appliedPaths.length,
          filesAnalyzed: result.plan.nodes.reduce(
            (n, t) => n + (t.ownedPaths?.length ?? 0),
            0,
          ),
        },
      })
    : undefined;

  return {
    ok: result.ok,
    summary: result.summary,
    synthesis: result.synthesis,
    workflowId: result.workflowId,
    missionId: result.missionId ?? missionId,
    executionMode: result.executionMode,
    agentTeam,
    error: result.error,
    appliedPaths: result.appliedPaths,
    events: result.events.map((e) => ({
      kind: e.kind,
      message: e.message,
      taskId: e.taskId,
      data: e.data as Record<string, unknown> | undefined,
    })),
    plan: {
      id: result.plan.id,
      taskCount: result.plan.nodes.length,
      tasks: result.plan.nodes.map((n) => ({
        id: n.id,
        title: n.title,
        ownedPaths: n.ownedPaths,
        deps: n.deps,
        role: n.role,
        objective: n.objective ?? n.title,
        status: n.status,
        specialty: n.specialty,
        deliverable: n.deliverable,
        assignedAgentId: n.assignedAgentId,
        assignedModel: n.assignedModel,
      })),
    },
    usage: result.usage,
    subagentResults: result.subagentResults as
      | Array<Record<string, unknown>>
      | undefined,
    verification: result.verification,
  };
}
