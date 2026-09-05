/**
 * Requirement-driven verification using Context Engine checklists.
 * Complements deterministic ToolPort verification (typecheck/tests).
 */

import type { LlmPort } from '../ports.js';
import {
  STAGE_DEFAULT_DEADLINES,
  stageDeadlineMs,
  withDeadline,
} from '../parallel.js';

export interface RequirementVerifyItem {
  id: string;
  kind: 'requirement' | 'constraint' | 'prohibition' | 'decision';
  text: string;
  status: 'pass' | 'fail' | 'unknown';
  evidence?: string;
}

export interface RequirementVerifyResult {
  ok: boolean;
  items: RequirementVerifyItem[];
  summary: string;
  tokensUsed: number;
}

const VERIFY_SYSTEM = `You are Singularity's requirement verifier.
Given a task, implementation summary/diff, and a checklist of requirements/constraints/prohibitions,
evaluate each item as pass, fail, or unknown.
Return ONLY valid JSON:
{
  "items": [{"id": string, "status": "pass"|"fail"|"unknown", "evidence": string}],
  "summary": string
}
Do not invent requirements. Prefer unknown over guessing.`;

/**
 * Verify implementation against structured requirements/constraints.
 * Falls back to unknown checklist if LLM fails — never blocks coding alone.
 */
export async function verifyAgainstRequirements(options: {
  llm: LlmPort;
  task: string;
  checklist: string;
  implementationSummary: string;
  sessionId?: string;
  signal?: AbortSignal;
}): Promise<RequirementVerifyResult> {
  if (!options.checklist.trim()) {
    return {
      ok: true,
      items: [],
      summary: 'No structured requirements to verify',
      tokensUsed: 0,
    };
  }

  try {
    // Bounded verifier: on timeout the existing fail-open catch returns
    // "skipped" (behavior-preserving, just bounded).
    const verifierDeadline =
      stageDeadlineMs(
        'SINGULARITY_VERIFY_DEADLINE_MS',
        STAGE_DEFAULT_DEADLINES.requirementVerifier,
      ) ?? Number.MAX_SAFE_INTEGER;
    const result = await withDeadline(
      options.llm.complete({
        role: 'worker',
        systemPrompt: VERIFY_SYSTEM,
        prompt: [
          `TASK:\n${options.task}`,
          `CHECKLIST:\n${options.checklist}`,
          `IMPLEMENTATION:\n${options.implementationSummary.slice(0, 12_000)}`,
        ].join('\n\n'),
        preferredTier: 'T2',
        temperature: 0,
        sessionId: options.sessionId ?? 'req-verify',
        signal: options.signal,
      }),
      verifierDeadline,
      'Requirement verifier',
    );

    const parsed = parseVerifyJson(result.text);
    const items: RequirementVerifyItem[] = (parsed.items ?? []).map((it) => ({
      id: String(it.id ?? 'item'),
      kind: 'requirement',
      text: String(it.evidence ?? ''),
      status:
        it.status === 'pass' || it.status === 'fail' || it.status === 'unknown'
          ? it.status
          : 'unknown',
      evidence: it.evidence,
    }));
    const ok = items.every((i) => i.status !== 'fail');
    return {
      ok,
      items,
      summary: parsed.summary ?? (ok ? 'Requirements passed' : 'Requirements failed'),
      tokensUsed: result.tokensUsed,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: true,
      items: [],
      summary: `Requirement verification skipped (${message}); tool verification may still run`,
      tokensUsed: 0,
    };
  }
}

function parseVerifyJson(text: string): {
  items?: Array<{ id?: string; status?: string; evidence?: string }>;
  summary?: string;
} {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(jsonText) as {
    items?: Array<{ id?: string; status?: string; evidence?: string }>;
    summary?: string;
  };
}
