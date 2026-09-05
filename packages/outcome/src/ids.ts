import { createHash } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function requirementVersionHash(input: {
  description: string;
  type: string;
  acceptance: string[];
}): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 16);
}

export function paddedReqId(n: number): string {
  return `REQ-${String(n).padStart(3, '0')}`;
}

export function paddedAcId(reqId: string, n: number): string {
  return `AC-${reqId.replace(/^REQ-/, '')}-${String(n).padStart(2, '0')}`;
}
