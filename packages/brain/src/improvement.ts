/**
 * Policy versioning, experiments, evaluation, promote / reject / rollback.
 * Evidence required — never declare improvement without metrics.
 */

import type { BrainStore } from './store.js';
import type {
  AutonomyLevel,
  BrainExperiment,
  BrainPolicy,
  ExperimentDecision,
} from './types.js';

export class ImprovementManager {
  constructor(private store: BrainStore) {}

  proposePolicy(input: {
    kind: string;
    version: string;
    payload: Record<string, unknown>;
    autonomyLevel: AutonomyLevel;
  }): BrainPolicy {
    return this.store.upsertPolicy({
      kind: input.kind,
      version: input.version,
      payload: input.payload,
      status: 'experimental',
      autonomyLevel: input.autonomyLevel,
    });
  }

  startExperiment(input: {
    name: string;
    policyKind: string;
    candidatePolicyId: string;
    baselinePolicyId?: string;
    hypothesisId?: string;
    evaluationSet?: string;
    baselineMetrics?: Record<string, number>;
    metricsMeta?: Record<string, { higherIsBetter: boolean }>;
  }): BrainExperiment {
    const baseline = input.baselinePolicyId ?? this.store.currentPolicy(input.policyKind)?.id;
    return this.store.upsertExperiment({
      name: input.name,
      policyKind: input.policyKind,
      baselinePolicyId: baseline,
      candidatePolicyId: input.candidatePolicyId,
      hypothesisId: input.hypothesisId,
      evaluationSet: input.evaluationSet ?? 'default',
      baselineMetrics: input.baselineMetrics ?? {},
      candidateMetrics: {},
      metricsMeta: input.metricsMeta ?? {
        retrievalRelevance: { higherIsBetter: true },
        duplication: { higherIsBetter: false },
        insightAcceptance: { higherIsBetter: true },
      },
      status: 'running',
      decision: 'pending',
    });
  }

  recordEvaluation(experimentId: string, label: 'baseline' | 'candidate' | string, metrics: Record<string, number>, notes?: string): void {
    const exp = this.store.getExperiment(experimentId);
    if (!exp) {
      throw new Error('experiment not found');
    }
    this.store.addEvaluation({ experimentId, label, metrics, notes });
    if (label === 'baseline') {
      this.store.upsertExperiment({ ...exp, baselineMetrics: metrics, status: 'running' });
    } else if (label === 'candidate') {
      this.store.upsertExperiment({ ...exp, candidateMetrics: metrics, status: 'running' });
    }
  }

  /**
   * Compare candidate vs baseline. Promote only when majority of metrics improve
   * (respecting higherIsBetter). Otherwise reject.
   */
  decide(experimentId: string): { decision: ExperimentDecision; experiment: BrainExperiment; summary: string } {
    const exp = this.store.getExperiment(experimentId);
    if (!exp) {
      throw new Error('experiment not found');
    }
    const meta = exp.metricsMeta ?? {};
    const keys = new Set([...Object.keys(exp.baselineMetrics), ...Object.keys(exp.candidateMetrics)]);
    let wins = 0;
    let losses = 0;
    const notes: string[] = [];
    for (const k of keys) {
      const base = exp.baselineMetrics[k] ?? 0;
      const cand = exp.candidateMetrics[k] ?? 0;
      const higher = meta[k]?.higherIsBetter ?? true;
      const improved = higher ? cand > base : cand < base;
      const worsened = higher ? cand < base : cand > base;
      if (improved) {
        wins++;
        notes.push(`${k}: ${base} → ${cand} (better)`);
      } else if (worsened) {
        losses++;
        notes.push(`${k}: ${base} → ${cand} (worse)`);
      } else {
        notes.push(`${k}: unchanged`);
      }
    }
    if (wins > losses && wins > 0) {
      return this.promote(experimentId, notes.join('; '));
    }
    return this.reject(experimentId, notes.join('; ') || 'no measurable improvement');
  }

  promote(experimentId: string, summary?: string): { decision: ExperimentDecision; experiment: BrainExperiment; summary: string } {
    const exp = this.store.getExperiment(experimentId);
    if (!exp) {
      throw new Error('experiment not found');
    }
    const candidate = this.store.getPolicy(exp.candidatePolicyId);
    if (!candidate) {
      throw new Error('candidate policy missing');
    }
    // Demote current → previous
    const current = this.store.currentPolicy(exp.policyKind);
    if (current) {
      this.store.upsertPolicy({ ...current, status: 'previous' });
    }
    this.store.upsertPolicy({ ...candidate, status: 'current' });
    const updated = this.store.upsertExperiment({
      ...exp,
      status: 'completed',
      decision: 'promoted',
      summary: summary ?? 'candidate outperformed baseline',
      finishedAt: Date.now(),
    });
    this.store.addEpisode({
      kind: 'experiment',
      summary: `Promoted policy ${exp.policyKind} ${candidate.version}: ${updated.summary}`,
      outcome: 'success',
      intention: 'self-improvement',
      action: 'promote',
      result: updated.summary,
      lesson: 'Keep only evidence-backed policy changes',
      entityIds: [],
      occurredAt: Date.now(),
    });
    this.store.addActivity({
      ts: Date.now(),
      kind: 'policy_promoted',
      message: `Promoted ${exp.policyKind} → ${candidate.version}`,
      refs: [exp.id, candidate.id],
    });
    return { decision: 'promoted', experiment: updated, summary: updated.summary ?? '' };
  }

  reject(experimentId: string, summary?: string): { decision: ExperimentDecision; experiment: BrainExperiment; summary: string } {
    const exp = this.store.getExperiment(experimentId);
    if (!exp) {
      throw new Error('experiment not found');
    }
    const candidate = this.store.getPolicy(exp.candidatePolicyId);
    if (candidate) {
      this.store.upsertPolicy({ ...candidate, status: 'rejected' });
    }
    const updated = this.store.upsertExperiment({
      ...exp,
      status: 'completed',
      decision: 'rejected',
      summary: summary ?? 'candidate did not beat baseline',
      finishedAt: Date.now(),
    });
    this.store.addEpisode({
      kind: 'experiment',
      summary: `Rejected policy experiment ${exp.name}: ${updated.summary}`,
      outcome: 'failure',
      intention: 'self-improvement',
      action: 'reject',
      result: updated.summary,
      lesson: 'Do not promote without evidence',
      entityIds: [],
      occurredAt: Date.now(),
    });
    this.store.addActivity({
      ts: Date.now(),
      kind: 'policy_rejected',
      message: `Rejected experiment ${exp.name}`,
      refs: [exp.id],
    });
    return { decision: 'rejected', experiment: updated, summary: updated.summary ?? '' };
  }

  rollback(policyKind: string): BrainPolicy | undefined {
    const policies = this.store.listPolicies(policyKind, 20);
    const current = policies.find((p) => p.status === 'current');
    const previous = policies.find((p) => p.status === 'previous');
    if (!previous) {
      return undefined;
    }
    if (current) {
      this.store.upsertPolicy({ ...current, status: 'archived' });
    }
    const restored = this.store.upsertPolicy({ ...previous, status: 'current' });
    this.store.addActivity({
      ts: Date.now(),
      kind: 'policy_rollback',
      message: `Rolled back ${policyKind} to ${previous.version}`,
      refs: [previous.id],
    });
    this.store.addEpisode({
      kind: 'experiment',
      summary: `Rolled back ${policyKind} to ${previous.version}`,
      outcome: 'neutral',
      action: 'rollback',
      entityIds: [],
      occurredAt: Date.now(),
    });
    return restored;
  }

  /** Lightweight local metrics for retrieval/graph health (no LLM). */
  collectBaselineMetrics(): Record<string, number> {
    const entities = this.store.countEntities();
    const insights = this.store.listInsights(100);
    const accepted = insights.filter((i) => i.status === 'accepted' || i.status === 'implemented' || i.status === 'verified').length;
    const rejected = insights.filter((i) => i.status === 'rejected' || i.status === 'dismissed').length;
    const acceptance = insights.length ? accepted / insights.length : 0.5;
    const rejection = insights.length ? rejected / insights.length : 0;
    // Rough duplication proxy: entities / unique labels already deduped, use inverse degree noise.
    const top = this.store.topEntities(50);
    const avgDegree = top.length ? top.reduce((s, e) => s + e.degree, 0) / top.length : 0;
    const duplication = Math.min(1, avgDegree / 40);
    return {
      retrievalRelevance: Math.min(1, 0.5 + acceptance * 0.4),
      duplication,
      insightAcceptance: acceptance,
      insightRejection: rejection,
      entityCount: entities,
    };
  }
}
