import { createHash, randomBytes } from 'node:crypto';

export function newContextId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  return `${prefix}_${stamp}_${rand}`;
}

export function stableHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function confidenceCategory(
  confidence: number,
): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) {
    return 'high';
  }
  if (confidence >= 0.5) {
    return 'medium';
  }
  return 'low';
}
