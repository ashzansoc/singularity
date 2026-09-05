export type {
  TaskStatus,
  TaskNode,
  ExecutionPlanEstimates,
  ExecutionPlan,
  DiffHunk,
  BusEventKind,
  BusEvent,
  WorkerResultStatus,
  WorkerResult,
  RuntimeEventKind,
  RuntimeEvent,
  RuntimeRunRequest,
  RuntimeRunResult,
  RuntimeVerifyEvidence,
} from './types.js';

export type {
  LlmRole,
  LlmCompleteRequest,
  LlmCompleteResult,
  LlmPort,
  LlmStreamDelta,
  WorkspacePort,
  EditPort,
  ToolPort,
  DesignPreviewGatePort,
  AgentTaskContext,
  AgentTaskResult,
  AgentExecutor,
} from './ports.js';

export {
  InMemoryWorkspace,
  InMemoryEditPort,
  normalizePath,
  applyUnifiedDiff,
} from './ports.js';

export { ShellToolPort, type ShellToolPortOptions } from './tools/shellTools.js';
export {
  scoreRisk,
  verificationPolicyFor,
  type RiskScore,
  type RiskTier,
  type VerificationPlan,
} from './tools/riskPolicy.js';
export {
  PARALLEL_IO_LIMIT,
  READONLY_TOOL_CONCURRENCY,
  isParallelIoEnabled,
  isReadOnlyTool,
  parallelLimit,
} from './parallel.js';
export { verifyWithTools, type VerifyResult } from './tools/verifier.js';
export {
  verifyAgainstRequirements,
  type RequirementVerifyItem,
  type RequirementVerifyResult,
} from './tools/requirementVerifier.js';

export {
  DagError,
  buildDag,
  topoSort,
  getReadyNodes,
  pathsIntersect,
  criticalPathLength,
  type Dag,
} from './graph/dag.js';

export {
  LockManager,
  LockTimeoutError,
  type LockLease,
  type LockManagerOptions,
} from './locks/lockManager.js';

export { ContextBus, type BusListener } from './bus/contextBus.js';

export {
  createExecutionPlan,
  parsePlanJson,
  finalizePlan,
  createFallbackPlan,
  type PlannerOptions,
  type PlanRequest,
  type RawPlan,
} from './planner/planner.js';

export { runWorkerTask, filterOwnedDiffs, parseWorkerJson } from './worker/worker.js';
export { WorkerPool } from './worker/pool.js';
export { runScheduler, type SchedulerOptions, type SchedulerResult } from './scheduler/scheduler.js';
export {
  integrateResults,
  type IntegratorOptions,
  type IntegrateResult,
} from './integrate/integrator.js';

export {
  createLlmPortFromSingularityAI,
  type SingularityLlmPortOptions,
} from './llm.js';

export {
  createRuntimeEngine,
  createRuntimeEngineFromAI,
  type RuntimeEngine,
  type RuntimeEngineConfig,
  type CreateRuntimeEngineFromAIOptions,
} from './runtime.js';

export {
  allocateAgents,
  decideExecutionMode,
} from './allocation/engine.js';
export type {
  AllocationInput,
  AllocationResult,
  ExecutionMode,
  MultiAgentLimits,
  AllocatedTask,
} from './allocation/types.js';
export { DEFAULT_MULTI_AGENT_LIMITS } from './allocation/types.js';

export {
  WorkflowEventStore,
  buildAgentRows,
  buildAgentTeamSummary,
  type AgentEvent,
  type AgentEventType,
  type AgentTeamAgentRow,
  type AgentTeamSummary,
  type WorkflowSnapshot,
} from './events/store.js';

export {
  snapshotToChatPayload,
  compactTeamMarkdown,
  expandedAgentsMarkdown,
  type ChatAgentTeamProgressPayload,
} from './events/chatAdapter.js';

export {
  calculateWorkflowProgress,
  agentProgressLabel,
  isTaskCompleted,
  isTaskRunning,
  isTaskQueued,
  isTaskBlocked,
  type WorkflowProgress,
} from './progress/calculator.js';

export {
  createMissionWorkflow,
  bumpMissionPhase,
  type MissionWorkflowPhase,
  type MissionWorkflowState,
} from './mission/workflow.js';

export { synthesizeFinalOutcome, type SynthesizeOptions } from './synthesis/synthesizer.js';

export {
  detectRecommendationConflicts,
  resolveConflicts,
  type DetectedConflict,
  type ConflictResolution,
} from './conflict/resolver.js';

export {
  createExecutionSubstrate,
  NativeExecutionSubstrate,
  AgentFrameworkExecutionSubstrate,
  type ExecutionSubstrate,
  type WorkflowExecutionContext,
  type AgentFrameworkSidecarClient,
} from './execution/substrate.js';

export { workspacePortForAgent, worktreePathForAgent, type WorktreeWorkspaceOptions } from './workspace/worktreePort.js';
export { createRemediationPlan, type RemediationReplanRequest } from './mission/remediation.js';
export { StdioAgentFrameworkSidecar, type SidecarClientOptions } from './execution/sidecarClient.js';

export {
  classifyComplexity,
  classifyFastPath,
  isFastPathEnabled,
  tryFastPath,
  type ComplexityLane,
  type FastPathDecision,
  type FastPathReason,
} from './fastpath/classifier.js';

export {
  analyzeDependencies,
  canRunInParallel,
  getExecutionBatches,
  type DependencyKind,
  type TaskDependency,
  type ParallelSafety,
  type RepoContext,
  type DependencyAnalyzerResult,
} from './dependency/analyzer.js';

export * from './subagent/index.js';
