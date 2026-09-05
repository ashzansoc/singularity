import { z } from 'zod';

export const RequirementStatusSchema = z.enum([
  'PENDING',
  'PASS',
  'FAIL',
  'UNKNOWN',
  'STALE',
]);
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

export const OutcomeStatusSchema = z.enum([
  'IN_PROGRESS',
  'VERIFYING',
  'ACHIEVED',
  'PARTIALLY_ACHIEVED',
  'NOT_ACHIEVED',
  'BLOCKED',
  'UNKNOWN',
  'AWAITING_HUMAN_REVIEW',
  'REVIEW_REJECTED',
]);
export type OutcomeStatus = z.infer<typeof OutcomeStatusSchema>;

export const RequirementCriticalitySchema = z.enum([
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
]);
export type RequirementCriticality = z.infer<typeof RequirementCriticalitySchema>;

export const RequirementTypeSchema = z.enum([
  'functional',
  'behavioral',
  'performance',
  'security',
  'architectural',
  'compatibility',
  'data',
  'operational',
  'ui',
  'integration',
  'reliability',
]);
export type OutcomeRequirementType = z.infer<typeof RequirementTypeSchema>;

export const VerificationTypeSchema = z.enum([
  'COMMAND',
  'TEST',
  'COMPILER',
  'STATIC_ANALYSIS',
  'BROWSER',
  'RUNTIME',
  'DATABASE',
  'DEPLOYMENT',
  'LOAD_TEST',
  'SECURITY',
  'ARCHITECTURE',
]);
export type VerificationType = z.infer<typeof VerificationTypeSchema>;

export const VerificationRunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export type VerificationRunStatus = z.infer<typeof VerificationRunStatusSchema>;

export const LifecycleStageSchema = z.enum([
  'CREATED',
  'REQUIREMENTS_EXTRACTED',
  'OUTCOMES_COMPILED',
  'VERIFICATION_PLANNED',
  'IMPLEMENTATION_IN_PROGRESS',
  'READY_FOR_VERIFICATION',
  'VERIFYING',
  'ACHIEVED',
  'REMEDIATION',
  'AWAITING_HUMAN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
]);
export type LifecycleStage = z.infer<typeof LifecycleStageSchema>;

export const EvidenceTypeSchema = z.enum([
  'test',
  'compiler',
  'runtime',
  'static_analysis',
  'browser',
  'database',
  'deployment',
  'load_test',
  'security_scan',
  'command',
  'human',
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const MissionSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  project_id: z.string(),
  title: z.string(),
  request_text: z.string(),
  status: OutcomeStatusSchema,
  lifecycle: LifecycleStageSchema,
  session_id: z.string().optional(),
  code_revision: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().positive(),
});
export type Mission = z.infer<typeof MissionSchema>;

export const ObjectiveSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  statement: z.string(),
  status: RequirementStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().positive(),
});
export type Objective = z.infer<typeof ObjectiveSchema>;

export const OutcomeRequirementSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  objective_id: z.string().optional(),
  description: z.string(),
  type: RequirementTypeSchema,
  priority: z.enum(['high', 'medium', 'low']),
  criticality: RequirementCriticalitySchema,
  status: RequirementStatusSchema,
  source_requirement_id: z.string().optional(),
  source: z.object({
    type: z.string(),
    text: z.string(),
  }),
  constraints: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  measurable_properties: z.array(z.string()).default([]),
  requirement_version_hash: z.string(),
  scope: z.enum(['FILE', 'TASK', 'FEATURE', 'PHASE', 'MISSION']).default('MISSION'),
  owned_paths: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().positive(),
});
export type OutcomeRequirement = z.infer<typeof OutcomeRequirementSchema>;

export const AcceptanceCriterionSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  requirement_id: z.string(),
  condition: z.string(),
  verification_type: VerificationTypeSchema,
  mandatory: z.boolean().default(true),
  status: RequirementStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().positive(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const VerificationPlanSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  requirement_id: z.string(),
  criterion_id: z.string(),
  type: VerificationTypeSchema,
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  success_pattern: z.string().optional(),
  timeout_ms: z.number().int().positive(),
  workspace_root: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().positive(),
  status: z.string().default('READY'),
});
export type VerificationPlan = z.infer<typeof VerificationPlanSchema>;

export const VerificationRunSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  plan_id: z.string(),
  requirement_id: z.string(),
  criterion_id: z.string(),
  status: VerificationRunStatusSchema,
  result: RequirementStatusSchema.optional(),
  code_revision: z.string().optional(),
  requirement_version_hash: z.string().optional(),
  idempotency_key: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().positive(),
});
export type VerificationRun = z.infer<typeof VerificationRunSchema>;

export const EvidenceSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  verification_id: z.string(),
  requirement_id: z.string(),
  criterion_id: z.string(),
  type: EvidenceTypeSchema,
  source: z.string(),
  result: RequirementStatusSchema,
  exit_code: z.number().optional(),
  duration_ms: z.number(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  artifact: z.string().optional(),
  tests_discovered: z.number().optional(),
  tests_executed: z.number().optional(),
  tests_passed: z.number().optional(),
  tests_failed: z.number().optional(),
  tests_skipped: z.number().optional(),
  requirement_version_hash: z.string(),
  code_revision: z.string(),
  environment: z.string().default('test'),
  timestamp: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.literal(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const MissionOutcomeSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  status: OutcomeStatusSchema,
  score: z.number(),
  pass_count: z.number(),
  fail_count: z.number(),
  unknown_count: z.number(),
  stale_count: z.number(),
  blocking: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().positive(),
});
export type MissionOutcome = z.infer<typeof MissionOutcomeSchema>;

export const RemediationSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  requirement_id: z.string(),
  status: z.string(),
  failure: z.object({
    expected: z.string(),
    actual: z.string(),
  }),
  evidence_ids: z.array(z.string()),
  planner_prompt: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  version: z.number().int().positive(),
});
export type Remediation = z.infer<typeof RemediationSchema>;

export const HumanReviewStatusSchema = z.enum([
  'NOT_REQUIRED',
  'PENDING',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'EXPIRED',
  'SUPERSEDED',
]);
export type HumanReviewStatus = z.infer<typeof HumanReviewStatusSchema>;

export const HumanReviewDecisionSchema = z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES']);
export type HumanReviewDecision = z.infer<typeof HumanReviewDecisionSchema>;

export const HumanReviewTypeSchema = z.enum([
  'MISSION',
  'ARCHITECTURE',
  'PRODUCTION',
  'SECURITY',
  'DATA',
  'CODE',
  'QUALITY',
]);
export type HumanReviewType = z.infer<typeof HumanReviewTypeSchema>;

export const HumanReviewPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type HumanReviewPriority = z.infer<typeof HumanReviewPrioritySchema>;

export const ExecutionGateSchema = z.enum(['OPEN', 'HUMAN_GATE_BLOCKED']);
export type ExecutionGate = z.infer<typeof ExecutionGateSchema>;

export const HumanReviewSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  review_type: HumanReviewTypeSchema,
  status: HumanReviewStatusSchema,
  priority: HumanReviewPrioritySchema.default('MEDIUM'),
  reason: z.string(),
  policy_id: z.string(),
  required: z.boolean(),
  blocking: z.boolean(),
  blocks_execution: z.boolean().default(false),
  requested_at: z.string(),
  requested_by: z.string().default('system'),
  reviewed_at: z.string().optional(),
  reviewed_by: z.string().optional(),
  decision: HumanReviewDecisionSchema.optional(),
  decision_reason: z.string().optional(),
  evidence_refs: z.array(z.string()).default([]),
  artifact_refs: z.array(z.string()).default([]),
  adr_refs: z.array(z.string()).default([]),
  risk_refs: z.array(z.string()).default([]),
  outcome_refs: z.array(z.string()).default([]),
  evidence_package_id: z.string().optional(),
  fingerprint: z.string(),
  mission_version: z.number().int(),
  author_id: z.string().optional(),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type HumanReview = z.infer<typeof HumanReviewSchema>;

export const HumanReviewEventSchema = z.object({
  id: z.string(),
  review_id: z.string(),
  mission_id: z.string(),
  event_type: z.string(),
  actor_id: z.string(),
  actor_roles: z.array(z.string()).default([]),
  decision: HumanReviewDecisionSchema.optional(),
  reason: z.string().optional(),
  evidence_package_id: z.string().optional(),
  policy_id: z.string().optional(),
  mission_version: z.number().int().optional(),
  fingerprint: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
  created_at: z.string(),
});
export type HumanReviewEvent = z.infer<typeof HumanReviewEventSchema>;

export const ReviewEvidenceItemSchema = z.object({
  kind: z.string(),
  id: z.string(),
  label: z.string(),
  provenance: z.string().optional(),
});
export type ReviewEvidenceItem = z.infer<typeof ReviewEvidenceItemSchema>;

export const ReviewEvidencePackageSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  review_id: z.string().optional(),
  objective: z.string(),
  proposed_changes: z.array(ReviewEvidenceItemSchema).default([]),
  risk: z.object({
    level: z.string().optional(),
    score: z.number().optional(),
    refs: z.array(z.string()).default([]),
  }),
  architecture_impact: z.string().optional(),
  adr_changes: z.array(ReviewEvidenceItemSchema).default([]),
  commits: z.array(ReviewEvidenceItemSchema).default([]),
  prs: z.array(ReviewEvidenceItemSchema).default([]),
  tests: z.array(ReviewEvidenceItemSchema).default([]),
  deployments: z.array(ReviewEvidenceItemSchema).default([]),
  incidents: z.array(ReviewEvidenceItemSchema).default([]),
  verification_results: z.array(ReviewEvidenceItemSchema).default([]),
  conflicting_evidence: z.array(ReviewEvidenceItemSchema).default([]),
  outcome_prediction: z.object({
    status: z.string(),
    score: z.number(),
  }),
  why_required: z.string(),
  created_at: z.string(),
  version: z.literal(1),
});
export type ReviewEvidencePackage = z.infer<typeof ReviewEvidencePackageSchema>;

export const ReviewPolicyRuleSchema = z.object({
  id: z.string(),
  review_type: HumanReviewTypeSchema,
  required: z.boolean().default(true),
  blocking: z.boolean().default(false),
  blocks_execution: z.boolean().default(false),
  priority: HumanReviewPrioritySchema.default('MEDIUM'),
  reason: z.string().optional(),
  when: z.object({
    risk_levels: z.array(z.string()).optional(),
    affects_production: z.boolean().optional(),
    architecture_impact: z.array(z.string()).optional(),
    impact_recommendations: z.array(z.string()).optional(),
    has_proposed_adrs: z.boolean().optional(),
    security_sensitive: z.boolean().optional(),
    schema_change: z.boolean().optional(),
    deployment_change: z.boolean().optional(),
    large_refactor: z.boolean().optional(),
    verification_failures: z.boolean().optional(),
    conflicting_evidence: z.boolean().optional(),
    max_outcome_confidence: z.number().optional(),
    mission_types: z.array(z.string()).optional(),
  }),
  version: z.number().int().positive().default(1),
});
export type ReviewPolicyRule = z.infer<typeof ReviewPolicyRuleSchema>;
