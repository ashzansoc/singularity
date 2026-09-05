import type { Evidence, VerificationPlan } from '../domain/types.js';
import { newId, nowIso } from '../ids.js';
import { sanitizeEvidenceText } from '../evidence/sanitize.js';
import type { VerificationAdapter, VerificationContext, VerificationResult } from './adapter.js';

export class VerificationRunner {
  constructor(private readonly adapters: VerificationAdapter[]) {}

  async run(plan: VerificationPlan, context: VerificationContext): Promise<VerificationResult> {
    const adapter = this.adapters.find((a) => a.canHandle(plan));
    if (!adapter) {
      return {
        result: 'UNKNOWN',
        stdout: '',
        stderr: `no adapter for ${plan.type}`,
        durationMs: 0,
        timedOut: false,
        source: 'none',
      };
    }
    return adapter.execute(plan, context);
  }
}

export function resultToEvidence(
  result: VerificationResult,
  opts: {
    missionId: string;
    runId: string;
    requirementId: string;
    criterionId: string;
    requirementVersionHash: string;
    codeRevision: string;
    type: Evidence['type'];
  },
): Evidence {
  const now = nowIso();
  return {
    id: newId('EVID'),
    mission_id: opts.missionId,
    verification_id: opts.runId,
    requirement_id: opts.requirementId,
    criterion_id: opts.criterionId,
    type: opts.type,
    source: result.source,
    result: result.result,
    exit_code: result.exitCode,
    duration_ms: result.durationMs,
    stdout: sanitizeEvidenceText((result.stdout ?? '').slice(0, 16_000)),
    stderr: sanitizeEvidenceText((result.stderr ?? '').slice(0, 16_000)),
    tests_discovered: result.testsDiscovered,
    tests_executed: result.testsExecuted,
    tests_passed: result.testsPassed,
    tests_failed: result.testsFailed,
    tests_skipped: result.testsSkipped,
    requirement_version_hash: opts.requirementVersionHash,
    code_revision: opts.codeRevision,
    environment: 'test',
    timestamp: now,
    created_at: now,
    updated_at: now,
    version: 1,
  };
}
