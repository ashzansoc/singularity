import { describe, expect, it } from 'vitest';
import { allocateAgents, decideExecutionMode } from '../src/allocation/engine.js';
import { buildDag } from '../src/graph/dag.js';
import type { ExecutionPlan, TaskNode } from '../src/types.js';

function planWithNodes(nodes: TaskNode[]): ExecutionPlan {
  const dag = buildDag(nodes);
  return {
    id: 'test-plan',
    goal: 'test',
    projectSummary: '',
    nodes,
    estimates: { totalTokens: 100, taskCount: nodes.length, criticalPathLength: 1 },
    createdAt: Date.now(),
  };
}

describe('AgentAllocationEngine', () => {
  it('selects single mode for one task', () => {
    const plan = planWithNodes([
      {
        id: 'a',
        title: 'Only',
        deps: [],
        ownedPaths: ['src/a.ts'],
        expectedOutput: 'done',
        estimatedTokens: 100,
        recommendedTier: 'T2',
        priority: 1,
        retryLimit: 1,
        status: 'pending',
      },
    ]);
    expect(decideExecutionMode({ goal: 'fix', plan, complexityLane: 'medium' })).toBe('single');
  });

  it('assigns agent ids and deliverables', () => {
    const plan = planWithNodes([
      {
        id: 'backend',
        title: 'Backend auth',
        deps: [],
        ownedPaths: ['backend/auth.ts'],
        expectedOutput: 'JWT middleware',
        estimatedTokens: 200,
        recommendedTier: 'T3',
        priority: 2,
        retryLimit: 1,
        status: 'pending',
        role: 'backend',
      },
      {
        id: 'frontend',
        title: 'Frontend login',
        deps: ['backend'],
        ownedPaths: ['frontend/login.tsx'],
        expectedOutput: 'Login UI',
        estimatedTokens: 200,
        recommendedTier: 'T3',
        priority: 2,
        retryLimit: 1,
        status: 'pending',
        role: 'frontend',
      },
    ]);
    const out = allocateAgents({ goal: 'Add OAuth', plan, complexityLane: 'deep' });
    expect(out.agentCount).toBe(2);
    expect(out.plan.nodes[0]?.assignedAgentId).toMatch(/^agent-/);
    expect(out.plan.nodes[0]?.deliverable).toBeTruthy();
    expect(out.plan.nodes[0]?.contextScope?.length).toBeGreaterThan(0);
  });

  it('respects maxAgents limit', () => {
    const nodes: TaskNode[] = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      deps: i > 0 ? [`t${i - 1}`] : [],
      ownedPaths: [`src/f${i}.ts`],
      expectedOutput: 'x',
      estimatedTokens: 50,
      recommendedTier: 'T2' as const,
      priority: 1,
      retryLimit: 1,
      status: 'pending' as const,
    }));
    const out = allocateAgents({
      goal: 'big',
      plan: planWithNodes(nodes),
      complexityLane: 'deep',
      limits: { maxAgents: 5 },
    });
    expect(out.plan.nodes.length).toBeLessThanOrEqual(5);
  });
});
