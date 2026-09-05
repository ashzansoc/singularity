/**
 * Subscribe to Outcome remediation requests and feed replan prompts back into Runtime.
 */

import type { LlmPort } from '../ports.js';
import { createExecutionPlan, type PlanRequest } from '../planner/planner.js';
import type { ExecutionPlan } from '../types.js';

export interface RemediationReplanRequest {
  missionId: string;
  plannerPrompt: string;
  goal: string;
  structuredContext?: string;
  verificationChecklist?: string;
}

export async function createRemediationPlan(
  req: RemediationReplanRequest,
  opts: { llm: LlmPort; sessionId?: string; signal?: AbortSignal },
): Promise<ExecutionPlan> {
  const combinedGoal = `${req.goal}\n\nRemediation:\n${req.plannerPrompt}`;
  return createExecutionPlan(
    {
      goal: combinedGoal,
      structuredContext: req.structuredContext,
      verificationChecklist: req.verificationChecklist,
      signal: opts.signal,
    } satisfies PlanRequest,
    { llm: opts.llm, sessionId: opts.sessionId },
  );
}
