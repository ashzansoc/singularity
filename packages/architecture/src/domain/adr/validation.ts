import { transitionAdr } from './lifecycle.js';
import type { Adr } from './schema.js';
import type { StoredDrift } from '../../memory/decisionStore.js';

export interface ValidationResult {
  adr: Adr;
  status: 'pending' | 'passed' | 'failed' | 'skipped';
  notes: string;
}

/**
 * Deep validation: evidence + drift, not a rubber stamp.
 */
export function validateAdrDeep(adr: Adr, drifts: StoredDrift[]): ValidationResult {
  if (adr.status === 'rejected' || adr.status === 'superseded' || adr.status === 'deprecated') {
    return { adr, status: 'skipped', notes: `ADR is ${adr.status}` };
  }
  const mine = drifts.filter((d) => d.adr_id === adr.id);
  const high = mine.filter((d) => d.severity === 'high');
  const failedEvidence = [
    ...(adr.evidence.deployments ?? []),
    ...(adr.evidence.tests ?? []),
  ].filter((e) => e.relationship === 'contradicts');
  const incidents = adr.evidence.incidents ?? [];

  if (high.length) {
    const notes = high.map((d) => d.reason).join('; ');
    return {
      adr: { ...adr, validation: { status: 'failed', notes } },
      status: 'failed',
      notes,
    };
  }
  if (failedEvidence.length || incidents.length >= 2) {
    const notes = incidents.length
      ? `${incidents.length} production incident(s) attached`
      : 'failing tests or deployments contradict this decision';
    return {
      adr: { ...adr, validation: { status: 'failed', notes } },
      status: 'failed',
      notes,
    };
  }

  const hasImpl =
    adr.evidence.commits.length > 0 ||
    adr.evidence.pull_requests.length > 0 ||
    adr.evidence.code.length > 0;
  const hasRuntime =
    (adr.evidence.tests ?? []).some((t) => t.relationship === 'supports') ||
    (adr.evidence.deployments ?? []).some((d) => d.relationship === 'supports');

  if (!hasImpl && adr.status === 'proposed') {
    return {
      adr: { ...adr, validation: { status: 'pending', notes: 'No implementation evidence yet' } },
      status: 'pending',
      notes: 'No implementation evidence yet',
    };
  }

  const notes = hasRuntime
    ? 'Implementation and runtime evidence support this decision; no high-severity drift.'
    : 'Implementation evidence present; no high-severity drift.';
  let next: Adr = { ...adr, validation: { status: 'passed', notes } };
  if (next.status === 'implemented') {
    try {
      next = { ...transitionAdr(next, 'validated'), validation: next.validation };
    } catch {
      /* keep implemented + passed validation */
    }
  }
  return { adr: next, status: 'passed', notes };
}
