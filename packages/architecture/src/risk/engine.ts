import type { ImpactAnalysisResult } from '../impact/types.js';
import type { StoredProductionEvent } from '../memory/decisionStore.js';
import type { StoredRiskAssessment } from './types.js';
import {
  adrDocumentedRiskFactors,
  architectureFactor,
  blastRadiusFactor,
  complexityFactor,
  historicalFactor,
  mitigationFactors,
  parseProductionSignals,
  productionFactor,
  promptFactor,
  verificationFactor,
} from './factors.js';
import { buildRecommendations } from './recommendations.js';
import type { RiskAssessmentRequest, RiskFactor } from './types.js';
import { clampScore, resolveRiskWeights, riskLevelFromScore, type RiskWeights } from './weights.js';
import type { ArchitectureFlags } from '../flags.js';

export interface RiskEngineSignals {
  request: RiskAssessmentRequest;
  impact?: ImpactAnalysisResult;
  adrRisks: Array<{ adr_id: string; text: string }>;
  productionEvents: StoredProductionEvent[];
  priorAssessments: StoredRiskAssessment[];
  testNames?: string[];
  codePartial?: boolean;
  historyEmpty?: boolean;
}

export interface RiskEngineOutput {
  risk_score: number;
  risk_level: ReturnType<typeof riskLevelFromScore>;
  confidence: number;
  factors: RiskFactor[];
  recommendations: ReturnType<typeof buildRecommendations>;
  evidence_refs: string[];
}

export function scoreMissionRisk(
  signals: RiskEngineSignals,
  flags?: ArchitectureFlags,
  weights?: RiskWeights,
): RiskEngineOutput {
  const w = weights ?? resolveRiskWeights(flags);
  const services = [
    ...new Set([...(signals.request.services ?? []), ...(signals.impact?.affected_services ?? [])]),
  ];
  const sig = parseProductionSignals(signals.productionEvents, services);
  const testCount = signals.testNames?.length ?? 0;
  const factors: RiskFactor[] = [
    blastRadiusFactor(signals.impact, w),
    architectureFactor(signals.impact, w),
    ...adrDocumentedRiskFactors(signals.adrRisks, w.architecture),
    productionFactor(sig, w),
    historicalFactor(signals.priorAssessments, sig, w),
    verificationFactor(signals.impact, signals.request.verification, sig, w, testCount),
    complexityFactor(signals.request, signals.impact, w),
    promptFactor(signals.request.prompt_risk, w),
    ...mitigationFactors(testCount, sig),
  ];
  const dimension = factors.filter(
    (f) =>
      f.type === 'change_blast_radius' ||
      f.type === 'architecture' ||
      f.type === 'production' ||
      f.type === 'historical' ||
      f.type === 'verification' ||
      f.type === 'complexity' ||
      f.type === 'prompt',
  );
  const adrExtra = factors
    .filter((f) => f.type === 'adr_documented_risk')
    .reduce((s, f) => s + Math.min(8, f.contribution), 0);
  const mitigations = factors
    .filter((f) => f.type.startsWith('mitigation_'))
    .reduce((s, f) => s + f.contribution, 0);
  const weighted = dimension.reduce((s, f) => s + f.contribution, 0);
  const risk_score = clampScore(weighted + adrExtra + mitigations);
  const risk_level = riskLevelFromScore(risk_score);
  let confidence = 0.9;
  if (!signals.impact || signals.codePartial) {
    confidence -= 0.15;
  }
  if (!signals.priorAssessments.length || signals.historyEmpty) {
    confidence -= 0.1;
  }
  if (!signals.request.prompt_risk) {
    confidence -= 0.08;
  }
  if (!signals.productionEvents.length) {
    confidence -= 0.08;
  }
  confidence = Math.max(0.2, Math.min(1, Math.round(confidence * 100) / 100));
  const sorted = [...factors].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const recommendations = buildRecommendations(sorted, {
    services,
    symbols: signals.impact?.affected_symbols ?? signals.request.symbols ?? [],
    adrs: signals.impact?.affected_adrs ?? [],
    level: risk_level,
  });
  const evidence_refs = [...new Set(sorted.flatMap((f) => f.evidence_refs))];
  return {
    risk_score,
    risk_level,
    confidence,
    factors: sorted,
    recommendations,
    evidence_refs,
  };
}
