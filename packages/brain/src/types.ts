/**
 * Singularity Brain — public types.
 *
 * The Brain is a persistent USER-level memory graph. It is deliberately
 * independent of any single project/workspace: every record carries a user_id
 * and (optionally) the project it was observed in.
 *
 * Layers (coexist; not mutually exclusive):
 *   Code Graph          — files, modules, deps, symbols, technologies
 *   Semantic Knowledge  — concepts, facts, requirements, constraints, topics
 *   Engineering Memory  — decisions, experiments, bugs, solutions, lessons
 *   Task / Execution    — goals, tasks, plans, changes, outcomes
 */

export const BRAIN_SCHEMA_VERSION = 3;

/** Authority of a memory — not all nodes are equally trustworthy. */
export type MemoryAuthority =
  | 'fact'
  | 'inference'
  | 'decision'
  | 'observation'
  | 'hypothesis'
  | 'validated';

/** Semantic cluster used for layout + progressive disclosure. */
export type MemoryCluster =
  | 'architecture'
  | 'memory'
  | 'code'
  | 'models'
  | 'evaluation'
  | 'tasks'
  | 'decisions'
  | 'runtime'
  | 'dependencies'
  | 'problems'
  | 'solutions'
  | 'project';

/** Semantic categories. The registry is extensible; these are the seeds. */
export type MemoryType =
  | 'project'
  | 'repository'
  | 'code'
  | 'technology'
  | 'service'
  | 'layer'
  | 'architecture'
  | 'concept'
  | 'fact'
  | 'requirement'
  | 'constraint'
  | 'assumption'
  | 'topic'
  | 'goal'
  | 'decision'
  | 'tradeoff'
  | 'learning'
  | 'lesson'
  | 'observation'
  | 'experiment'
  | 'hypothesis'
  | 'evaluation'
  | 'outcome'
  | 'experience'
  | 'conversation'
  | 'document'
  | 'task'
  | 'plan'
  | 'change'
  | 'event'
  | 'person'
  | 'bug'
  | 'solution'
  | 'preference';

export type RelationshipType =
  | 'works_on'
  | 'created'
  | 'modified'
  | 'uses'
  | 'depends_on'
  | 'contains'
  | 'part_of'
  | 'decided'
  | 'learned'
  | 'discovered'
  | 'related_to'
  | 'caused'
  | 'caused_by'
  | 'fixed_by'
  | 'solved_by'
  | 'replaced_by'
  | 'supersedes'
  | 'derived_from'
  | 'discussed_in'
  | 'implemented_in'
  | 'implements'
  | 'explains'
  | 'constrains'
  | 'supports'
  | 'contradicts'
  | 'motivated_by'
  | 'affects'
  | 'tests'
  | 'produces'
  | 'informs'
  | 'validated_by'
  | 'modifies'
  | 'tested_by'
  | 'failed_because'
  | 'succeeded_because'
  | 'belongs_to'
  | 'connected_to';

export const RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  'works_on', 'created', 'modified', 'uses', 'depends_on', 'contains', 'part_of',
  'decided', 'learned', 'discovered', 'related_to', 'caused', 'caused_by',
  'fixed_by', 'solved_by', 'replaced_by', 'supersedes', 'derived_from',
  'discussed_in', 'implemented_in', 'implements', 'explains', 'constrains',
  'supports', 'contradicts', 'motivated_by', 'affects', 'tests', 'produces',
  'informs', 'validated_by', 'modifies', 'tested_by', 'failed_because',
  'succeeded_because', 'belongs_to', 'connected_to',
];

export interface BrainEntity {
  id: string;
  userId: string;
  type: MemoryType | string;
  label: string;
  description?: string;
  importance: number;
  confidence: number;
  sourceType: string;
  sourceRef?: string;
  projectId?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Degree centrality cache, refreshed by recomputeImportance(). */
  degree: number;
  /** How authoritative this memory is. */
  authority?: MemoryAuthority;
  /** Layout / progressive-disclosure cluster. */
  cluster?: MemoryCluster | string;
  /** Free-form evidence note or source quote. */
  evidence?: string;
  /** Validity: active | superseded | contested | stale. */
  validity?: string;
  /** Id of the entity that supersedes this one. */
  supersededBy?: string;
}

export interface BrainRelationship {
  id: string;
  userId: string;
  sourceId: string;
  targetId: string;
  relType: RelationshipType | string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  sourceEvent?: string;
}

/** Episodic memory: what happened and when (the temporal layer). */
export interface BrainEpisode {
  id: string;
  userId: string;
  kind:
    | 'chat'
    | 'code_change'
    | 'file_change'
    | 'decision'
    | 'sync'
    | 'commit'
    | 'event'
    | 'test'
    | 'observation'
    | 'reflection'
    | 'insight'
    | 'experiment';
  summary: string;
  projectId?: string;
  workspaceRoot?: string;
  entityIds: string[];
  occurredAt: number;
  sourceRef?: string;
  outcome?: 'success' | 'failure' | 'neutral';
  intention?: string;
  action?: string;
  result?: string;
  lesson?: string;
  meta?: Record<string, unknown>;
}

/** Semantic memory record (facade over durable graph entities). */
export interface SemanticMemory {
  id: string;
  type: string;
  content: string;
  importance: number;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  source: string;
  projectId?: string;
  label: string;
}

/** Procedural memory: how things are done. */
export interface BrainProcedure {
  id: string;
  userId: string;
  name: string;
  conditions?: string;
  steps: string[];
  successRate: number;
  failureRate: number;
  evidence: string[];
  confidence: number;
  lastUsed?: number;
  lastEvaluated?: number;
  projectId?: string;
  createdAt: number;
  updatedAt: number;
}

export type ReasoningMode = 'default' | 'ultrathink';

export type BackgroundLevel = 'low' | 'balanced' | 'high';
export type UltrathinkSetting = 'off' | 'manual' | 'automatic';

/** Dedicated Brain model configuration (independent of chat model). */
export interface BrainModelConfig {
  provider: 'openai-compatible';
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export interface BrainConfig {
  enabled: boolean;
  model: BrainModelConfig;
  reasoning: {
    default: string;
    ultrathink: string;
  };
  contextLimit: number;
  maxBackgroundCallsPerDay: number;
  maxTokensPerCall: number;
  idleMs: number;
  backgroundLevel: BackgroundLevel;
  ultrathink: UltrathinkSetting;
  dailyBudgetUsd: number;
  estimatedUsdPer1kTokens: number;
}

export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  enabled: true,
  model: {
    provider: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: 'deepseek/deepseek-v4-flash-0731',
    timeoutMs: 120_000,
  },
  reasoning: {
    default: 'high',
    ultrathink: 'maximum',
  },
  contextLimit: 12_000,
  maxBackgroundCallsPerDay: 48,
  maxTokensPerCall: 4096,
  idleMs: 5 * 60_000,
  backgroundLevel: 'balanced',
  ultrathink: 'automatic',
  dailyBudgetUsd: 2,
  estimatedUsdPer1kTokens: 0.002,
};

export type RuntimeStatus = 'idle' | 'active' | 'reflecting' | 'stopped';

export interface BrainRuntimeSnapshot {
  status: RuntimeStatus;
  lastEventAt?: number;
  lastReflectionAt?: number;
  callsToday: number;
  tokensToday: number;
  pendingEvents: number;
  insightsNew: number;
}

// ---- Procedural memory / insights (typed for future persistence) ------------

export type InsightStatus =
  | 'new' | 'seen' | 'accepted' | 'rejected' | 'implemented' | 'verified' | 'dismissed' | 'expired';

export type EvidenceKind =
  | 'file' | 'commit' | 'conversation' | 'memory' | 'episode' | 'decision' | 'test' | 'metric';

export interface EvidenceRef {
  kind: EvidenceKind;
  ref: string;
  note?: string;
}

export interface BrainInsight {
  id: string;
  userId: string;
  projectId?: string;
  title: string;
  kind: string;
  confidence: number;
  observation?: string;
  reasoning?: string;
  improvement?: string;
  evidence: EvidenceRef[];
  relatedMemoryIds: string[];
  relatedFiles: string[];
  status: InsightStatus;
  reasoningMode: ReasoningMode;
  createdAt: number;
  updatedAt: number;
}

export type HypothesisStatus = 'open' | 'supported' | 'rejected' | 'superseded';

export interface BrainHypothesis {
  id: string;
  userId: string;
  projectId?: string;
  statement: string;
  counterStatement?: string;
  confidence: number;
  evidenceIds: string[];
  status: HypothesisStatus;
  insightId?: string;
  experimentId?: string;
  createdAt: number;
  updatedAt: number;
}

export type AutonomyLevel = 1 | 2 | 3;
export type PolicyStatus = 'experimental' | 'current' | 'previous' | 'archived' | 'rejected';

export interface BrainPolicy {
  id: string;
  userId: string;
  kind: string;
  version: string;
  payload: Record<string, unknown>;
  status: PolicyStatus;
  autonomyLevel: AutonomyLevel;
  createdAt: number;
  updatedAt: number;
}

export type ExperimentStatus = 'proposed' | 'running' | 'completed';
export type ExperimentDecision = 'pending' | 'promoted' | 'rejected' | 'rolled_back';

export interface BrainExperiment {
  id: string;
  userId: string;
  name: string;
  policyKind: string;
  baselinePolicyId?: string;
  candidatePolicyId: string;
  hypothesisId?: string;
  evaluationSet: string;
  baselineMetrics: Record<string, number>;
  candidateMetrics: Record<string, number>;
  metricsMeta?: Record<string, { higherIsBetter: boolean }>;
  status: ExperimentStatus;
  decision: ExperimentDecision;
  summary?: string;
  createdAt: number;
  finishedAt?: number;
}

export interface BrainEvaluation {
  id: string;
  userId: string;
  experimentId: string;
  label: string;
  metrics: Record<string, number>;
  notes?: string;
  createdAt: number;
}

export interface BrainActivityEvent {
  id: string;
  ts: number;
  kind: string;
  message: string;
  refs?: string[];
  projectId?: string;
}

export interface RuntimeEvent {
  kind: string;
  text?: string;
  projectId?: string;
  workspaceRoot?: string;
  sourceRef?: string;
  meta?: Record<string, unknown>;
  ts?: number;
}

export type AttentionDecision = 'IGNORE' | 'STORE' | 'CONSOLIDATE' | 'REFLECT' | 'ULTRATHINK';

export interface AttentionScore {
  score: number;
  decision: AttentionDecision;
  reason: string;
}

export interface AttentionThresholds {
  store: number;
  consolidate: number;
  reflect: number;
  ultrathink: number;
}

export const DEFAULT_ATTENTION_THRESHOLDS: AttentionThresholds = {
  store: 0.2,
  consolidate: 0.5,
  reflect: 0.7,
  ultrathink: 0.9,
};

export interface BrainTypeMeta {
  type: string;
  label: string;
  color: string;
  order: number;
  cluster?: string;
}

/** Where a sync left off, so ingestion can resume. */
export interface BrainSyncState {
  workspaceRoot: string;
  status: 'idle' | 'running' | 'done' | 'error';
  phase: string;
  filesTotal: number;
  filesDone: number;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface UpsertEntityInput {
  type: string;
  label: string;
  description?: string;
  confidence?: number;
  sourceType: string;
  sourceRef?: string;
  projectId?: string;
  importance?: number;
  authority?: MemoryAuthority;
  cluster?: MemoryCluster | string;
  evidence?: string;
  validity?: string;
  supersededBy?: string;
}

export interface UpsertRelationshipInput {
  sourceLabel: string;
  sourceType: string;
  targetLabel: string;
  targetType: string;
  relType: string;
  confidence?: number;
  sourceEvent?: string;
  projectId?: string;
}

export interface GraphViewNode {
  id: string;
  label: string;
  type: string;
  importance: number;
  projectId?: string;
  lastSeenAt: number;
  cluster?: string;
  authority?: string;
  degree?: number;
}

export interface GraphViewEdge {
  id: string;
  source: string;
  target: string;
  relType: string;
  confidence: number;
}

export interface GraphView {
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  truncated: boolean;
}

export interface EntityDetail extends BrainEntity {
  projects: Array<{ projectId: string; label: string }>;
  related: Array<{ id: string; label: string; type: string; relType: string; direction: 'out' | 'in' }>;
  decisions: string[];
  learnings: string[];
  episodeCount: number;
}

export interface SearchFilters {
  types?: string[];
  projectId?: string;
  since?: number;
  until?: number;
  limit?: number;
  clusters?: string[];
  relTypes?: string[];
}

export interface SearchResult {
  entity: BrainEntity;
  score: number;
  snippet?: string;
  via: 'vector' | 'label' | 'graph';
}

/** Multi-hop reasoning payload for agents (not UI-only). */
export interface ReasoningContext {
  query: string;
  code: SearchResult[];
  decisions: SearchResult[];
  constraints: SearchResult[];
  failures: SearchResult[];
  experiments: SearchResult[];
  evaluations: SearchResult[];
  dependencies: SearchResult[];
  observations: SearchResult[];
  block: string;
}

export interface SyncProgressEvent {
  workspaceRoot: string;
  status: BrainSyncState['status'];
  phase: string;
  filesDone: number;
  filesTotal: number;
  message?: string;
}

/** Map a memory type to its default semantic cluster. */
export function clusterForType(type: string): MemoryCluster {
  switch (type) {
    case 'architecture':
    case 'layer':
    case 'service':
      return 'architecture';
    case 'decision':
    case 'tradeoff':
    case 'assumption':
      return 'decisions';
    case 'code':
    case 'repository':
    case 'document':
      return 'code';
    case 'technology':
      return 'dependencies';
    case 'bug':
    case 'constraint':
    case 'requirement':
      return 'problems';
    case 'solution':
    case 'learning':
    case 'lesson':
      return 'solutions';
    case 'experiment':
    case 'hypothesis':
    case 'evaluation':
    case 'outcome':
      return 'evaluation';
    case 'goal':
    case 'task':
    case 'plan':
    case 'change':
      return 'tasks';
    case 'concept':
    case 'fact':
    case 'topic':
    case 'observation':
    case 'experience':
    case 'preference':
    case 'conversation':
      return 'memory';
    case 'project':
      return 'project';
    default:
      return 'memory';
  }
}
