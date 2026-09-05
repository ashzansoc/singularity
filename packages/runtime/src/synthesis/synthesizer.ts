/**
 * FinalSynthesizer — produces a single user-facing outcome from multi-agent results.
 */

import type { LlmPort } from '../ports.js';
import type { ExecutionPlan, RuntimeRunResult } from '../types.js';

const SYNTH_SYSTEM = `You are Singularity's final synthesizer.
The user asked for one coherent outcome. Multiple specialist agents completed work in parallel.
Write a clear, concise final response for the user:
- Summarize what was accomplished
- List key changes and findings
- Note verification status
- Do NOT expose internal chain-of-thought or raw agent dialogue
- Do NOT invent metrics — only use numbers provided in the input
Return plain markdown (no JSON).`;

export interface SynthesizeOptions {
  llm: LlmPort;
  goal: string;
  plan: ExecutionPlan;
  result: Pick<
    RuntimeRunResult,
    'ok' | 'summary' | 'appliedPaths' | 'subagentResults' | 'verification'
  >;
  sessionId?: string;
  signal?: AbortSignal;
}

export async function synthesizeFinalOutcome(opts: SynthesizeOptions): Promise<string> {
  const agentSummaries =
    opts.result.subagentResults
      ?.map(
        (r) =>
          `- ${r.subagentId} (${r.status}): ${r.summary}` +
          (r.recommendations?.length
            ? `\n  Recommendations: ${r.recommendations.slice(0, 5).join('; ')}`
            : ''),
      )
      .join('\n') ?? '(none)';

  const verify = opts.result.verification
    ? `Tools: ${opts.result.verification.toolsOk ? 'pass' : 'fail'} · Requirements: ${opts.result.verification.requirementsOk ? 'pass' : 'fail'} · ${opts.result.verification.summary}`
    : 'Verification not run';

  const prompt = [
    `User goal: ${opts.goal}`,
    `Mission ok: ${opts.result.ok}`,
    `Files changed (${opts.result.appliedPaths.length}): ${opts.result.appliedPaths.slice(0, 40).join(', ')}`,
    `Agent count: ${opts.plan.nodes.length}`,
    `Runtime summary:\n${opts.result.summary}`,
    `Verification:\n${verify}`,
    `Agent results:\n${agentSummaries}`,
  ].join('\n\n');

  const out = await opts.llm.complete({
    role: 'integrator',
    systemPrompt: SYNTH_SYSTEM,
    prompt,
    preferredTier: 'T5',
    temperature: 0.2,
    sessionId: opts.sessionId,
    signal: opts.signal,
  });

  return out.text.trim() || opts.result.summary;
}
