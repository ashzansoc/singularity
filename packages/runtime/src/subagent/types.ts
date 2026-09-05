/**
 * First-class Subagent types for Runtime v4.
 * Subagents map onto TaskNodes — they do not replace the DAG.
 */

import type { Tier } from '@singularity/router';
import type { DiffHunk, TaskNode, TaskStatus } from '../types.js';

/** Known subagent roles; string allows extension without breaking callers. */
export type SubagentRole =
  | 'explorer'
  | 'researcher'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'debugger'
  | 'tester'
  | 'reviewer'
  | 'integrator'
  | (string & {});

export type SubagentStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Fine-grained tools a subagent may invoke. */
export type ToolPermission =
  | 'read_file'
  | 'search_files'
  | 'list_directory'
  | 'write_file'
  | 'terminal'
  | 'typecheck'
  | 'test'
  | 'git_status'
  | 'git_diff';

export type ModelStrategy =
  | 'fast'
  | 'balanced'
  | 'reasoning'
  | 'coding'
  | 'vision'
  | 'custom';

export interface ModelPolicy {
  strategy: ModelStrategy;
  preferredModels?: string[];
  maxCost?: number;
  maxLatencyMs?: number;
  /** Soft tier hint derived from strategy when preferredModels omitted. */
  preferredTier?: Tier;
}

export interface Artifact {
  kind: string;
  path?: string;
  summary?: string;
  data?: Record<string, unknown>;
}

export interface SubagentUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCost: number;
  latencyMs: number;
  model: string;
}

export interface SubagentResult {
  subagentId: string;
  status: 'success' | 'partial' | 'failed';
  summary: string;
  filesCreated: string[];
  filesModified: string[];
  filesDeleted: string[];
  testsRun: string[];
  testsPassed: string[];
  testsFailed: string[];
  issues: string[];
  recommendations: string[];
  artifacts?: Artifact[];
  usage?: SubagentUsage;
  review?: ReviewResult;
}

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor';
  file?: string;
  line?: number;
  description: string;
}

export interface ReviewResult {
  approved: boolean;
  issues: ReviewIssue[];
  recommendations: string[];
}

export type SubagentEventType =
  | 'created'
  | 'started'
  | 'tool_call'
  | 'progress'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SubagentEvent {
  subagentId: string;
  taskId: string;
  timestamp: number;
  type: SubagentEventType;
  payload: unknown;
}

export interface SubagentBounds {
  maxConcurrentSubagents: number;
  maxSubagentDepth: number;
  maxTotalSubagents: number;
  maxSpawnedChildren: number;
}

export const DEFAULT_SUBAGENT_BOUNDS: Readonly<SubagentBounds> = {
  maxConcurrentSubagents: 4,
  maxSubagentDepth: 2,
  maxTotalSubagents: 12,
  maxSpawnedChildren: 2,
};

/** First-class subagent view over a DAG task. */
export interface Subagent {
  id: string;
  role: SubagentRole;
  objective: string;
  parentTaskId: string;
  allowedPaths?: string[];
  deniedPaths?: string[];
  tools: ToolPermission[];
  /** Filtered context string for this subagent (not full plan dump). */
  context: string;
  modelPolicy: ModelPolicy;
  dependencies?: string[];
  status: SubagentStatus;
  maxIterations?: number;
  timeoutMs?: number;
  depth?: number;
  result?: SubagentResult;
}

/** Planner / spawn request before materialization into TaskNode. */
export interface SubagentSpec {
  id: string;
  role: SubagentRole;
  objective: string;
  dependencies?: string[];
  ownedPaths?: string[];
  deniedPaths?: string[];
  tools?: ToolPermission[];
  modelPolicy?: Partial<ModelPolicy>;
  maxIterations?: number;
  timeoutMs?: number;
  parentTaskId?: string;
  depth?: number;
  expectedOutput?: string;
  estimatedTokens?: number;
  priority?: number;
  retryLimit?: number;
  neighborPaths?: string[];
  specialty?: TaskNode['specialty'];
  preferredModelId?: string;
  recommendedTier?: Tier;
}

export type ParentInstruction = {
  type: 'instruction';
  target: string;
  message: string;
};

export type SubagentClarificationRequest = {
  type: 'request';
  from: string;
  to: 'parent';
  requestKind: 'clarification';
  payload: Record<string, unknown>;
};

export type SubagentDependencyRequest = {
  type: 'dependency_request';
  from: string;
  requestedRole: SubagentRole;
  objective: string;
  ownedPaths?: string[];
};

export type SubagentMessage =
  | ParentInstruction
  | SubagentClarificationRequest
  | SubagentDependencyRequest;

export type FailureClass =
  | 'provider_error'
  | 'tool_failure'
  | 'lock_timeout'
  | 'low_quality'
  | 'review_reject'
  | 'timeout'
  | 'cancelled'
  | 'unknown';

export interface AgentToolCall {
  name: ToolPermission | string;
  args?: Record<string, unknown>;
}

export interface AgentLoopTurn {
  /** Final structured result when the agent is done. */
  result?: Partial<SubagentResult> & { status?: SubagentResult['status'] };
  /** Diffs to apply under ownership. */
  diffs?: DiffHunk[];
  /** Tool calls for this turn. */
  toolCalls?: AgentToolCall[];
  /** Progress summary (safe for UI — not chain-of-thought). */
  progress?: string;
  changeRequests?: string[];
  messages?: SubagentMessage[];
  busEvents?: Array<{
    kind?: string;
    message?: string;
    path?: string;
    payload?: Record<string, unknown>;
  }>;
  /** Neural Relay: coding model asks for additional repository files. */
  needs_more_context?: boolean;
  requested_files?: string[];
  reason?: string;
}

export function taskStatusToSubagentStatus(status: TaskStatus): SubagentStatus {
  switch (status) {
    case 'pending':
      return 'created';
    case 'ready':
      return 'queued';
    case 'running':
      return 'running';
    case 'done':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'created';
  }
}

export function subagentStatusToTaskStatus(status: SubagentStatus): TaskStatus {
  switch (status) {
    case 'created':
      return 'pending';
    case 'queued':
      return 'ready';
    case 'waiting':
      return 'running';
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

export function emptySubagentResult(subagentId: string): SubagentResult {
  return {
    subagentId,
    status: 'failed',
    summary: '',
    filesCreated: [],
    filesModified: [],
    filesDeleted: [],
    testsRun: [],
    testsPassed: [],
    testsFailed: [],
    issues: [],
    recommendations: [],
  };
}
