import type { AcceptanceCriterion, VerificationPlan, VerificationType } from '../domain/types.js';
import { newId, nowIso } from '../ids.js';

const DEFAULT_TIMEOUTS: Record<VerificationType, number> = {
  COMMAND: 120_000,
  TEST: 120_000,
  COMPILER: 120_000,
  STATIC_ANALYSIS: 120_000,
  BROWSER: 300_000,
  RUNTIME: 120_000,
  DATABASE: 180_000,
  DEPLOYMENT: 300_000,
  LOAD_TEST: 600_000,
  SECURITY: 300_000,
  ARCHITECTURE: 60_000,
};

function defaultCommand(type: VerificationType): { command: string; args: string[] } {
  if (type === 'COMPILER') {
    return { command: 'npx', args: ['tsc', '-p', 'tsconfig.json', '--noEmit'] };
  }
  if (type === 'TEST') {
    return { command: 'npm', args: ['test'] };
  }
  return { command: 'npm', args: ['test'] };
}

export class VerificationPlanner {
  constructor(
    private readonly workspaceRoot: string,
    private readonly timeouts?: Partial<Record<VerificationType, number>>,
  ) {}

  plan(criterion: AcceptanceCriterion): VerificationPlan {
    const type = criterion.verification_type;
    const { command, args } = defaultCommand(type);
    const now = nowIso();
    const timeout_ms = this.timeouts?.[type] ?? DEFAULT_TIMEOUTS[type] ?? 120_000;
    return {
      id: newId('PLAN'),
      mission_id: criterion.mission_id,
      requirement_id: criterion.requirement_id,
      criterion_id: criterion.id,
      type,
      command,
      args,
      timeout_ms,
      workspace_root: this.workspaceRoot,
      created_at: now,
      updated_at: now,
      version: 1,
      status: 'READY',
    };
  }
}

export { DEFAULT_TIMEOUTS };
