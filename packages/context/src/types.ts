/**
 * Canonical structured project state for the Singularity Context Engine.
 */

export type ItemStatus =
  | 'active'
  | 'superseded'
  | 'completed'
  | 'rejected'
  | 'uncertain'
  | 'archived'
  | 'proposed';

export type SourceType = 'explicit' | 'inferred' | 'user_override';

export type RequirementType =
  | 'functional'
  | 'non_functional'
  | 'technical'
  | 'ui'
  | 'ux'
  | 'performance'
  | 'security'
  | 'deployment'
  | 'data'
  | 'integration'
  | 'business'
  | 'testing';

export type ConstraintKind =
  | 'technology'
  | 'architecture'
  | 'process'
  | 'security'
  | 'performance'
  | 'compatibility'
  | 'other';

export type ConstraintStrength = 'hard' | 'soft';

export type ConfidenceCategory = 'high' | 'medium' | 'low';

export type SourceRefType =
  | 'conversation'
  | 'document'
  | 'code'
  | 'user_override'
  | 'system';

export interface SourceReference {
  type: SourceRefType;
  message_id?: string;
  document_id?: string;
  page?: number;
  section?: string;
  repository?: string;
  file?: string;
  line_start?: number;
  line_end?: number;
  symbol?: string;
  /** Character offsets into source text when available (never fabricated). */
  char_start?: number;
  char_end?: number;
  excerpt?: string;
}

export interface ContextItemBase {
  id: string;
  status: ItemStatus;
  /** 0–1 numeric confidence when available. */
  confidence: number;
  confidence_category: ConfidenceCategory;
  source_type: SourceType;
  source: SourceReference;
  created_at: string;
  updated_at: string;
  last_verified_at?: string;
  /** When superseded, points at the replacement item id. */
  superseded_by?: string;
  /** When this item supersedes another. */
  supersedes?: string;
}

export interface Requirement extends ContextItemBase {
  type: RequirementType;
  description: string;
  priority: 'high' | 'medium' | 'low';
}

export interface Constraint extends ContextItemBase {
  constraint: string;
  kind: ConstraintKind;
  strength: ConstraintStrength;
}

export interface Prohibition extends ContextItemBase {
  prohibition: string;
  kind: ConstraintKind;
}

export interface Technology extends ContextItemBase {
  name: string;
  category: string;
  role?: string;
}

export interface ArchitectureDecision extends ContextItemBase {
  decision: string;
  category: string;
  alternatives_rejected: string[];
  rationale?: string;
}

export interface UserPreference extends ContextItemBase {
  preference: string;
  category: string;
}

export interface Goal extends ContextItemBase {
  goal: string;
  priority: 'high' | 'medium' | 'low';
}

export interface OpenQuestion extends ContextItemBase {
  question: string;
  related_item_ids: string[];
}

export interface ProjectEntity extends ContextItemBase {
  name: string;
  entity_type: string;
  description?: string;
}

export interface FileReference extends ContextItemBase {
  path: string;
  reason?: string;
  related_item_ids: string[];
}

export interface ProjectStateMeta {
  project_id: string;
  version: number;
  last_updated: string;
  workspace_root?: string;
}

/** Full in-memory project state (normalized collections). */
export interface ProjectState {
  meta: ProjectStateMeta;
  requirements: Requirement[];
  constraints: Constraint[];
  prohibitions: Prohibition[];
  technologies: Technology[];
  architecture_decisions: ArchitectureDecision[];
  user_preferences: UserPreference[];
  current_goals: Goal[];
  open_questions: OpenQuestion[];
  entities: ProjectEntity[];
  important_files: FileReference[];
  source_references: SourceReference[];
}

/** Delta produced by extraction (before merge). */
export interface ExtractionDelta {
  requirements?: Array<Partial<Requirement> & { description: string }>;
  constraints?: Array<Partial<Constraint> & { constraint: string }>;
  prohibitions?: Array<Partial<Prohibition> & { prohibition: string }>;
  technologies?: Array<Partial<Technology> & { name: string }>;
  architecture_decisions?: Array<
    Partial<ArchitectureDecision> & { decision: string }
  >;
  user_preferences?: Array<Partial<UserPreference> & { preference: string }>;
  current_goals?: Array<Partial<Goal> & { goal: string }>;
  open_questions?: Array<Partial<OpenQuestion> & { question: string }>;
  entities?: Array<Partial<ProjectEntity> & { name: string }>;
  important_files?: Array<Partial<FileReference> & { path: string }>;
  /** Explicit supersession hints from the extractor. */
  supersessions?: Array<{
    kind: string;
    old_text: string;
    new_text: string;
  }>;
}

export interface ExtractionResult {
  delta: ExtractionDelta;
  raw_item_count: number;
  provider?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  latency_ms: number;
  used_fallback?: boolean;
  error?: string;
}

export interface SourceMetadata {
  type: SourceRefType;
  message_id?: string;
  document_id?: string;
  page?: number;
  section?: string;
  file?: string;
  repository?: string;
}

export interface RelevantContext {
  requirements: Requirement[];
  constraints: Constraint[];
  prohibitions: Prohibition[];
  technologies: Technology[];
  decisions: ArchitectureDecision[];
  preferences: UserPreference[];
  goals: Goal[];
  open_questions: OpenQuestion[];
  files: FileReference[];
  /** Compact prompt block. */
  prompt_block: string;
  /** Estimated tokens in prompt_block. */
  estimated_tokens: number;
}

export interface ExtractionCostReport {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  estimated_cost_usd?: number;
}

export interface AgentTokenReport {
  raw_context_tokens: number;
  retrieved_context_tokens: number;
  agent_input_tokens?: number;
  agent_output_tokens?: number;
  cache_read_tokens?: number;
}
