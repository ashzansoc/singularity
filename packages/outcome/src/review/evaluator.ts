import type { ReviewPolicyRule } from '../domain/types.js';

export interface MissionSignals {
  mission_id: string;
  mission_type?: string;
  risk_level?: string;
  risk_score?: number;
  affects_production: boolean;
  architecture_impact?: string;
  impact_recommendation?: string;
  has_proposed_adrs: boolean;
  security_sensitive: boolean;
  schema_change: boolean;
  deployment_change: boolean;
  large_refactor: boolean;
  verification_failures: boolean;
  conflicting_evidence: boolean;
  outcome_confidence: number;
}

export interface PolicyHit {
  policy: ReviewPolicyRule;
  required: boolean;
  blocking: boolean;
  blocks_execution: boolean;
  reason: string;
}

function includesCI(hay: string[] | undefined, needle: string | undefined): boolean {
  if (!hay?.length || !needle) {
    return false;
  }
  const n = needle.toLowerCase();
  return hay.some((h) => h.toLowerCase() === n);
}

function matches(when: ReviewPolicyRule['when'], s: MissionSignals): boolean {
  const checks: boolean[] = [];
  if (when.risk_levels?.length) {
    checks.push(includesCI(when.risk_levels, s.risk_level));
  }
  if (when.affects_production !== undefined) {
    checks.push(when.affects_production === s.affects_production);
  }
  if (when.architecture_impact?.length) {
    checks.push(includesCI(when.architecture_impact, s.architecture_impact));
  }
  if (when.impact_recommendations?.length) {
    checks.push(includesCI(when.impact_recommendations, s.impact_recommendation));
  }
  if (when.has_proposed_adrs !== undefined) {
    checks.push(when.has_proposed_adrs === s.has_proposed_adrs);
  }
  if (when.security_sensitive !== undefined) {
    checks.push(when.security_sensitive === s.security_sensitive);
  }
  if (when.schema_change !== undefined) {
    checks.push(when.schema_change === s.schema_change);
  }
  if (when.deployment_change !== undefined) {
    checks.push(when.deployment_change === s.deployment_change);
  }
  if (when.large_refactor !== undefined) {
    checks.push(when.large_refactor === s.large_refactor);
  }
  if (when.verification_failures !== undefined) {
    checks.push(when.verification_failures === s.verification_failures);
  }
  if (when.conflicting_evidence !== undefined) {
    checks.push(when.conflicting_evidence === s.conflicting_evidence);
  }
  if (when.max_outcome_confidence !== undefined) {
    checks.push(s.outcome_confidence <= when.max_outcome_confidence);
  }
  if (when.mission_types?.length) {
    checks.push(includesCI(when.mission_types, s.mission_type));
  }
  return checks.length > 0 && checks.every(Boolean);
}

export function evaluatePolicies(signals: MissionSignals, policies: ReviewPolicyRule[]): PolicyHit[] {
  const hits: PolicyHit[] = [];
  for (const policy of policies) {
    if (!matches(policy.when, signals)) {
      continue;
    }
    hits.push({
      policy,
      required: policy.required,
      blocking: policy.blocking,
      blocks_execution: policy.blocks_execution,
      reason: policy.reason ?? `Policy ${policy.id} matched`,
    });
  }
  return hits;
}
