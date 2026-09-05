import type { Evidence, OutcomeRequirement, Remediation } from '../domain/types.js';
import { newId, nowIso } from '../ids.js';

export function buildRemediation(
  req: OutcomeRequirement,
  evidence: Evidence[],
): Remediation {
  const latest = evidence[evidence.length - 1];
  const now = nowIso();
  const expected = req.description;
  const actual = latest
    ? `result=${latest.result} exit=${latest.exit_code ?? '?'} ${latest.stderr?.slice(0, 400) ?? ''}`
    : 'no evidence';
  const planner_prompt = [
    `Requirement ${req.id} (${req.criticality}): ${req.description}`,
    `Status: FAIL`,
    `Expected: ${expected}`,
    `Observed: ${actual}`,
    `Evidence: ${evidence.map((e) => e.id).join(', ') || 'none'}`,
    `Create a remediation task to satisfy this requirement. Do not mark it complete without independent verification.`,
  ].join('\n');
  return {
    id: newId('REM'),
    mission_id: req.mission_id,
    requirement_id: req.id,
    status: 'FAIL',
    failure: { expected, actual },
    evidence_ids: evidence.map((e) => e.id),
    planner_prompt,
    created_at: now,
    updated_at: now,
    version: 1,
  };
}
