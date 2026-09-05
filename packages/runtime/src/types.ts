import type { Tier } from '@singularity/router';
import type {
  ModelPolicy,
  SubagentResult,
  SubagentRole,
  ToolPermission,
} from './subagent/types.js';

/** Lifecycle status of a task node in the execution plan. */
export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'planning'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'verifying'
  | 'done'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** A single unit of work in the Runtime v4 DAG (also a Subagent when role is set). */
export interface TaskNode {
  id: string;
  /** Parent task when spawned dynamically. */
  parentTaskId?: string;
  title: string;
  /** Extended task description for UI / agents. */
  description?: string;
  /** Explicit deliverable this agent must produce. */
  deliverable?: string;
  deps: string[];
  ownedPaths: string[];
  /** Glob patterns limiting context retrieval for this agent. */
  contextScope?: string[];
  /** Assigned ephemeral worker id (e.g. agent-01). */
  assignedAgentId?: string;
  /** Resolved model id from allocation / routing. */
  assignedModel?: string;
  /** 0–100 when agent reports measurable milestones. */
  progress?: number;
  startedAt?: number;
  completedAt?: number;
  errors?: string[];
  expectedOutput: string;
  estimatedTokens: number;
  recommendedTier: Tier;
  priority: number;
  retryLimit: number;
  status: TaskStatus;
  /**
   * Specialty lane for multi-model ownership.
   * Frontend implementation → DeepSeek V4 Flash-0731; Design Director → Nemotron; Critic → Pro.
   */
  specialty?:
    | 'frontend'
    | 'frontend-refine'
    | 'design-director'
    | 'visual-capture'
    | 'visual-critic'
    | 'backend'
    | 'ai-pipeline'
    | 'infrastructure'
    | 'general';
  /** Optional model pin (pipeline injection). */
  preferredModelId?: string;
  /** Neighbor paths included in worker context (1-hop). */
  neighborPaths?: string[];
  /** Attempt count so far (scheduler-owned). */
  attempts?: number;

  // --- Execution engine extensions (optional; backward compatible) ---
  /** Capabilities required to execute this task. */
  requiredCapabilities?: string[];
  /** Artifact refs consumed by this task. */
  inputArtifacts?: string[];
  /** Artifact refs produced by this task. */
  outputArtifacts?: string[];
  /** Files this task reads or writes (beyond ownedPaths). */
  affectedFiles?: string[];
  /** Symbols this task touches. */
  affectedSymbols?: string[];
  /** API/interface contracts this task modifies. */
  interfaces?: string[];
  /** Planning assumptions recorded for observability. */
  assumptions?: string[];
  /** Known risks for this task. */
  risks?: string[];
  /** Acceptance criteria for verification. */
  acceptanceCriteria?: string[];
  /** Parallel batch group id (derived). */
  parallelGroup?: number;
  /** Task ids blocked by this task (derived). */
  blocks?: string[];
  /** Structured execution attempts (maps to task_attempts table). */
  executionAttempts?: Array<{
    attemptNumber: number;
    agentId?: string;
    modelId?: string;
    status: TaskStatus;
    startedAt?: number;
    completedAt?: number;
    failureClass?: string;
  }>;

  // --- Subagent extensions (optional; backward compatible) ---
  /** Cursor-style subagent role. */
  role?: SubagentRole;
  /** Explicit objective (defaults to title). */
  objective?: string;
  /** Fine-grained tool allowlist. */
  tools?: ToolPermission[];
  /** Model routing policy (maps onto router tiers). */
  modelPolicy?: ModelPolicy;
  /** Bounded multi-iteration agent loop. */
  maxIterations?: number;
  timeoutMs?: number;
  /** Spawn depth (0 = top-level). */
  depth?: number;
  /** Paths this subagent must not touch. */
  deniedPaths?: string[];
  /** Filtered context for this node (set by orchestrator). */
  filteredContext?: string;
  /** Structured result after completion. */
  result?: SubagentResult;
  /** Waiting on lock / dependency_request (UI maps to subagent waiting). */
  waitingReason?: string;
}

export interface ExecutionPlanEstimates {
  totalTokens: number;
  taskCount: number;
  criticalPathLength: number;
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  projectSummary: string;
  codingStandards?: string;
  /** Stable structured context from Context Engine (cache-friendly prefix). */
  structuredContext?: string;
  verificationChecklist?: string;
  nodes: TaskNode[];
  estimates: ExecutionPlanEstimates;
  createdAt: number;
}

/** Unified diff hunk produced by a worker. */
export interface DiffHunk {
  path: string;
  /** Unified diff body (---/+++ optional; @@ hunks preferred). */
  unifiedDiff: string;
  /** Full replacement content when creating a new file or replacing entirely. */
  newContent?: string;
  /** True when the file did not exist before. */
  isNew?: boolean;
}

export type BusEventKind =
  | 'CreatedFile'
  | 'ModifiedInterface'
  | 'ModifiedExport'
  | 'ChangeRequest'
  | 'TaskSummary'
  | 'SubagentResult'
  | 'DependencyRequest'
  | 'Custom';

export interface BusEvent {
  kind: BusEventKind;
  taskId: string;
  path?: string;
  message: string;
  payload?: Record<string, unknown>;
  ts: number;
}

export type WorkerResultStatus = 'ok' | 'error';

export interface WorkerResult {
  taskId: string;
  diffs: DiffHunk[];
  busEvents: BusEvent[];
  tokensUsed: number;
  modelId: string;
  status: WorkerResultStatus;
  error?: string;
  /** Paths the worker wanted to edit but does not own. */
  changeRequests?: string[];
  /** Structured subagent result when available. */
  subagentResult?: import('./subagent/types.js').SubagentResult;
  /** Token/cost breakdown when providers report it. */
  usage?: import('./subagent/types.js').SubagentUsage;
}

export type RuntimeEventKind =
  | 'plan_created'
  | 'task_created'
  | 'task_ready'
  | 'task_started'
  | 'task_done'
  | 'task_failed'
  | 'task_blocked'
  | 'task_retry'
  | 'lock_acquired'
  | 'lock_released'
  | 'lock_timeout'
  | 'integrate_started'
  | 'integrate_conflict'
  | 'integrate_done'
  | 'run_done'
  | 'run_failed'
  | 'subagent_created'
  | 'subagent_started'
  | 'subagent_tool_call'
  | 'subagent_progress'
  | 'subagent_progress_delta'
  | 'subagent_waiting'
  | 'subagent_completed'
  | 'subagent_failed'
  | 'subagent_cancelled'
  | 'agent_created'
  | 'agent_started'
  | 'agent_progress'
  | 'agent_tool_started'
  | 'agent_tool_completed'
  | 'agent_finding'
  | 'agent_blocked'
  | 'agent_question'
  | 'agent_completed'
  | 'agent_failed'
  | 'agent_cancelled'
  | 'workflow_started'
  | 'workflow_progress'
  | 'workflow_verifying'
  | 'workflow_conflict_detected'
  | 'workflow_completed'
  | 'workflow_failed'
  | 'verify_started'
  | 'verify_done'
  | 'verify_failed';

/** Structured events for a future debug / Gantt panel. */
export interface RuntimeEvent {
  kind: RuntimeEventKind;
  ts: number;
  taskId?: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface RuntimeRunRequest {
  goal: string;
  /** Outcome mission id when bound to mission controller. */
  missionId?: string;
  /** Optional pre-built plan (skips planner). */
  plan?: ExecutionPlan;
  /** Multi-agent limits override. */
  multiAgentLimits?: Partial<import('./allocation/types.js').MultiAgentLimits>;
  projectSummary?: string;
  codingStandards?: string;
  /**
   * Structured project context from Context Engine (stable block).
   * Injected into planner + workers when context_agent_integration is on.
   */
  structuredContext?: string;
  /** Requirement/constraint checklist for verification. */
  verificationChecklist?: string;
  /** Alias for WorkerPool concurrency / maxConcurrentSubagents. */
  concurrency?: number;
  maxConcurrentSubagents?: number;
  lockTimeoutMs?: number;
  signal?: AbortSignal;
  /** Subagent spawn bounds (optional overrides). */
  subagentBounds?: Partial<import('./subagent/types.js').SubagentBounds>;
  /** Enable bounded multi-iteration tool agent loop (default true when role set). */
  enableSubagentLoop?: boolean;
  /** Run post-integrate verification (default true). */
  enableVerification?: boolean;
  /**
   * Allow the single-call fast lane for simple tasks (Step 8).
   * Default ON; `SINGULARITY_FAST_PATH=0` disables globally. When false here,
   * every goal goes through the deep pipeline.
   */
  fastPath?: boolean;
}

export interface RuntimeVerifyEvidence {
  /** Aggregate verdict of the hot-path pre-verification. */
  ok: boolean;
  /** Risk policy tier + score that decided the verification depth. */
  riskTier?: 'low' | 'medium' | 'high' | 'uncertain';
  riskScore?: number;
  /** Deterministic tool checks (typecheck/tests). */
  toolChecks: Array<{ name: string; ok: boolean; summary: string }>;
  toolsOk: boolean;
  /** LLM requirement checklist verdicts (when the policy ran them). */
  requirementChecks: Array<{
    id: string;
    kind: string;
    text: string;
    status: 'pass' | 'fail' | 'unknown';
    evidence?: string;
  }>;
  requirementsOk: boolean;
  appliedPaths: string[];
  checkedAt: number;
}

export interface RuntimeRunResult {
  plan: ExecutionPlan;
  results: WorkerResult[];
  appliedPaths: string[];
  events: RuntimeEvent[];
  ok: boolean;
  summary: string;
  /** User-facing synthesized outcome (when multi-agent pipeline ran). */
  synthesis?: string;
  workflowId?: string;
  missionId?: string;
  executionMode?: import('./allocation/types.js').ExecutionMode;
  error?: string;
  /** Aggregated subagent results. */
  subagentResults?: import('./subagent/types.js').SubagentResult[];
  /** Aggregated usage across subagents. */
  usage?: import('./subagent/types.js').SubagentUsage;
  /** Post-run verification summary. */
  verification?: {
    toolsOk?: boolean;
    requirementsOk?: boolean;
    summary: string;
  };
  /** True when the run took the single-call fast lane (Step 8). */
  fastPath?: boolean;
}
