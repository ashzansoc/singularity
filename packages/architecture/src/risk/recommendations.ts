import type { RiskAssessment, RiskFactor, RiskRecommendation } from './types.js';

export function buildRecommendations(
  factors: RiskFactor[],
  ctx: {
    services: string[];
    symbols: string[];
    adrs: string[];
    level: RiskAssessment['risk_level'];
  },
): RiskRecommendation[] {
  const recs: RiskRecommendation[] = [];
  const byType = new Map(factors.map((f) => [f.type, f]));
  const arch = byType.get('architecture');
  const blast = byType.get('change_blast_radius');
  const prod = byType.get('production');
  const ver = byType.get('verification');
  const adr = factors.find((f) => f.type === 'adr_documented_risk');
  const svc = ctx.services[0] ?? 'affected service';
  const sym = ctx.symbols[0] ?? 'affected symbol';
  const adrId = ctx.adrs[0] ?? adr?.evidence_refs[0]?.replace(/^adr:/, '') ?? 'ADR';

  if (arch && arch.score >= 50 && arch.evidence_refs.some((r) => r.startsWith('conflict:'))) {
    recs.push({
      text: `Resolve ${adrId} conflict before execution.`,
      factor_types: ['architecture', 'adr_documented_risk'],
      evidence_refs: arch.evidence_refs.slice(0, 6),
    });
  }
  if (arch && arch.evidence_refs.some((r) => r.startsWith('drift:')) && arch.score >= 25) {
    recs.push({
      text: `Review architecture drift in ${svc}.`,
      factor_types: ['architecture'],
      evidence_refs: arch.evidence_refs.filter((r) => r.startsWith('drift:')),
    });
  }
  if (prod && prod.score >= 40) {
    recs.push({
      text: `Run expanded integration verification for ${svc}.`,
      factor_types: ['production'],
      evidence_refs: prod.evidence_refs.slice(0, 6),
    });
  }
  if (ver && ver.score >= 40) {
    recs.push({
      text: `Add verification coverage for ${sym}.`,
      factor_types: ['verification', 'change_blast_radius'],
      evidence_refs: ver.evidence_refs.length ? ver.evidence_refs : blast?.evidence_refs ?? [],
    });
  }
  if (blast && blast.score >= 65 && !recs.some((r) => r.factor_types.includes('change_blast_radius'))) {
    recs.push({
      text: `Review blast radius across ${ctx.services.length || 1} service(s) before execution.`,
      factor_types: ['change_blast_radius'],
      evidence_refs: blast.evidence_refs,
    });
  }
  if (ctx.level === 'LOW' && recs.length === 0) {
    recs.push({
      text: 'No additional safeguards required.',
      factor_types: [],
      evidence_refs: [],
    });
  }
  if (ctx.level === 'CRITICAL' && !recs.length) {
    recs.push({
      text: 'Do not proceed until architecture and production risks are reviewed.',
      factor_types: factors.filter((f) => f.contribution > 0).map((f) => f.type),
      evidence_refs: factors.flatMap((f) => f.evidence_refs).slice(0, 8),
    });
  }
  return recs;
}
