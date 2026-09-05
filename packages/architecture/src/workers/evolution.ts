import { nowIso, parseAdr, type Adr } from '../domain/adr/schema.js';
import { isActiveStatus } from '../domain/adr/lifecycle.js';
import type { DecisionStore, StoredDrift, StoredEvolution } from '../memory/decisionStore.js';

/**
 * Propose a candidate ADR when reality has diverged. Never auto-supersedes.
 */
export function proposeEvolution(opts: {
  store: DecisionStore;
  project_id: string;
  adrs: Adr[];
  drifts: StoredDrift[];
  trigger?: StoredEvolution['trigger'];
}): StoredEvolution[] {
  const created: StoredEvolution[] = [];
  const existing = opts.store.listEvolutions(opts.project_id);
  const trigger = opts.trigger ?? 'drift';

  for (const adr of opts.adrs) {
    if (!isActiveStatus(adr.status) || adr.record_kind === 'observation') {
      continue;
    }
    if (existing.some((e) => e.old_adr_id === adr.id)) {
      continue;
    }
    const high = opts.drifts.filter((d) => d.adr_id === adr.id && d.severity === 'high');
    const incidents = adr.evidence.incidents ?? [];
    const failedDeploys = (adr.evidence.deployments ?? []).filter((d) => d.relationship === 'contradicts');
    const should =
      high.length > 0 ||
      (trigger === 'incident' && incidents.length > 0) ||
      (trigger === 'deployment_failure' && failedDeploys.length > 0) ||
      (trigger === 'validation' && adr.validation.status === 'failed');
    if (!should) {
      continue;
    }
    const reason =
      high[0]?.reason ??
      (incidents.length ? `${incidents.length} incident(s) against ${adr.id}` : `${adr.id} failed validation`);
    const id = opts.store.nextAdrId(opts.project_id);
    const ts = nowIso();
    const candidate = parseAdr({
      id,
      project_id: opts.project_id,
      title: `Revise ${adr.id}: ${adr.title}`,
      status: 'proposed',
      record_kind: 'candidate',
      problem: reason,
      decision: {
        summary: `Revisit ${adr.id} (${adr.decision.summary}). Observed drift or production evidence no longer matches the declared decision.`,
      },
      reasoning: [reason, 'Proposed automatically; requires human review before supersession.'],
      affected_components: adr.affected_components,
      relationships: { supersedes: adr.id, related: [adr.id] },
      confidence: 0.55,
      timestamps: { created_at: ts, updated_at: ts },
      provenance: [{ type: 'system', project_id: opts.project_id, excerpt: reason }],
    });
    opts.store.insert(candidate);
    const evo: StoredEvolution = {
      id: `evo_${adr.id}_${id}`,
      project_id: opts.project_id,
      old_adr_id: adr.id,
      proposed_adr_id: id,
      reason,
      trigger: high.length ? 'drift' : trigger,
      created_at: ts,
    };
    opts.store.insertEvolution(evo);
    created.push(evo);
  }
  return created;
}
