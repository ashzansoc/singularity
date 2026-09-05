import { describe, expect, it } from 'vitest';
import { snapshotToChatPayload } from '../src/events/chatAdapter.js';
import { WorkflowEventStore } from '../src/events/store.js';
import { createMissionWorkflow } from '../src/mission/workflow.js';
import type { ExecutionPlan, TaskNode } from '../src/types.js';

const node: TaskNode = {
  id: 'backend',
  title: 'Backend',
  deps: [],
  ownedPaths: ['backend/auth.ts'],
  expectedOutput: 'Auth',
  estimatedTokens: 100,
  recommendedTier: 'T3',
  priority: 1,
  retryLimit: 1,
  status: 'running',
  role: 'backend',
  assignedAgentId: 'agent-01',
  deliverable: 'JWT middleware',
};

const plan: ExecutionPlan = {
  id: 'plan-1',
  goal: 'Migrate auth',
  projectSummary: '',
  nodes: [node],
  estimates: { totalTokens: 100, taskCount: 1, criticalPathLength: 1 },
  createdAt: Date.now(),
};

describe('WorkflowEventStore', () => {
  it('ingests runtime events and builds snapshots', () => {
    const store = new WorkflowEventStore();
    const wf = createMissionWorkflow({
      sessionId: 's1',
      goal: plan.goal,
      executionMode: 'parallel',
      agentCount: 1,
    });
    store.setWorkflow(wf, plan);
    store.ingestRuntimeEvent({
      kind: 'agent_started',
      ts: Date.now(),
      taskId: 'backend',
      message: 'started',
      data: { assignedAgentId: 'agent-01' },
    });
    const snap = store.snapshot();
    expect(snap?.agents[0]?.agentId).toBe('agent-01');
    expect(snap?.events.length).toBeGreaterThan(0);
  });

  it('maps snapshots to chat payloads', () => {
    const store = new WorkflowEventStore();
    const wf = createMissionWorkflow({
      sessionId: 's1',
      goal: plan.goal,
      executionMode: 'parallel',
      agentCount: 1,
    });
    store.setWorkflow(wf, plan);
    const snap = store.snapshot()!;
    const payload = snapshotToChatPayload(snap);
    expect(payload.kind).toBe('agentTeam');
    expect(payload.summary.total).toBe(1);
  });
});
