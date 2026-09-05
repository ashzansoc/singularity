import { z } from 'zod';

export const PRODUCTION_EVIDENCE_TYPES = [
  'OBSERVED',
  'REPORTED',
  'MEASURED',
  'TESTED',
  'CORRELATED',
  'INFERRED',
] as const;

export type ProductionEvidenceType = (typeof PRODUCTION_EVIDENCE_TYPES)[number];

export const ProductionEvidenceSchema = z.object({
  evidence_id: z.string(),
  source: z.string(),
  source_event_id: z.string().optional(),
  observed_at: z.string(),
  reference: z.string().optional(),
  evidence_type: z.enum(PRODUCTION_EVIDENCE_TYPES),
  confidence: z.number().min(0).max(1).default(1),
  metadata: z.record(z.unknown()).optional(),
});

export type ProductionEvidence = z.infer<typeof ProductionEvidenceSchema>;

const DEFAULT_TYPE: Record<string, ProductionEvidenceType> = {
  deployment: 'OBSERVED',
  incident: 'REPORTED',
  metric: 'MEASURED',
  test: 'TESTED',
};

const DEFAULT_CONFIDENCE: Record<ProductionEvidenceType, number> = {
  OBSERVED: 1,
  REPORTED: 0.9,
  MEASURED: 1,
  TESTED: 1,
  CORRELATED: 0.6,
  INFERRED: 0.4,
};

export function evidenceForFamily(
  family: 'deployment' | 'incident' | 'metric' | 'test',
  opts: {
    source: string;
    source_event_id?: string;
    observed_at: string;
    reference?: string;
    metadata?: Record<string, unknown>;
  },
): ProductionEvidence {
  const evidence_type = DEFAULT_TYPE[family];
  return {
    evidence_id: `ev_${opts.source_event_id ?? Date.now().toString(36)}_${family}`,
    source: opts.source,
    source_event_id: opts.source_event_id,
    observed_at: opts.observed_at,
    reference: opts.reference,
    evidence_type,
    confidence: DEFAULT_CONFIDENCE[evidence_type],
    metadata: { ...opts.metadata, epistemic: 'FACT' },
  };
}

export function correlatedEvidence(opts: {
  source: string;
  source_event_id?: string;
  observed_at: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}): ProductionEvidence {
  return {
    evidence_id: `ev_corr_${opts.source_event_id ?? Date.now().toString(36)}`,
    source: opts.source,
    source_event_id: opts.source_event_id,
    observed_at: opts.observed_at,
    reference: opts.reference,
    evidence_type: 'CORRELATED',
    confidence: DEFAULT_CONFIDENCE.CORRELATED,
    metadata: { ...opts.metadata, epistemic: 'INFERENCE' },
  };
}
