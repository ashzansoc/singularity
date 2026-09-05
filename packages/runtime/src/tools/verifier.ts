/**
 * Deterministic verification via ToolPort (typecheck / tests).
 */

import type { ToolPort } from '../ports.js';

export interface VerifyResult {
  ok: boolean;
  steps: Array<{ name: string; ok: boolean; output: string }>;
  summary: string;
}

/**
 * Run typecheck then optional tests. Failures feed WorkingMemory / re-plan.
 */
export async function verifyWithTools(
  tools: ToolPort,
  options?: { skipTests?: boolean; paths?: string[] },
): Promise<VerifyResult> {
  const steps: VerifyResult['steps'] = [];

  if (tools.typecheck) {
    const r = await tools.typecheck(options?.paths);
    steps.push({ name: 'typecheck', ok: r.ok, output: r.output });
  }

  if (!options?.skipTests && tools.test) {
    const r = await tools.test(options?.paths);
    steps.push({ name: 'test', ok: r.ok, output: r.output });
  }

  if (tools.gitStatus) {
    const status = await tools.gitStatus();
    steps.push({ name: 'git-status', ok: true, output: status });
  }

  const ok = steps.every((s) => s.ok);
  return {
    ok,
    steps,
    summary: ok
      ? 'Verification passed'
      : `Verification failed: ${steps
          .filter((s) => !s.ok)
          .map((s) => s.name)
          .join(', ')}`,
  };
}
