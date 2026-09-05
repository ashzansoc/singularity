/**
 * MissionWorkflow — binds a runtime run to mission lifecycle and workflow identity.
 */

import type { ExecutionMode } from '../allocation/types.js';
import type { WorkflowProgress } from '../progress/calculator.js';

export type MissionWorkflowPhase =
  | 'planning'
  | 'running'
  | 'integrating'
  | 'verifying'
  | 'synthesizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface MissionWorkflowState {
  workflowId: string;
  missionId?: string;
  sessionId: string;
  goal: string;
  phase: MissionWorkflowPhase;
  executionMode: ExecutionMode;
  agentCount: number;
  startedAt: number;
  completedAt?: number;
  progress?: WorkflowProgress;
  cancelled?: boolean;
}

export function createMissionWorkflow(opts: {
  sessionId: string;
  goal: string;
  missionId?: string;
  executionMode: ExecutionMode;
  agentCount: number;
}): MissionWorkflowState {
  return {
    workflowId: `wf-${opts.sessionId}-${Date.now().toString(36)}`,
    missionId: opts.missionId,
    sessionId: opts.sessionId,
    goal: opts.goal,
    phase: 'planning',
    executionMode: opts.executionMode,
    agentCount: opts.agentCount,
    startedAt: Date.now(),
  };
}

export function bumpMissionPhase(
  state: MissionWorkflowState,
  phase: MissionWorkflowPhase,
): MissionWorkflowState {
  return {
    ...state,
    phase,
    completedAt:
      phase === 'completed' || phase === 'failed' || phase === 'cancelled'
        ? Date.now()
        : state.completedAt,
    cancelled: phase === 'cancelled' ? true : state.cancelled,
  };
}
