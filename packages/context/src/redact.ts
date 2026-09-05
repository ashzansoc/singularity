/**
 * Redact secrets before persisting extracted context.
 */

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  {
    name: 'api_key',
    re: /\b(?:api[_-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}['"]?/gi,
  },
  {
    name: 'bearer',
    re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  },
  {
    name: 'password',
    re: /\b(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{4,}['"]?/gi,
  },
  {
    name: 'private_key',
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: 'aws_key',
    re: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: 'token',
    re: /\b(?:access[_-]?token|refresh[_-]?token|secret[_-]?token|auth[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9\-._~+/]+=*['"]?/gi,
  },
  {
    name: 'sk_live',
    re: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  },
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const p of SECRET_PATTERNS) {
    out = out.replace(p.re, `[REDACTED:${p.name}]`);
  }
  return out;
}

export function containsLikelySecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => {
    p.re.lastIndex = 0;
    return p.re.test(text);
  });
}
