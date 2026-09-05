import { describe, expect, it } from 'vitest';
import { ContextBus } from '../src/bus/contextBus.js';
import {
  createRuntimeEngine,
  InMemoryEditPort,
  InMemoryWorkspace,
  type LlmPort,
} from '../src/index.js';
import {
  buildSubagentContext,
  createPermissionedPorts,
  createSubagentOrchestrator,
  classifyFailure,
  enrichTaskNodeAsSubagent,
  getRoleDefaults,
  parseAgentTurn,
  parsePlanJson,
  resolveModelRouting,
  runScheduler,
  SubagentManager,
  finalizePlan,
  type ExecutionPlan,
  type TaskNode,
} from '../src/index.js';
import { ToolPermissionError } from '../src/subagent/permissions.js';

function makePlan(nodes: TaskNode[], goal = 'test'): ExecutionPlan {
  return {
    id: 'test',
    goal,
    projectSummary: 'test',
    structuredContext:
      'Requirements:\n- Use TypeScript\nProhibitions:\n- Do not use Firebase\nFile notes:\n- server/db.ts uses postgres\n- src/ui/Button.tsx is frontend',
    nodes,
    estimates: {
      totalTokens: 100,
      taskCount: nodes.length,
      criticalPathLength: 1,
    },
    createdAt: Date.now(),
  };
}

function subTask(
  partial: Partial<TaskNode> & Pick<TaskNode, 'id' | 'ownedPaths'>,
): TaskNode {
  const base: TaskNode = {
    id: partial.id,
    title: partial.title ?? partial.id,
    deps: partial.deps ?? [],
    ownedPaths: partial.ownedPaths,
    expectedOutput: partial.expectedOutput ?? 'ok',
    estimatedTokens: 100,
    recommendedTier: partial.recommendedTier ?? 'T2',
    priority: partial.priority ?? 0,
    retryLimit: partial.retryLimit ?? 0,
    status: 'pending',
    attempts: 0,
    role: partial.role,
    objective: partial.objective ?? partial.title ?? partial.id,
    specialty: partial.specialty,
    modelPolicy: partial.modelPolicy,
    tools: partial.tools,
    maxIterations: partial.maxIterations,
    timeoutMs: partial.timeoutMs,
    depth: partial.depth,
    parentTaskId: partial.parentTaskId,
    deniedPaths: partial.deniedPaths,
    preferredModelId: partial.preferredModelId,
  };
  return enrichTaskNodeAsSubagent(base);
}

function successTurn(path: string, content: string, extra?: Record<string, unknown>) {
  return JSON.stringify({
    diffs: [{ path, newContent: content, isNew: false }],
    result: {
      status: 'success',
      summary: `Wrote ${path}`,
      filesModified: [path],
      filesCreated: [],
      filesDeleted: [],
      testsRun: [],
      testsPassed: [],
      testsFailed: [],
      issues: [],
      recommendations: [],
      ...extra,
    },
  });
}

describe('subagent types + role catalog', () => {
  it('maps model policy strategies to tiers', () => {
    expect(resolveModelRouting({ strategy: 'fast' }).preferredTier).toBe('T1');
    expect(resolveModelRouting({ strategy: 'coding' }).preferredTier).toBe('T2');
    expect(resolveModelRouting({ strategy: 'reasoning' }).preferredTier).toBe('T4');
    expect(
      resolveModelRouting({
        strategy: 'custom',
        preferredModels: ['anthropic/claude-opus-5'],
      }).modelId,
    ).toBe('anthropic/claude-opus-5');
  });

  it('explorer tools are read-only', () => {
    const tools = getRoleDefaults('explorer').tools;
    expect(tools).toContain('read_file');
    expect(tools).not.toContain('write_file');
  });

  it('classifies failures', () => {
    expect(classifyFailure('review_reject')).toBe('review_reject');
    expect(classifyFailure('LockTimeout')).toBe('lock_timeout');
    expect(classifyFailure('Tool not permitted')).toBe('tool_failure');
  });
});

describe('planner subagents alias', () => {
  it('parses subagents[] as nodes with roles', () => {
    const raw = parsePlanJson(
      JSON.stringify({
        projectSummary: 'auth',
        subagents: [
          {
            id: 'explore-auth',
            role: 'explorer',
            objective: 'Analyze auth',
            dependencies: [],
            ownedPaths: ['src/auth'],
          },
          {
            id: 'backend-auth',
            role: 'backend',
            objective: 'Implement API',
            dependencies: ['explore-auth'],
            ownedPaths: ['server/auth'],
          },
        ],
      }),
    );
    const plan = finalizePlan(raw, { goal: 'Add auth' });
    expect(plan.nodes[0]!.role).toBe('explorer');
    expect(plan.nodes[1]!.deps).toEqual(['explore-auth']);
    expect(plan.nodes[0]!.tools).toContain('read_file');
  });
});

describe('context isolation', () => {
  it('filters parent context toward owned paths / role', () => {
    const task = subTask({
      id: 'fe',
      role: 'frontend',
      ownedPaths: ['src/ui'],
      objective: 'Build login UI',
    });
    const ctx = buildSubagentContext({
      task,
      plan: makePlan([task]),
      parentContext: makePlan([task]).structuredContext,
    });
    expect(ctx).toContain('frontend');
    expect(ctx.toLowerCase()).not.toContain('server/db.ts uses postgres');
  });
});

describe('tool permissions', () => {
  it('denies write for explorer', async () => {
    const workspace = new InMemoryWorkspace({ 'a.ts': '1' });
    const ports = createPermissionedPorts(
      { workspace },
      getRoleDefaults('explorer').tools,
      { allowedPaths: ['a.ts'] },
    );
    await expect(ports.workspace.writeFile!('a.ts', '2')).rejects.toBeInstanceOf(
      ToolPermissionError,
    );
  });

  it('denies write outside ownership', async () => {
    const workspace = new InMemoryWorkspace({ 'a.ts': '1', 'b.ts': '1' });
    const ports = createPermissionedPorts(
      { workspace },
      getRoleDefaults('backend').tools,
      { allowedPaths: ['a.ts'] },
    );
    await expect(ports.workspace.writeFile!('b.ts', '2')).rejects.toBeInstanceOf(
      ToolPermissionError,
    );
  });
});

describe('subagent execution scenarios', () => {
  it('1. runs a single subagent', async () => {
    const workspace = new InMemoryWorkspace({ 'src/a.ts': 'old' });
    const llm: LlmPort = {
      async complete() {
        return {
          modelId: 'mock-fast',
          tokensUsed: 20,
          text: successTurn('src/a.ts', 'new'),
        };
      },
    };
    const plan = makePlan([
      subTask({
        id: 'one',
        role: 'backend',
        ownedPaths: ['src/a.ts'],
        title: 'Bump a',
      }),
    ]);
    const result = await runScheduler(plan, {
      llm,
      workspace,
      bus: new ContextBus(),
      concurrency: 2,
      enableSubagentLoop: true,
    });
    expect(result.ok).toBe(true);
    expect(result.results[0]!.subagentResult?.status).toBe('success');
  });

  it('2+4. runs two independent subagents concurrently', async () => {
    let concurrent = 0;
    let max = 0;
    const llm: LlmPort = {
      async complete(req) {
        concurrent++;
        max = Math.max(max, concurrent);
        await new Promise((r) => setTimeout(r, 40));
        concurrent--;
        const path = req.prompt.includes('Task: fe') ? 'src/ui.ts' : 'server/api.ts';
        return {
          modelId: 'mock',
          tokensUsed: 10,
          text: successTurn(path, 'ok'),
        };
      },
    };
    const plan = makePlan([
      subTask({ id: 'fe', role: 'frontend', ownedPaths: ['src/ui.ts'], title: 'fe' }),
      subTask({ id: 'be', role: 'backend', ownedPaths: ['server/api.ts'], title: 'be' }),
    ]);
    const result = await runScheduler(plan, {
      llm,
      workspace: new InMemoryWorkspace({
        'src/ui.ts': '1',
        'server/api.ts': '1',
      }),
      bus: new ContextBus(),
      concurrency: 4,
      enableSubagentLoop: true,
    });
    expect(result.ok).toBe(true);
    expect(max).toBeGreaterThan(1);
  });

  it('3. respects dependency chain ordering', async () => {
    const order: string[] = [];
    const llm: LlmPort = {
      async complete(req) {
        const id = req.prompt.includes('Task: explore')
          ? 'explore'
          : req.prompt.includes('Task: impl')
            ? 'impl'
            : 'other';
        order.push(id);
        const path =
          id === 'explore' ? 'notes.md' : id === 'impl' ? 'src/a.ts' : 'x.ts';
        return {
          modelId: 'mock',
          tokensUsed: 5,
          text: successTurn(path, id),
        };
      },
    };
    const plan = makePlan([
      subTask({
        id: 'explore',
        role: 'explorer',
        ownedPaths: ['notes.md'],
        title: 'explore',
      }),
      subTask({
        id: 'impl',
        role: 'backend',
        ownedPaths: ['src/a.ts'],
        deps: ['explore'],
        title: 'impl',
      }),
    ]);
    const result = await runScheduler(plan, {
      llm,
      workspace: new InMemoryWorkspace({ 'notes.md': '', 'src/a.ts': '' }),
      bus: new ContextBus(),
      enableSubagentLoop: true,
    });
    expect(result.ok).toBe(true);
    expect(order.indexOf('explore')).toBeLessThan(order.indexOf('impl'));
  });

  it('5. rejects foreign-path diffs via ownership (ChangeRequest)', async () => {
    const bus = new ContextBus();
    const llm: LlmPort = {
      async complete() {
        return {
          modelId: 'mock',
          tokensUsed: 5,
          text: JSON.stringify({
            diffs: [
              { path: 'owned.ts', newContent: 'ok' },
              { path: 'foreign.ts', newContent: 'bad' },
            ],
            result: {
              status: 'success',
              summary: 'partial ownership',
              filesModified: ['owned.ts'],
              filesCreated: [],
              filesDeleted: [],
              testsRun: [],
              testsPassed: [],
              testsFailed: [],
              issues: [],
              recommendations: [],
            },
          }),
        };
      },
    };
    const plan = makePlan([
      subTask({
        id: 'w',
        role: 'backend',
        ownedPaths: ['owned.ts'],
        title: 'w',
      }),
    ]);
    const result = await runScheduler(plan, {
      llm,
      workspace: new InMemoryWorkspace({ 'owned.ts': '', 'foreign.ts': '' }),
      bus,
      enableSubagentLoop: true,
    });
    expect(result.ok).toBe(true);
    expect(result.results[0]!.diffs.every((d) => d.path === 'owned.ts')).toBe(
      true,
    );
    expect(
      bus.getEvents().some((e) => e.kind === 'ChangeRequest'),
    ).toBe(true);
  });

  it('6. failed subagent cancels dependents', async () => {
    const llm: LlmPort = {
      async complete(req) {
        if (req.prompt.includes('Task: a')) {
          return {
            modelId: 'mock',
            tokensUsed: 1,
            text: JSON.stringify({
              result: {
                status: 'failed',
                summary: 'boom',
                filesCreated: [],
                filesModified: [],
                filesDeleted: [],
                testsRun: [],
                testsPassed: [],
                testsFailed: [],
                issues: ['boom'],
                recommendations: [],
              },
            }),
          };
        }
        return {
          modelId: 'mock',
          tokensUsed: 1,
          text: successTurn('b.ts', 'ok'),
        };
      },
    };
    const plan = makePlan([
      subTask({
        id: 'a',
        role: 'backend',
        ownedPaths: ['a.ts'],
        title: 'a',
        retryLimit: 0,
      }),
      subTask({
        id: 'b',
        role: 'backend',
        ownedPaths: ['b.ts'],
        deps: ['a'],
        title: 'b',
      }),
    ]);
    const result = await runScheduler(plan, {
      llm,
      workspace: new InMemoryWorkspace({ 'a.ts': '', 'b.ts': '' }),
      bus: new ContextBus(),
      enableSubagentLoop: true,
    });
    expect(result.ok).toBe(false);
    expect(plan.nodes.find((n) => n.id === 'b')!.status).toBe('cancelled');
  });

  it('7. retries and escalates model', async () => {
    let attempts = 0;
    const escalated: string[] = [];
    const llm: LlmPort = {
      async complete() {
        attempts++;
        if (attempts === 1) {
          throw new Error('gateway error 503');
        }
        return {
          modelId: 'mock-2',
          tokensUsed: 5,
          text: successTurn('a.ts', 'ok'),
        };
      },
      async escalate(prev) {
        escalated.push(prev);
        return { modelId: 'mock-2', tier: 'T3' };
      },
    };
    const plan = makePlan([
      subTask({
        id: 'a',
        role: 'backend',
        ownedPaths: ['a.ts'],
        title: 'a',
        retryLimit: 2,
      }),
    ]);
    // First attempt throws inside loop → failResult → scheduler retries
    const result = await runScheduler(plan, {
      llm,
      workspace: new InMemoryWorkspace({ 'a.ts': '' }),
      bus: new ContextBus(),
      enableSubagentLoop: true,
    });
    expect(result.ok).toBe(true);
    expect(attempts).toBeGreaterThan(1);
    expect(escalated.length).toBeGreaterThan(0);
  });

  it('8+9. reviewer rejection spawns fixer', async () => {
    const llm: LlmPort = {
      async complete(req) {
        if (req.prompt.includes('Task: impl')) {
          return {
            modelId: 'impl',
            tokensUsed: 5,
            text: successTurn('src/a.ts', 'impl'),
          };
        }
        if (req.prompt.includes('Task: review')) {
          return {
            modelId: 'review',
            tokensUsed: 5,
            text: JSON.stringify({
              result: {
                status: 'failed',
                summary: 'Critical issues found',
                filesCreated: [],
                filesModified: [],
                filesDeleted: [],
                testsRun: [],
                testsPassed: [],
                testsFailed: [],
                issues: ['security'],
                recommendations: ['fix auth'],
                review: {
                  approved: false,
                  issues: [
                    {
                      severity: 'critical',
                      file: 'src/a.ts',
                      description: 'missing auth check',
                    },
                  ],
                  recommendations: ['add auth'],
                },
              },
            }),
          };
        }
        // fixer
        return {
          modelId: 'fixer',
          tokensUsed: 5,
          text: successTurn('src/a.ts', 'fixed'),
        };
      },
    };
    const orchestrator = createSubagentOrchestrator({
      bounds: { maxSubagentDepth: 2, maxTotalSubagents: 12 },
      ensureReviewTail: false,
    });
    const plan = makePlan([
      subTask({
        id: 'impl',
        role: 'backend',
        ownedPaths: ['src/a.ts'],
        title: 'impl',
      }),
      subTask({
        id: 'review',
        role: 'reviewer',
        ownedPaths: [],
        deps: ['impl'],
        title: 'review',
        retryLimit: 1,
      }),
    ]);
    const result = await runScheduler(plan, {
      llm,
      workspace: new InMemoryWorkspace({ 'src/a.ts': '' }),
      bus: new ContextBus(),
      orchestrator,
      enableSubagentLoop: true,
    });
    expect(plan.nodes.some((n) => n.role === 'debugger')).toBe(true);
    expect(result.results.length).toBeGreaterThanOrEqual(2);
  });

  it('10. spawn child within bounds; reject over depth', () => {
    const manager = new SubagentManager({
      maxSubagentDepth: 1,
      maxTotalSubagents: 5,
      maxSpawnedChildren: 2,
    });
    const parent = subTask({
      id: 'parent',
      role: 'backend',
      ownedPaths: ['a.ts'],
      depth: 0,
    });
    const plan = makePlan([parent]);
    const child = manager.spawnChild(plan, parent, {
      type: 'dependency_request',
      from: 'parent',
      requestedRole: 'database',
      objective: 'Check migrations',
      ownedPaths: ['db'],
    });
    expect(child).not.toBeNull();
    expect(child!.depth).toBe(1);

    const grandchild = manager.spawnChild(plan, child!, {
      type: 'dependency_request',
      from: child!.id,
      requestedRole: 'database',
      objective: 'too deep',
    });
    expect(grandchild).toBeNull();
  });

  it('11. cancellation via AbortSignal', async () => {
    const ac = new AbortController();
    const llm: LlmPort = {
      async complete() {
        ac.abort();
        await new Promise((r) => setTimeout(r, 20));
        return {
          modelId: 'mock',
          tokensUsed: 1,
          text: successTurn('a.ts', 'ok'),
        };
      },
    };
    const plan = makePlan([
      subTask({
        id: 'a',
        role: 'backend',
        ownedPaths: ['a.ts'],
        title: 'a',
        retryLimit: 0,
      }),
      subTask({
        id: 'b',
        role: 'backend',
        ownedPaths: ['b.ts'],
        title: 'b',
        retryLimit: 0,
      }),
    ]);
    const result = await runScheduler(plan, {
      llm,
      workspace: new InMemoryWorkspace({ 'a.ts': '', 'b.ts': '' }),
      bus: new ContextBus(),
      signal: ac.signal,
      enableSubagentLoop: true,
    });
    // At least one task should not complete cleanly after abort
    expect(
      result.ok === false ||
        plan.nodes.some(
          (n) => n.status === 'cancelled' || n.status === 'failed',
        ),
    ).toBe(true);
  });

  it('13. model policy preferred model is used', async () => {
    const models: string[] = [];
    const llm: LlmPort = {
      async complete(req) {
        models.push(req.modelId ?? 'none');
        return {
          modelId: req.modelId ?? 'fallback',
          tokensUsed: 3,
          text: successTurn('a.ts', 'ok'),
        };
      },
    };
    const plan = makePlan([
      subTask({
        id: 'a',
        role: 'frontend',
        ownedPaths: ['a.ts'],
        title: 'a',
        modelPolicy: {
          strategy: 'coding',
          preferredModels: ['deepseek/deepseek-v4-flash-0731'],
        },
      }),
    ]);
    await runScheduler(plan, {
      llm,
      workspace: new InMemoryWorkspace({ 'a.ts': '' }),
      bus: new ContextBus(),
      enableSubagentLoop: true,
    });
    expect(models[0]).toBe('deepseek/deepseek-v4-flash-0731');
  });

  it('14. aggregates cost/tokens on runtime result', async () => {
    const workspace = new InMemoryWorkspace({ 'src/a.ts': '1' });
    const llm: LlmPort = {
      async complete(req) {
        if (req.role === 'planner') {
          return {
            modelId: 'planner',
            tokensUsed: 10,
            text: JSON.stringify({
              projectSummary: 'x',
              nodes: [
                {
                  id: 'one',
                  title: 'one',
                  role: 'backend',
                  objective: 'Bump',
                  deps: [],
                  ownedPaths: ['src/a.ts'],
                  expectedOutput: 'ok',
                  estimatedTokens: 100,
                  recommendedTier: 'T2',
                  priority: 1,
                  retryLimit: 0,
                },
              ],
            }),
          };
        }
        if (req.role === 'worker') {
          return {
            modelId: 'worker',
            tokensUsed: 100,
            text: successTurn('src/a.ts', '2'),
          };
        }
        // verifier / integrator
        return {
          modelId: 'other',
          tokensUsed: 5,
          text: JSON.stringify({ items: [], summary: 'ok' }),
        };
      },
    };
    const engine = createRuntimeEngine({
      llm,
      workspace,
      edit: new InMemoryEditPort(workspace),
      enableVerification: false,
      enableSubagentLoop: true,
    });
    const result = await engine.run({ goal: 'Bump a', enableVerification: false });
    expect(result.usage).toBeDefined();
    expect(result.usage!.inputTokens + result.usage!.outputTokens).toBeGreaterThan(
      0,
    );
    expect(result.subagentResults?.length).toBeGreaterThan(0);
  });
});

describe('agent turn parsing', () => {
  it('parses fenced JSON', () => {
    const turn = parseAgentTurn('```json\n{"progress":"hi","result":{"status":"success","summary":"ok","filesCreated":[],"filesModified":[],"filesDeleted":[],"testsRun":[],"testsPassed":[],"testsFailed":[],"issues":[],"recommendations":[]}}\n```');
    expect(turn.progress).toBe('hi');
    expect(turn.result?.status).toBe('success');
  });

  it('parses needs_more_context', () => {
    const turn = parseAgentTurn(
      '{"needs_more_context":true,"requested_files":["src/auth/authMiddleware.ts"],"reason":"callback"}',
    );
    expect(turn.needs_more_context).toBe(true);
    expect(turn.requested_files).toEqual(['src/auth/authMiddleware.ts']);
  });
});

describe('orchestrator review tail', () => {
  it('appends tester and reviewer for multi-implementer plans', () => {
    const orch = createSubagentOrchestrator({ ensureReviewTail: true });
    const plan = makePlan([
      subTask({
        id: 'fe',
        role: 'frontend',
        ownedPaths: ['src/ui'],
      }),
      subTask({
        id: 'be',
        role: 'backend',
        ownedPaths: ['server'],
      }),
      subTask({
        id: 'db',
        role: 'database',
        ownedPaths: ['db'],
      }),
    ]);
    const next = orch.normalize(plan);
    expect(next.nodes.some((n) => n.role === 'tester')).toBe(true);
    expect(next.nodes.some((n) => n.role === 'reviewer')).toBe(true);
  });
});
