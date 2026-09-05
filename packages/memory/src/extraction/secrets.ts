import { containsLikelySecret, redactSecrets as baseRedact } from '@singularity/context';

const EXTRA: Array<{ name: string; re: RegExp }> = [
  {
    name: 'cookie',
    re: /\b(?:session[_-]?id|sessionid|connect\.sid)\s*[:=]\s*['"]?[A-Za-z0-9._\-]+['"]?/gi,
  },
  {
    name: 'pem',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
];

export function redactSecrets(text: string): string {
  let out = baseRedact(text);
  for (const p of EXTRA) {
    out = out.replace(p.re, `[REDACTED:${p.name}]`);
  }
  return out;
}

export function shouldRedact(text: string): boolean {
  if (containsLikelySecret(text)) {
    return true;
  }
  return EXTRA.some((p) => {
    p.re.lastIndex = 0;
    return p.re.test(text);
  });
}
