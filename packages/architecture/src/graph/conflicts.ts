import { nowIso } from '../domain/adr/schema.js';
import { isActiveStatus } from '../domain/adr/lifecycle.js';
import type { Adr } from '../domain/adr/schema.js';
import type { StoredConflict } from '../memory/decisionStore.js';
import type { GraphBackend } from './backend.js';
import { edgeId, nodeId } from './types.js';
import { adrsAffectingFile } from './builder.js';

const REPLACE_RE =
  /\b(?:replace|switch(?:ing)?(?:\s+from)?|migrate(?:ing)?(?:\s+from)?|swap)\s+([a-z0-9.+#-]+)\s+(?:with|to|for)\s+([a-z0-9.+#-]+)/gi;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.+#-]+/g, ' ').trim();
}

function mentions(hay: string, needle: string): boolean {
  const n = norm(needle);
  if (n.length < 3) {
    return false;
  }
  return norm(hay).includes(n);
}

export interface ConflictInput {
  project_id: string;
  change: string;
  affected_files?: string[];
  adrs: Adr[];
  graph?: GraphBackend;
}

/**
 * Detect proposed changes that violate active ADRs (rejected alternatives, hard constraints).
 * Intelligence plane / explicit API only.
 */
export function detectConflicts(input: ConflictInput): StoredConflict[] {
  const out: StoredConflict[] = [];
  const change = input.change;
  const relatedIds = new Set<string>();
  for (const f of input.affected_files ?? []) {
    if (input.graph) {
      for (const id of adrsAffectingFile(input.graph, f)) {
        relatedIds.add(id);
      }
    }
  }

  const active = input.adrs.filter(
    (a) => a.record_kind !== 'observation' && isActiveStatus(a.status),
  );

  for (const adr of active) {
    const scoped =
      relatedIds.size === 0 ||
      relatedIds.has(adr.id) ||
      adr.affected_components.some((c) => mentions(change, c)) ||
      (input.affected_files ?? []).some((f) =>
        adr.evidence.code.some((e) => f.includes(e.id) || e.id.includes(f)),
      );
    if (!scoped && relatedIds.size > 0 && !(input.affected_files ?? []).length) {
      continue;
    }

    let m: RegExpExecArray | null;
    const re = new RegExp(REPLACE_RE.source, 'gi');
    while ((m = re.exec(change))) {
      const from = m[1]!;
      const to = m[2]!;
      const choseFrom =
        mentions(adr.decision.summary, from) || mentions(adr.title, from);
      const rejectedTo = adr.alternatives.some(
        (a) => a.status === 'rejected' && mentions(a.name, to),
      );
      if (choseFrom && rejectedTo) {
        out.push({
          id: `cfl_${adr.id}_${norm(to).replace(/\s/g, '_')}`,
          project_id: input.project_id,
          adr_id: adr.id,
          severity: 'high',
          reason: `Proposed change replaces ${from} with ${to}, but ${adr.id} rejected ${to}.`,
          created_at: nowIso(),
        });
      }
      if (choseFrom && !rejectedTo && mentions(adr.decision.summary, from)) {
        out.push({
          id: `cfl_${adr.id}_replace_${norm(from)}`,
          project_id: input.project_id,
          adr_id: adr.id,
          severity: 'medium',
          reason: `Proposed change replaces ${from}, which ${adr.id} selected.`,
          created_at: nowIso(),
        });
      }
    }

    for (const constraint of adr.constraints) {
      const must = /\b(must|required|require|cannot|can't|do not|don't)\b/i.test(constraint);
      if (!must) {
        continue;
      }
      const forbidden = constraint.match(/\b(?:not|don't|do not|cannot)\s+use\s+([a-z0-9.+#-]+)/i);
      if (forbidden?.[1] && mentions(change, `use ${forbidden[1]}`)) {
        out.push({
          id: `cfl_${adr.id}_constraint`,
          project_id: input.project_id,
          adr_id: adr.id,
          severity: 'high',
          reason: `Change conflicts with constraint on ${adr.id}: ${constraint}`,
          created_at: nowIso(),
        });
      }
    }
  }

  // Pairwise: two active ADRs on the same component with opposing tech
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]!;
      const b = active[j]!;
      const overlap = a.affected_components.filter((c) =>
        b.affected_components.some((d) => norm(c) === norm(d)),
      );
      if (!overlap.length) {
        continue;
      }
      const aRejectsB = a.alternatives.some(
        (alt) => alt.status === 'rejected' && mentions(b.decision.summary, alt.name),
      );
      if (aRejectsB) {
        out.push({
          id: `cfl_pair_${a.id}_${b.id}`,
          project_id: input.project_id,
          adr_id: a.id,
          severity: 'high',
          reason: `${a.id} rejected an alternative that ${b.id} selected (shared: ${overlap.join(', ')}).`,
          created_at: nowIso(),
        });
        if (input.graph) {
          input.graph.upsertEdges([
            {
              id: edgeId(nodeId('ADR', a.id), 'CONFLICTS_WITH', nodeId('ADR', b.id)),
              from: nodeId('ADR', a.id),
              to: nodeId('ADR', b.id),
              kind: 'CONFLICTS_WITH',
            },
          ]);
        }
      }
    }
  }

  return dedupe(out);
}

function dedupe(rows: StoredConflict[]): StoredConflict[] {
  const seen = new Set<string>();
  const out: StoredConflict[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) {
      continue;
    }
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
