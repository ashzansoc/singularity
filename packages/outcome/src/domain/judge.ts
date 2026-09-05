import type { AcceptanceCriterion, RequirementStatus } from './types.js';

export interface CheckJudgement {
  mandatory: boolean;
  result: RequirementStatus;
}

/** Criterion: all PASS → PASS; mandatory FAIL → FAIL; else UNKNOWN. Stale never counts as PASS. */
export function judgeCriterion(checks: CheckJudgement[]): RequirementStatus {
  if (checks.length === 0) {
    return 'UNKNOWN';
  }
  if (checks.some((c) => c.result === 'FAIL' && c.mandatory)) {
    return 'FAIL';
  }
  if (checks.every((c) => c.result === 'PASS')) {
    return 'PASS';
  }
  if (checks.some((c) => c.result === 'STALE')) {
    return 'STALE';
  }
  return 'UNKNOWN';
}

export function judgeRequirement(
  criteria: Array<Pick<AcceptanceCriterion, 'mandatory' | 'status'>>,
): RequirementStatus {
  if (criteria.length === 0) {
    return 'UNKNOWN';
  }
  if (criteria.some((c) => c.status === 'FAIL' && c.mandatory)) {
    return 'FAIL';
  }
  if (criteria.every((c) => c.status === 'PASS')) {
    return 'PASS';
  }
  if (criteria.some((c) => c.status === 'STALE')) {
    return 'STALE';
  }
  return 'UNKNOWN';
}

/** Fresh evidence for this requirement version + revision only. */
export function evidenceIsFresh(
  evidence: {
    requirement_version_hash: string;
    code_revision: string;
    result: RequirementStatus;
  },
  expected: { requirement_version_hash: string; code_revision: string },
): boolean {
  if (evidence.result === 'STALE') {
    return false;
  }
  return (
    evidence.requirement_version_hash === expected.requirement_version_hash &&
    evidence.code_revision === expected.code_revision
  );
}
