import type { ArchitectureSubsystem } from '@singularity/architecture';
import { readArchitectureVersion } from '@singularity/architecture';
import type { ArchitectureReviewPort, OutcomeSubsystem, ReviewEvidenceItem } from '@singularity/outcome';

const wired = new WeakSet<OutcomeSubsystem>();

function refs(
  kind: string,
  nodes: Array<{ id: string; label?: string }>,
): ReviewEvidenceItem[] {
  return nodes.map((n) => ({
    kind,
    id: n.id,
    label: n.label ?? n.id,
    provenance: n.id,
  }));
}

export function createArchitectureReviewPort(arch: ArchitectureSubsystem): ArchitectureReviewPort {
  return {
    collectSignals(input) {
      const graph = arch.archGraph;
      const commits = refs('commit', graph.listNodes('Commit'));
      const prs = refs('pull_request', graph.listNodes('PullRequest'));
      const tests = refs(
        'test',
        [...graph.listNodes('Test'), ...graph.listNodes('TestExecution')],
      );
      const deployments = refs('deployment', graph.listNodes('Deployment'));
      const incidents = refs('incident', graph.listNodes('Incident'));
      const adrs = arch.store.list({ project_id: arch.projectId });
      const proposed_adrs = refs(
        'adr',
        adrs.filter((a) => a.status === 'proposed').map((a) => ({ id: a.id, label: a.decision.summary })),
      );
      const adrItems = refs(
        'adr',
        adrs.map((a) => ({ id: a.id, label: `${a.status}: ${a.decision.summary}` })),
      );
      const conflicts = refs(
        'conflict',
        arch.store.listConflicts(arch.projectId).map((c) => ({ id: c.id, label: c.reason })),
      );
      const impacts = arch.listImpacts(5);
      const latest = impacts[0];
      const risks = arch.store.listRiskByMission(arch.projectId, input.mission_id, 3);
      const risk = risks[0];
      let risk_level: string | undefined;
      let risk_score: number | undefined;
      if (risk?.result_json) {
        try {
          const parsed = JSON.parse(risk.result_json) as { risk_level?: string; risk_score?: number };
          risk_level = parsed.risk_level;
          risk_score = parsed.risk_score;
        } catch {
          /* ignore */
        }
      }
      const prod = arch.store.listProductionEvents(arch.projectId, 30);
      const affects_production = prod.some((p) => /DEPLOYMENT|INCIDENT/i.test(p.event_type));
      const watermark = [
        String(commits.length),
        String(incidents.length),
        String(proposed_adrs.length),
        latest?.fingerprint ?? '',
      ].join(':');
      return {
        architecture_version: readArchitectureVersion(arch.store, arch.projectId),
        evidence_watermark: watermark,
        risk_level,
        risk_score,
        architecture_impact: latest?.severity,
        impact_recommendation: latest?.recommendation,
        affects_production,
        affected_services: latest?.affected_services ?? [],
        proposed_adrs,
        commits,
        prs,
        tests,
        deployments,
        incidents,
        adrs: adrItems,
        architecture_changes: refs('file', graph.listNodes('File')).slice(0, 40),
        conflicts,
        risk_refs: risks.map((r) => `risk:${r.assessment_id}`),
      };
    },
  };
}

export function wireArchitectureGovernance(
  architecture: ArchitectureSubsystem,
  outcome: OutcomeSubsystem,
): void {
  if (wired.has(outcome)) {
    return;
  }
  wired.add(outcome);
  outcome.setArchitecturePort(createArchitectureReviewPort(architecture));
  const forward = (type: 'ADR_CREATED' | 'ADR_UPDATED' | 'ARCHITECTURE_IMPACT_ANALYSIS_COMPLETED') => {
    void architecture.bus.subscribe(type, (e) => {
      const adrId = typeof e.payload?.adr_id === 'string' ? e.payload.adr_id : undefined;
      const adr = adrId ? architecture.store.get(adrId) : undefined;
      outcome.emit({
        event_type: 'REVIEW_EVALUATE_REQUESTED',
        project_id: e.project_id,
        payload: {
          adr_id: adrId,
          adr_status: adr?.status,
          actor_id: 'architecture',
        },
      });
    });
  };
  forward('ADR_CREATED');
  forward('ADR_UPDATED');
  forward('ARCHITECTURE_IMPACT_ANALYSIS_COMPLETED');
}
