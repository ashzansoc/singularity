import type { Mission, MissionOutcome, ReviewEvidenceItem, ReviewEvidencePackage } from '../domain/types.js';
import { newId, nowIso } from '../ids.js';
import type { ArchitectureSignals } from './port.js';

export function buildEvidencePackage(input: {
  mission: Mission;
  outcome?: MissionOutcome;
  why_required: string;
  review_id?: string;
  verification: ReviewEvidenceItem[];
  signals: ArchitectureSignals;
}): ReviewEvidencePackage {
  const s = input.signals;
  return {
    id: newId('REVP'),
    mission_id: input.mission.id,
    review_id: input.review_id,
    objective: input.mission.request_text,
    proposed_changes: s.architecture_changes ?? [],
    risk: {
      level: s.risk_level,
      score: s.risk_score,
      refs: s.risk_refs ?? [],
    },
    architecture_impact: s.architecture_impact,
    adr_changes: [...(s.proposed_adrs ?? []), ...(s.adrs ?? [])],
    commits: s.commits ?? [],
    prs: s.prs ?? [],
    tests: s.tests ?? [],
    deployments: s.deployments ?? [],
    incidents: s.incidents ?? [],
    verification_results: input.verification,
    conflicting_evidence: s.conflicts ?? [],
    outcome_prediction: {
      status: input.outcome?.status ?? input.mission.status,
      score: input.outcome?.score ?? 0,
    },
    why_required: input.why_required,
    created_at: nowIso(),
    version: 1,
  };
}
