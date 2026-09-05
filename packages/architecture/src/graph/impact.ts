import { isActiveStatus } from '../domain/adr/lifecycle.js';
import type { Adr } from '../domain/adr/schema.js';
import type { GraphBackend } from './backend.js';
import { adrsAffectingFile, servicesForAdr } from './builder.js';

export interface ImpactResult {
  affected_decisions: string[];
  affected_services: string[];
  constraints: string[];
  risks: string[];
  conflicts: string[];
  drifts: string[];
  severity: 'low' | 'medium' | 'high';
  recommendation: string;
}

export function graphImpact(opts: {
  change?: string;
  affected_files?: string[];
  adrs: Adr[];
  graph?: GraphBackend;
  conflictIds?: string[];
  driftIds?: string[];
}): ImpactResult {
  const files = opts.affected_files ?? [];
  const q = `${opts.change ?? ''} ${files.join(' ')}`.toLowerCase();
  const ids = new Set<string>();
  if (opts.graph) {
    for (const f of files) {
      for (const id of adrsAffectingFile(opts.graph, f)) {
        ids.add(id);
      }
    }
  }
  const hit = opts.adrs.filter((a) => {
    if (a.record_kind === 'observation') {
      return false;
    }
    if (ids.has(a.id)) {
      return true;
    }
    if (!isActiveStatus(a.status) && !ids.has(a.id)) {
      return false;
    }
    return (
      files.some((f) => a.evidence.code.some((e) => e.id.includes(f) || f.includes(e.id))) ||
      a.affected_components.some((c) => q.includes(c.toLowerCase())) ||
      q.includes(a.decision.summary.toLowerCase().slice(0, 24))
    );
  });
  const services = new Set<string>();
  for (const a of hit) {
    for (const s of a.affected_components) {
      services.add(s);
    }
    if (opts.graph) {
      for (const s of servicesForAdr(opts.graph, a.id)) {
        services.add(s);
      }
    }
  }
  const conflicts = opts.conflictIds ?? [];
  const drifts = opts.driftIds ?? [];
  const severity: ImpactResult['severity'] =
    conflicts.length || drifts.length ? 'high' : hit.some((a) => a.risks.length) ? 'medium' : 'low';
  const rec =
    conflicts.length || drifts.length
      ? `Review ${[...new Set([...conflicts, ...drifts])].slice(0, 4).join(', ')} before proceeding.`
      : hit.length
        ? `Change touches ${hit.map((a) => a.id).join(', ')}. Constraints: ${[...new Set(hit.flatMap((a) => a.constraints))].slice(0, 3).join('; ') || 'none listed'}.`
        : 'No active architecture decisions matched this change.';
  return {
    affected_decisions: hit.map((a) => a.id),
    affected_services: [...services],
    constraints: [...new Set(hit.flatMap((a) => a.constraints))],
    risks: [...new Set(hit.flatMap((a) => a.risks))],
    conflicts,
    drifts,
    severity,
    recommendation: rec,
  };
}
