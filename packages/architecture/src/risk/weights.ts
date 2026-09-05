import type { ArchitectureFlags } from '../flags.js';
import { RISK_ASSESSMENT_VERSION, type RiskFactorType } from './types.js';

export { RISK_ASSESSMENT_VERSION };

export type RiskWeights = Record<
  Extract<
    RiskFactorType,
    'change_blast_radius' | 'architecture' | 'production' | 'historical' | 'verification' | 'complexity' | 'prompt'
  >,
  number
>;

export const DEFAULT_RISK_WEIGHTS: RiskWeights = {
  change_blast_radius: 0.22,
  architecture: 0.22,
  production: 0.16,
  historical: 0.1,
  verification: 0.12,
  complexity: 0.1,
  prompt: 0.08,
};

export const MITIGATION_TESTS = -4;
export const MITIGATION_RECENT_DEPLOY = -2;

export function riskLevelFromScore(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score >= 75) {
    return 'CRITICAL';
  }
  if (score >= 50) {
    return 'HIGH';
  }
  if (score >= 25) {
    return 'MEDIUM';
  }
  return 'LOW';
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function resolveRiskWeights(flags?: ArchitectureFlags): RiskWeights {
  const over = flags?.mission_risk_weights;
  if (!over) {
    return { ...DEFAULT_RISK_WEIGHTS };
  }
  return { ...DEFAULT_RISK_WEIGHTS, ...over };
}
