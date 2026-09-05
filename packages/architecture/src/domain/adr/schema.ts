import { z } from 'zod';

export const AdrStatusSchema = z.enum([
  'proposed',
  'accepted',
  'implemented',
  'validated',
  'superseded',
  'rejected',
  'deprecated',
]);
export type AdrStatus = z.infer<typeof AdrStatusSchema>;

export const EpistemicTypeSchema = z.enum([
  'FACT',
  'INFERENCE',
  'DECISION',
  'ASSUMPTION',
  'OBSERVATION',
]);
export type EpistemicType = z.infer<typeof EpistemicTypeSchema>;

export const ProvenanceSourceSchema = z.object({
  type: z.enum([
    'conversation',
    'commit',
    'pull_request',
    'document',
    'code',
    'test',
    'incident',
    'deployment',
    'user',
    'system',
  ]),
  project_id: z.string().optional(),
  session_id: z.string().optional(),
  task_id: z.string().optional(),
  message_id: z.string().optional(),
  commit_id: z.string().optional(),
  pull_request_id: z.string().optional(),
  file: z.string().optional(),
  excerpt: z.string().optional(),
});
export type ProvenanceSource = z.infer<typeof ProvenanceSourceSchema>;

export const ProvenancedTextSchema = z.object({
  value: z.string(),
  epistemic: EpistemicTypeSchema.default('DECISION'),
  confidence: z.number().min(0).max(1).default(0.5),
  source: ProvenanceSourceSchema.optional(),
});
export type ProvenancedText = z.infer<typeof ProvenancedTextSchema>;

export const AlternativeSchema = z.object({
  name: z.string(),
  status: z.enum(['considered', 'rejected', 'accepted']).default('rejected'),
  reason: z.string().default(''),
});
export type Alternative = z.infer<typeof AlternativeSchema>;

export const EvidenceItemSchema = z.object({
  type: z.enum([
    'conversation',
    'commit',
    'pull_request',
    'issue',
    'document',
    'code',
    'test',
    'benchmark',
    'metric',
    'incident',
    'deployment',
  ]),
  id: z.string(),
  relationship: z.string().default('supports'),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const ConfidenceFactorsSchema = z.object({
  explicit_decision: z.number().min(0).max(1).default(0),
  reasoning_present: z.number().min(0).max(1).default(0),
  code_evidence: z.number().min(0).max(1).default(0),
  alternative_discussion: z.number().min(0).max(1).default(0),
});
export type ConfidenceFactors = z.infer<typeof ConfidenceFactorsSchema>;

export const ValidationBlockSchema = z.object({
  status: z.enum(['pending', 'passed', 'failed', 'skipped']).default('pending'),
  notes: z.string().optional(),
});

export const AdrDecisionBodySchema = z.object({
  summary: z.string(),
});

export const AdrSchema = z.object({
  id: z.string(),
  version: z.number().int().positive().default(1),
  project_id: z.string(),
  title: z.string(),
  status: AdrStatusSchema.default('proposed'),
  problem: z.string().default(''),
  decision: AdrDecisionBodySchema,
  context: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  non_goals: z.array(z.string()).default([]),
  reasoning: z.array(z.string()).default([]),
  alternatives: z.array(AlternativeSchema).default([]),
  constraints: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  tradeoffs: z.array(z.string()).default([]),
  consequences: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  affected_components: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  evidence: z
    .object({
      commits: z.array(EvidenceItemSchema).default([]),
      pull_requests: z.array(EvidenceItemSchema).default([]),
      tests: z.array(EvidenceItemSchema).default([]),
      documents: z.array(EvidenceItemSchema).default([]),
      conversations: z.array(EvidenceItemSchema).default([]),
      code: z.array(EvidenceItemSchema).default([]),
      incidents: z.array(EvidenceItemSchema).default([]),
      deployments: z.array(EvidenceItemSchema).default([]),
      metrics: z.array(EvidenceItemSchema).default([]),
    })
    .default({
      commits: [],
      pull_requests: [],
      tests: [],
      documents: [],
      conversations: [],
      code: [],
      incidents: [],
      deployments: [],
      metrics: [],
    }),
  ownership: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  confidence_factors: ConfidenceFactorsSchema.default({
    explicit_decision: 0,
    reasoning_present: 0,
    code_evidence: 0,
    alternative_discussion: 0,
  }),
  timestamps: z.object({
    created_at: z.string(),
    updated_at: z.string(),
  }),
  relationships: z
    .object({
      supersedes: z.string().optional(),
      superseded_by: z.string().optional(),
      related: z.array(z.string()).default([]),
    })
    .default({ related: [] }),
  validation: ValidationBlockSchema.default({ status: 'pending' }),
  provenance: z.array(ProvenanceSourceSchema).default([]),
  record_kind: z.enum(['observation', 'candidate', 'decision']).default('candidate'),
});
export type Adr = z.infer<typeof AdrSchema>;

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseAdr(input: unknown): Adr {
  return AdrSchema.parse(input);
}

export function safeParseAdr(input: unknown): Adr | undefined {
  const r = AdrSchema.safeParse(input);
  return r.success ? r.data : undefined;
}

export function embedText(adr: Adr): string {
  return [
    adr.title,
    adr.decision.summary,
    adr.problem,
    ...adr.context,
    ...adr.reasoning,
    ...adr.alternatives.map((a) => `${a.name}: ${a.reason}`),
    ...adr.constraints,
    ...adr.consequences,
  ]
    .filter(Boolean)
    .join('\n');
}
