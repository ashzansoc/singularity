import { createHash } from 'node:crypto';
import { REVIEW_POLICY_VERSION } from './defaults.js';

export function reviewFingerprint(input: {
  mission_id: string;
  code_revision?: string;
  architecture_version?: string | number;
  evidence_watermark?: string;
  policy_version?: number;
  requirement_hash?: string;
}): string {
  const payload = JSON.stringify({
    mission_id: input.mission_id,
    code_revision: input.code_revision ?? '',
    architecture_version: String(input.architecture_version ?? ''),
    evidence_watermark: input.evidence_watermark ?? '',
    policy_version: input.policy_version ?? REVIEW_POLICY_VERSION,
    requirement_hash: input.requirement_hash ?? '',
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function requirementContentHash(
  reqs: Array<{ id: string; requirement_version_hash: string; status: string }>,
): string {
  const payload = reqs
    .map((r) => `${r.id}:${r.requirement_version_hash}:${r.status}`)
    .sort()
    .join('|');
  return createHash('sha256').update(payload).digest('hex').slice(0, 24);
}
