export type {
  SubagentRole,
  SubagentStatus,
  ToolPermission,
  ModelStrategy,
  ModelPolicy,
  Artifact,
  SubagentUsage,
  SubagentResult,
  ReviewIssue,
  ReviewResult,
  SubagentEventType,
  SubagentEvent,
  SubagentBounds,
  Subagent,
  SubagentSpec,
  ParentInstruction,
  SubagentClarificationRequest,
  SubagentDependencyRequest,
  SubagentMessage,
  FailureClass,
  AgentToolCall,
  AgentLoopTurn,
} from './types.js';

export {
  DEFAULT_SUBAGENT_BOUNDS,
  taskStatusToSubagentStatus,
  subagentStatusToTaskStatus,
  emptySubagentResult,
} from './types.js';

export {
  getRoleDefaults,
  roleFromSpecialty,
  inferRoleFromText,
  strategyToTier,
  isKnownRole,
  type RoleDefaults,
} from './roleCatalog.js';

export {
  resolveRole,
  mergeModelPolicy,
  subagentSpecToTaskNode,
  enrichTaskNodeAsSubagent,
  taskNodeToSubagent,
  workerDiffsToFileLists,
  attachResult,
} from './mappers.js';

export {
  buildSubagentContext,
  collectDependencyResults,
  type BuildSubagentContextOptions,
} from './context.js';

export {
  createPermissionedPorts,
  executeToolCall,
  pathAllowed,
  ToolPermissionError,
  type OwnershipRules,
  type PermissionedPorts,
} from './permissions.js';

export { resolveModelRouting, type ResolvedModelRouting } from './modelPolicy.js';

export {
  runSubagentLoop,
  parseAgentTurn,
  classifyFailure,
  type SubagentLoopOptions,
} from './agentLoop.js';

export {
  SubagentManager,
  aggregateUsage,
  collectSubagentResults,
} from './manager.js';

export {
  SubagentOrchestrator,
  createSubagentOrchestrator,
  type OrchestratorOptions,
  type RawPlanWithSubagents,
} from './orchestrator.js';
