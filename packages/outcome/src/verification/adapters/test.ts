import type { VerificationPlan } from '../../domain/types.js';
import {
  assertSafeCommand,
  type VerificationAdapter,
  type VerificationContext,
  type VerificationResult,
} from '../adapter.js';

function parseTestCounts(text: string): {
  discovered?: number;
  executed?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
} {
  const passed = text.match(/(\d+)\s+passed/i);
  const failed = text.match(/(\d+)\s+failed/i);
  const skipped = text.match(/(\d+)\s+skipped/i);
  const tests = text.match(/Tests\s+(\d+)\s+passed/i);
  return {
    passed: passed ? Number(passed[1]) : tests ? Number(tests[1]) : undefined,
    failed: failed ? Number(failed[1]) : undefined,
    skipped: skipped ? Number(skipped[1]) : undefined,
    executed:
      (passed ? Number(passed[1]) : 0) +
      (failed ? Number(failed[1]) : 0) +
      (skipped ? Number(skipped[1]) : 0) || undefined,
    discovered: undefined,
  };
}

export class TestVerifier implements VerificationAdapter {
  readonly type = 'TEST';

  canHandle(plan: VerificationPlan): boolean {
    return plan.type === 'TEST';
  }

  async execute(
    plan: VerificationPlan,
    context: VerificationContext,
  ): Promise<VerificationResult> {
    const command = plan.command ?? 'npm';
    const args = plan.args?.length ? plan.args : ['test'];
    assertSafeCommand(command, args);
    const r = await context.executor.exec(command, args, {
      cwd: plan.workspace_root || context.workspaceRoot,
      timeoutMs: plan.timeout_ms,
    });
    const counts = parseTestCounts(`${r.stdout}\n${r.stderr}`);
    let result: VerificationResult['result'] = 'UNKNOWN';
    if (r.timedOut) {
      result = 'UNKNOWN';
    } else if (r.exitCode === 0 && (counts.failed === undefined || counts.failed === 0)) {
      result = 'PASS';
    } else if (r.exitCode !== 0 || (counts.failed ?? 0) > 0) {
      result = 'FAIL';
    }
    return {
      result,
      exitCode: r.exitCode,
      stdout: r.stdout,
      stderr: r.stderr,
      durationMs: r.durationMs,
      timedOut: r.timedOut,
      source: 'test',
      testsDiscovered: counts.discovered,
      testsExecuted: counts.executed,
      testsPassed: counts.passed,
      testsFailed: counts.failed,
      testsSkipped: counts.skipped,
    };
  }
}
