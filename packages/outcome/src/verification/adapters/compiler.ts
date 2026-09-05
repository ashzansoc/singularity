import type { VerificationPlan } from '../../domain/types.js';
import {
  assertSafeCommand,
  type VerificationAdapter,
  type VerificationContext,
  type VerificationResult,
} from '../adapter.js';

export class CompilerVerifier implements VerificationAdapter {
  readonly type = 'COMPILER';

  canHandle(plan: VerificationPlan): boolean {
    return plan.type === 'COMPILER';
  }

  async execute(
    plan: VerificationPlan,
    context: VerificationContext,
  ): Promise<VerificationResult> {
    const command = plan.command ?? 'npx';
    const args = plan.args?.length ? plan.args : ['tsc', '--noEmit'];
    assertSafeCommand(command, args);
    const r = await context.executor.exec(command, args, {
      cwd: plan.workspace_root || context.workspaceRoot,
      timeoutMs: plan.timeout_ms,
    });
    let result: VerificationResult['result'] = 'UNKNOWN';
    if (r.timedOut) {
      result = 'UNKNOWN';
    } else if (r.exitCode === 0) {
      result = 'PASS';
    } else {
      result = 'FAIL';
    }
    return {
      result,
      exitCode: r.exitCode,
      stdout: r.stdout,
      stderr: r.stderr,
      durationMs: r.durationMs,
      timedOut: r.timedOut,
      source: 'tsc',
    };
  }
}
