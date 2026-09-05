import { redactSecrets } from '@singularity/context';

const ENV_KEYS =
  /\b(TOKEN|SECRET|PASSWORD|API[_-]?KEY|AUTHORIZATION|BEARER|CREDENTIAL)\b/gi;

export function sanitizeEvidenceText(text: string): string {
  let out = redactSecrets(text);
  out = out.replace(
    /(authorization|api[-_]?key|x-api-key)\s*[:=]\s*\S+/gi,
    '$1: [REDACTED]',
  );
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]');
  return out;
}

export function sanitizeEnvRecord(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!v) {
      continue;
    }
    ENV_KEYS.lastIndex = 0;
    out[k] = ENV_KEYS.test(k) ? '[REDACTED]' : sanitizeEvidenceText(v);
  }
  return out;
}
