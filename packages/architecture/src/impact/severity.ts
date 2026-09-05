import type { ImpactRecommendation, ImpactSeverity } from './types.js';

export interface ImpactEvidence {
  symbolCount: number;
  fileCount: number;
  serviceCount: number;
  packageCount: number;
  adrCount: number;
  constraintCount: number;
  conflictCount: number;
  driftCount: number;
  testCount: number;
  publicApi: boolean;
  crossService: boolean;
  codePartial: boolean;
}

export function scoreImpact(ev: ImpactEvidence): {
  severity: ImpactSeverity;
  recommendation: ImpactRecommendation;
  reasons: string[];
  confidence: number;
} {
  const reasons: string[] = [];
  if (ev.symbolCount) {
    reasons.push(`${ev.symbolCount} symbol${ev.symbolCount === 1 ? '' : 's'} in the blast radius`);
  }
  if (ev.serviceCount) {
    reasons.push(
      `${ev.serviceCount} service${ev.serviceCount === 1 ? '' : 's'} depend on the modified surface`,
    );
  }
  if (ev.adrCount) {
    reasons.push(`${ev.adrCount} ADR${ev.adrCount === 1 ? '' : 's'} constrain this change`);
  }
  if (ev.constraintCount) {
    reasons.push(`${ev.constraintCount} architectural constraint${ev.constraintCount === 1 ? '' : 's'} apply`);
  }
  if (ev.conflictCount) {
    reasons.push(`${ev.conflictCount} unresolved conflict${ev.conflictCount === 1 ? '' : 's'}`);
  }
  if (ev.driftCount) {
    reasons.push(`${ev.driftCount} architectural drift${ev.driftCount === 1 ? '' : 's'} detected`);
  }
  if (ev.publicApi) {
    reasons.push('1 public API surface is affected');
  }
  if (ev.crossService) {
    reasons.push('change crosses a service boundary');
  }
  if (ev.testCount) {
    reasons.push(`${ev.testCount} related test${ev.testCount === 1 ? '' : 's'} identified`);
  } else if (ev.symbolCount >= 3) {
    reasons.push('no related tests were identified');
  }
  if (ev.codePartial) {
    reasons.push('code-graph analysis was partial or unavailable');
  }
  if (!reasons.length) {
    reasons.push('no active architecture decisions or code-graph neighbors matched this change');
  }

  const violation = ev.conflictCount > 0 || ev.driftCount > 0;
  let severity: ImpactSeverity = 'low';
  if ((violation && (ev.crossService || ev.publicApi)) || ev.conflictCount >= 2) {
    severity = 'critical';
  } else if (violation || ev.crossService || ev.publicApi || ev.serviceCount >= 2) {
    severity = 'high';
  } else if (
    ev.symbolCount >= 20 ||
    (ev.serviceCount === 1 && ev.constraintCount > 0) ||
    (ev.testCount === 0 && ev.symbolCount >= 5) ||
    ev.adrCount > 0
  ) {
    severity = 'medium';
  }

  let recommendation: ImpactRecommendation = 'SAFE_TO_PROCEED';
  if (severity === 'critical' && ev.conflictCount > 0) {
    recommendation = 'DO_NOT_PROCEED';
  } else if (severity === 'critical' || (severity === 'high' && violation)) {
    recommendation = 'ARCHITECTURE_REVIEW_REQUIRED';
  } else if (severity === 'high') {
    recommendation = 'REVIEW_REQUIRED';
  } else if (severity === 'medium' || ev.testCount === 0 && ev.symbolCount >= 3) {
    recommendation = 'PROCEED_WITH_TESTS';
  }

  let confidence = 0.86;
  if (ev.codePartial) {
    confidence -= 0.25;
  }
  if (!ev.symbolCount && !ev.fileCount) {
    confidence -= 0.15;
  }
  if (ev.adrCount || ev.serviceCount) {
    confidence += 0.05;
  }
  confidence = Math.min(0.99, Math.max(0.2, Number(confidence.toFixed(2))));

  return { severity, recommendation, reasons, confidence };
}
