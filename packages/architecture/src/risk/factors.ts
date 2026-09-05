import type { ImpactAnalysisResult, ImpactSeverity } from '../impact/types.js';
import type { StoredProductionEvent } from '../memory/decisionStore.js';
import type { StoredRiskAssessment } from './types.js';
import {
  type PromptRiskInput,
  type RiskAssessmentRequest,
  type RiskFactor,
  type RiskLevel,
  type VerificationInput,
} from './types.js';
import { clampScore, riskLevelFromScore, type RiskWeights } from './weights.js';

function severityScore(sev: ImpactSeverity | undefined): number {
  if (sev === 'critical') {
    return 90;
  }
  if (sev === 'high') {
    return 65;
  }
  if (sev === 'medium') {
    return 40;
  }
  return 15;
}

function factor(
  type: RiskFactor['type'],
  score: number,
  weight: number,
  explanation: string,
  evidence_refs: string[],
): RiskFactor {
  const s = clampScore(score);
  return {
    type,
    score: s,
    weight,
    contribution: Math.round(weight * s * 100) / 100,
    severity: riskLevelFromScore(s),
    explanation,
    evidence_refs,
  };
}

export interface ProductionSignal {
  incidents: number;
  failed_deploys: number;
  rollbacks: number;
  metric_breaches: number;
  test_failures: number;
  recent_success_deploys: number;
  refs: string[];
}

export function parseProductionSignals(
  events: StoredProductionEvent[],
  services: string[],
): ProductionSignal {
  const svc = new Set(services.map((s) => s.toLowerCase()));
  const out: ProductionSignal = {
    incidents: 0,
    failed_deploys: 0,
    rollbacks: 0,
    metric_breaches: 0,
    test_failures: 0,
    recent_success_deploys: 0,
    refs: [],
  };
  for (const row of events) {
    let parsed: { event_type?: string; service?: string; event_id?: string } = {};
    try {
      parsed = JSON.parse(row.json) as typeof parsed;
    } catch {
      parsed = { event_type: row.event_type };
    }
    const service = (parsed.service ?? '').toLowerCase();
    if (svc.size && service && !svc.has(service)) {
      continue;
    }
    const t = parsed.event_type ?? row.event_type;
    const id = parsed.event_id ?? row.event_id;
    if (t === 'INCIDENT_REPORTED' || t === 'INCIDENT_UPDATED') {
      out.incidents += 1;
      out.refs.push(`production:${id}`);
    } else if (t === 'DEPLOYMENT_FAILED') {
      out.failed_deploys += 1;
      out.refs.push(`production:${id}`);
    } else if (t === 'DEPLOYMENT_ROLLED_BACK') {
      out.rollbacks += 1;
      out.refs.push(`production:${id}`);
    } else if (t === 'METRIC_THRESHOLD_BREACHED') {
      out.metric_breaches += 1;
      out.refs.push(`production:${id}`);
    } else if (t === 'TEST_FAILED' || t === 'TEST_REGRESSION') {
      out.test_failures += 1;
      out.refs.push(`production:${id}`);
    } else if (t === 'DEPLOYMENT_SUCCEEDED') {
      out.recent_success_deploys += 1;
    }
  }
  return out;
}

export function blastRadiusFactor(impact: ImpactAnalysisResult | undefined, weights: RiskWeights): RiskFactor {
  const w = weights.change_blast_radius;
  if (!impact) {
    return factor('change_blast_radius', 0, w, 'no impact-analysis evidence', []);
  }
  const refs = [`impact:${impact.analysis_id}`];
  let score = severityScore(impact.severity);
  if (impact.affected_services.length >= 3) {
    score = Math.min(100, score + 8);
  }
  if ((impact.affected_symbols?.length ?? 0) >= 20) {
    score = Math.min(100, score + 6);
  }
  const explanation = `impact severity ${impact.severity} (${impact.affected_symbols.length} symbols, ${impact.affected_services.length} services)`;
  return factor('change_blast_radius', score, w, explanation, refs);
}

export function architectureFactor(
  impact: ImpactAnalysisResult | undefined,
  weights: RiskWeights,
): RiskFactor {
  const w = weights.architecture;
  if (!impact) {
    return factor('architecture', 0, w, 'no architecture correlation evidence', []);
  }
  const conflicts = impact.conflicts.length;
  const drifts = impact.drifts.length;
  const constraints = impact.constraints.length;
  const adrs = impact.affected_adrs.length;
  const score = Math.min(100, conflicts * 28 + drifts * 22 + constraints * 8 + adrs * 6);
  const refs = [
    ...impact.affected_adrs.map((id) => `adr:${id}`),
    ...impact.conflicts.map((id) => `conflict:${id}`),
    ...impact.drifts.map((id) => `drift:${id}`),
  ];
  const explanation =
    conflicts || drifts || constraints || adrs
      ? `${conflicts} conflicts, ${drifts} drifts, ${constraints} constraints, ${adrs} ADRs`
      : 'no ADR conflicts, drift, or constraints matched this change';
  return factor('architecture', score, w, explanation, refs);
}

export function adrDocumentedRiskFactors(
  adrRisks: Array<{ adr_id: string; text: string }>,
  architectureWeight: number,
): RiskFactor[] {
  if (!adrRisks.length) {
    return [];
  }
  const share = architectureWeight / adrRisks.length;
  return adrRisks.map((r) =>
    factor('adr_documented_risk', 55, share, r.text, [`adr:${r.adr_id}`]),
  );
}

export function productionFactor(sig: ProductionSignal, weights: RiskWeights): RiskFactor {
  const w = weights.production;
  const score = Math.min(
    100,
    sig.incidents * 35 + sig.failed_deploys * 30 + sig.rollbacks * 40 + sig.metric_breaches * 15,
  );
  const explanation = sig.refs.length
    ? `${sig.incidents} incidents, ${sig.failed_deploys} failed deploys, ${sig.rollbacks} rollbacks, ${sig.metric_breaches} metric breaches`
    : 'no production evidence associated with affected services';
  return factor('production', score, w, explanation, sig.refs);
}

export function historicalFactor(
  prior: StoredRiskAssessment[],
  sig: ProductionSignal,
  weights: RiskWeights,
): RiskFactor {
  const w = weights.historical;
  let highPriors = 0;
  for (const p of prior) {
    const lvl = (p.risk_level ?? '').toUpperCase();
    if (lvl === 'HIGH' || lvl === 'CRITICAL') {
      highPriors += 1;
    }
  }
  const score = Math.min(100, highPriors * 20 + Math.min(sig.rollbacks + sig.incidents, 4) * 12);
  const explanation = prior.length
    ? `${prior.length} prior assessments (${highPriors} high/critical); ${sig.rollbacks} historical rollbacks`
    : 'no historical risk assessments for overlapping services';
  return factor(
    'historical',
    score,
    w,
    explanation,
    prior.slice(0, 8).map((p) => `risk:${p.assessment_id}`),
  );
}

export function verificationFactor(
  impact: ImpactAnalysisResult | undefined,
  verification: VerificationInput | undefined,
  sig: ProductionSignal,
  weights: RiskWeights,
  testCount = 0,
): RiskFactor {
  const w = weights.verification;
  const symbolCount = impact?.affected_symbols.length ?? 0;
  const missing = verification?.missing_tests?.length ?? 0;
  let score = 0;
  const refs: string[] = [];
  if (verification?.last_run_failed || sig.test_failures) {
    score = Math.max(score, 70);
    refs.push('verification:last_run_failed');
  }
  if (missing) {
    score = Math.max(score, 60);
    refs.push(...(verification?.missing_tests ?? []).map((s) => `symbol:${s}`));
  }
  if (symbolCount >= 3 && testCount === 0 && missing === 0 && !verification?.last_run_failed) {
    score = Math.max(score, 50);
  }
  if (typeof verification?.coverage_hint === 'number' && verification.coverage_hint < 0.4) {
    score = Math.max(score, 45);
  }
  const explanation =
    score === 0
      ? testCount
        ? `${testCount} related tests identified`
        : 'no verification gap detected'
      : 'affected areas lack sufficient verification evidence';
  return factor('verification', score, w, explanation, refs);
}

export function complexityFactor(
  req: RiskAssessmentRequest,
  impact: ImpactAnalysisResult | undefined,
  weights: RiskWeights,
): RiskFactor {
  const w = weights.complexity;
  const services = new Set([
    ...(req.services ?? []),
    ...(impact?.affected_services ?? []),
  ]);
  const files = new Set([...(req.affected_files ?? []), ...(impact?.affected_files ?? [])]);
  const constraints = impact?.constraints.length ?? 0;
  const score = Math.min(100, services.size * 18 + Math.min(files.size, 40) * 1.2 + constraints * 8);
  const explanation = `${services.size} components, ${files.size} files, ${constraints} constraints`;
  return factor('complexity', score, w, explanation, [...services].map((s) => `service:${s}`));
}

export function promptFactor(prompt: PromptRiskInput | undefined, weights: RiskWeights): RiskFactor {
  const w = weights.prompt;
  if (!prompt) {
    return factor('prompt', 0, w, 'no cached prompt-simulator score provided', []);
  }
  let score = 0;
  if (typeof prompt.predicted_success === 'number') {
    score = clampScore((1 - prompt.predicted_success) * 100);
  } else if (typeof prompt.predicted_regeneration === 'number') {
    score = clampScore(prompt.predicted_regeneration * 80);
  }
  if (prompt.passed === false) {
    score = Math.max(score, 60);
  }
  return factor(
    'prompt',
    score,
    w,
    `prompt predicted_success=${prompt.predicted_success ?? 'n/a'} passed=${prompt.passed ?? 'n/a'}`,
    ['prompt:simulator'],
  );
}

export function mitigationFactors(testCount: number, sig: ProductionSignal): RiskFactor[] {
  const out: RiskFactor[] = [];
  if (testCount > 0) {
    out.push({
      type: 'mitigation_tests',
      score: testCount,
      weight: 0,
      contribution: -4,
      severity: 'LOW',
      explanation: `existing test coverage (${testCount} related tests)`,
      evidence_refs: ['verification:tests'],
    });
  }
  if (sig.recent_success_deploys > 0 && sig.failed_deploys === 0 && sig.rollbacks === 0) {
    out.push({
      type: 'mitigation_recent_deploy',
      score: sig.recent_success_deploys,
      weight: 0,
      contribution: -2,
      severity: 'LOW',
      explanation: `${sig.recent_success_deploys} recent successful deploy(s)`,
      evidence_refs: ['production:deploy_success'],
    });
  }
  return out;
}

export type { RiskLevel };
