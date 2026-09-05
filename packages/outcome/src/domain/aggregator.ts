import type {
  MissionOutcome,
  OutcomeRequirement,
  OutcomeStatus,
  RequirementCriticality,
  RequirementStatus,
} from './types.js';

export interface AggregationInput {
  id: string;
  criticality: RequirementCriticality;
  status: RequirementStatus;
}

export interface AggregationResult {
  status: OutcomeStatus;
  score: number;
  pass_count: number;
  fail_count: number;
  unknown_count: number;
  stale_count: number;
  blocking: string[];
}

/**
 * Score is display-only. Critical FAIL always blocks ACHIEVED.
 * UNKNOWN is never treated as PASS.
 */
export function aggregateOutcome(reqs: AggregationInput[]): AggregationResult {
  const pass_count = reqs.filter((r) => r.status === 'PASS').length;
  const fail_count = reqs.filter((r) => r.status === 'FAIL').length;
  const stale_count = reqs.filter((r) => r.status === 'STALE').length;
  const unknown_count = reqs.filter(
    (r) => r.status === 'UNKNOWN' || r.status === 'PENDING',
  ).length;
  const score = reqs.length === 0 ? 0 : Math.round((pass_count / reqs.length) * 100);

  const blocking = reqs
    .filter(
      (r) =>
        (r.criticality === 'CRITICAL' && r.status !== 'PASS') || r.status === 'FAIL',
    )
    .map((r) => r.id);

  const criticalFail = reqs.some(
    (r) => r.criticality === 'CRITICAL' && r.status === 'FAIL',
  );
  if (criticalFail || fail_count > 0) {
    return {
      status: 'NOT_ACHIEVED',
      score,
      pass_count,
      fail_count,
      unknown_count,
      stale_count,
      blocking,
    };
  }
  if (reqs.length > 0 && pass_count === reqs.length) {
    return {
      status: 'ACHIEVED',
      score,
      pass_count,
      fail_count,
      unknown_count,
      stale_count,
      blocking,
    };
  }
  if (pass_count > 0 && fail_count === 0 && (unknown_count > 0 || stale_count > 0)) {
    return {
      status: 'PARTIALLY_ACHIEVED',
      score,
      pass_count,
      fail_count,
      unknown_count,
      stale_count,
      blocking,
    };
  }
  if (unknown_count > 0 || stale_count > 0) {
    return {
      status: 'UNKNOWN',
      score,
      pass_count,
      fail_count,
      unknown_count,
      stale_count,
      blocking,
    };
  }
  return {
    status: 'IN_PROGRESS',
    score,
    pass_count,
    fail_count,
    unknown_count,
    stale_count,
    blocking,
  };
}

export function outcomeFromRequirements(
  missionId: string,
  reqs: OutcomeRequirement[],
  existing?: MissionOutcome,
): MissionOutcome {
  const agg = aggregateOutcome(reqs);
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? `OUT_${missionId}`,
    mission_id: missionId,
    status: agg.status,
    score: agg.score,
    pass_count: agg.pass_count,
    fail_count: agg.fail_count,
    unknown_count: agg.unknown_count,
    stale_count: agg.stale_count,
    blocking: agg.blocking,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    version: (existing?.version ?? 0) + 1,
  };
}
