import { createHash } from 'node:crypto';
import { RISK_ASSESSMENT_VERSION, type PromptRiskInput, type RiskAssessmentRequest } from './types.js';

function normList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((v) => v.replace(/\\/g, '/').trim()).filter(Boolean))].sort();
}

function promptDigest(p?: PromptRiskInput): Record<string, unknown> {
  if (!p) {
    return {};
  }
  return {
    predicted_success: p.predicted_success ?? null,
    predicted_regeneration: p.predicted_regeneration ?? null,
    passed: p.passed ?? null,
  };
}

export function riskFingerprint(
  req: RiskAssessmentRequest,
  architectureVersion: number,
  assessmentVersion = RISK_ASSESSMENT_VERSION,
): string {
  const payload = JSON.stringify({
    v: assessmentVersion,
    architecture_version: architectureVersion,
    mission_id: req.mission_id ?? '',
    repository: req.repository ?? '',
    commit_id: req.commit_id ?? '',
    files: normList(req.affected_files),
    symbols: normList(req.symbols?.map((s) => s.toLowerCase())),
    services: normList(req.services?.map((s) => s.toLowerCase())),
    change: (req.change ?? '').trim().toLowerCase(),
    prompt_risk: promptDigest(req.prompt_risk),
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function derivedMissionId(fingerprint: string): string {
  return `msn_${fingerprint.slice(0, 16)}`;
}
