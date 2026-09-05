import type { Mission } from '../domain/types.js';
import type { OutcomeStore } from '../persistence/store.js';
import type { MissionSignals } from './evaluator.js';
import type { ArchitectureReviewPort, ArchitectureSignals } from './port.js';
import { EMPTY_ARCHITECTURE_SIGNALS } from './port.js';

const SECURITY_RE = /(auth|oauth|crypto|secret|password|security|iam)/i;
const SCHEMA_RE = /(migration|schema|\.sql$|alembic|prisma)/i;
const DEPLOY_RE = /(deploy|k8s|helm|terraform|dockerfile|compose)/i;

export function collectMissionSignals(
  mission: Mission,
  store: OutcomeStore,
  port?: ArchitectureReviewPort,
  changedFiles?: string[],
): { signals: MissionSignals; arch: ArchitectureSignals } {
  let arch: ArchitectureSignals = EMPTY_ARCHITECTURE_SIGNALS;
  try {
    arch =
      port?.collectSignals({
        mission_id: mission.id,
        project_id: mission.project_id,
        code_revision: mission.code_revision,
        changed_files: changedFiles,
      }) ?? EMPTY_ARCHITECTURE_SIGNALS;
  } catch {
    arch = EMPTY_ARCHITECTURE_SIGNALS;
  }

  const reqs = store.listRequirements(mission.id);
  const outcome = store.getOutcome(mission.id);
  const files = changedFiles ?? [];
  const verification_failures =
    (outcome?.fail_count ?? 0) > 0 || reqs.some((r) => r.status === 'FAIL');
  const security_sensitive =
    reqs.some((r) => r.type === 'security') || files.some((f) => SECURITY_RE.test(f));
  const schema_change = files.some((f) => SCHEMA_RE.test(f));
  const deployment_change =
    Boolean(arch.affects_production) ||
    files.some((f) => DEPLOY_RE.test(f)) ||
    (arch.deployments?.length ?? 0) > 0;
  const large_refactor =
    files.length >= 20 ||
    arch.architecture_impact === 'high' ||
    arch.architecture_impact === 'critical';
  const pass = outcome?.pass_count ?? 0;
  const total = reqs.length || 1;
  const outcome_confidence = Math.min(1, pass / total);

  return {
    arch,
    signals: {
      mission_id: mission.id,
      mission_type: undefined,
      risk_level: arch.risk_level,
      risk_score: arch.risk_score,
      affects_production: Boolean(arch.affects_production) || deployment_change,
      architecture_impact: arch.architecture_impact,
      impact_recommendation: arch.impact_recommendation,
      has_proposed_adrs: (arch.proposed_adrs?.length ?? 0) > 0,
      security_sensitive,
      schema_change,
      deployment_change,
      large_refactor,
      verification_failures,
      conflicting_evidence: (arch.conflicts?.length ?? 0) > 0,
      outcome_confidence,
    },
  };
}
