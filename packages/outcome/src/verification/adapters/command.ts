import type { VerificationPlan } from '../../domain/types.js';
import {
  assertSafeCommand,
  type VerificationAdapter,
  type VerificationContext,
  type VerificationResult,
} from '../adapter.js';

export class CommandVerifier implements VerificationAdapter {
  readonly type = 'COMMAND';

  canHandle(plan: VerificationPlan): boolean {
    return plan.type === 'COMMAND';
  }

  async execute(
    plan: VerificationPlan,
    context: VerificationContext,
  ): Promise<VerificationResult> {
    const command = plan.command ?? 'npm';
    const args = plan.args ?? [];
    assertSafeCommand(command, args);
    const r = await context.executor.exec(command, args, {
      cwd: plan.workspace_root || context.workspaceRoot,
      timeoutMs: plan.timeout_ms,
    });
    let result: VerificationResult['result'] = 'UNKNOWN';
    if (r.timedOut) {
      result = 'UNKNOWN';
    } else if (r.exitCode === 0) {
      if (plan.success_pattern) {
        const re = new RegExp(plan.success_pattern);
        result = re.test(r.stdout) || re.test(r.stderr) ? 'PASS' : 'FAIL';
      } else {
        result = 'PASS';
      }
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
      source: `${command} ${args.join(' ')}`.trim(),
    };
  }
}
