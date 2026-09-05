import { describe, expect, it } from 'vitest';
import {
  createRuntimeEngine,
  InMemoryEditPort,
  InMemoryWorkspace,
  type LlmPort,
} from '../src/index.js';

/**
 * End-to-end smoke with a fixture mock LLM (no network).
 */
describe('runtime smoke (mock LLM)', () => {
  it('plans, schedules parallel workers, and integrates', async () => {
    const workspace = new InMemoryWorkspace({
      'src/a.ts': 'export const a = 1;',
      'src/b.ts': 'export const b = 1;',
      'src/index.ts': "export { a } from './a.js';\n",
    });
    workspace.setNeighbors('src/a.ts', ['src/index.ts']);
    workspace.setNeighbors('src/b.ts', ['src/index.ts']);

    const llm: LlmPort = {
      async complete(req) {
        if (req.role === 'planner') {
          return {
            modelId: 'planner-mock',
            tokensUsed: 50,
            text: JSON.stringify({
              projectSummary: 'tiny lib',
              nodes: [
                {
                  id: 'task-a',
                  title: 'Bump a',
                  deps: [],
                  ownedPaths: ['src/a.ts'],
                  expectedOutput: 'a = 2',
                  estimatedTokens: 200,
                  recommendedTier: 'T2',
                  priority: 1,
                  retryLimit: 1,
                },
                {
                  id: 'task-b',
                  title: 'Bump b',
                  deps: [],
                  ownedPaths: ['src/b.ts'],
                  expectedOutput: 'b = 2',
                  estimatedTokens: 200,
                  recommendedTier: 'T2',
                  priority: 1,
                  retryLimit: 1,
                },
                {
                  id: 'task-index',
                  title: 'Re-export b',
                  deps: ['task-a', 'task-b'],
                  ownedPaths: ['src/index.ts'],
                  expectedOutput: 'export a and b',
                  estimatedTokens: 200,
                  recommendedTier: 'T3',
                  priority: 2,
                  retryLimit: 1,
                },
              ],
            }),
          };
        }

        if (req.role === 'worker') {
          if (req.prompt.includes('Task: Bump a')) {
            return {
              modelId: 'worker-a',
              tokensUsed: 10,
              text: JSON.stringify({
                diffs: [
                  {
                    path: 'src/a.ts',
                    newContent: 'export const a = 2;',
                  },
                ],
              }),
            };
          }
          if (req.prompt.includes('Task: Bump b')) {
            return {
              modelId: 'worker-b',
              tokensUsed: 10,
              text: JSON.stringify({
                diffs: [
                  {
                    path: 'src/b.ts',
                    newContent: 'export const b = 2;',
                  },
                ],
              }),
            };
          }
          return {
            modelId: 'worker-index',
            tokensUsed: 10,
            text: JSON.stringify({
              diffs: [
                {
                  path: 'src/index.ts',
                  newContent:
                    "export { a } from './a.js';\nexport { b } from './b.js';\n",
                },
              ],
            }),
          };
        }

        return {
          modelId: 'integrator',
          tokensUsed: 5,
          text: JSON.stringify({ diffs: [], summary: 'clean' }),
        };
      },
    };

    const events: string[] = [];
    const engine = createRuntimeEngine({
      llm,
      workspace,
      edit: new InMemoryEditPort(workspace),
      concurrency: 2,
      // The fixture edits a 3-file public-API surface (index barrel) — the
      // Phase-13 risk floors classify that HIGH, and HIGH with no wired
      // typecheck refuses to look vacuously green. Provide a passing one.
      tools: {
        typecheck: async () => ({ ok: true, output: '0 errors' }),
      },
      onEvent: (e) => events.push(e.kind),
    });

    const result = await engine.run({
      goal: 'Bump a and b and re-export',
    });

    expect(result.ok).toBe(true);
    expect(result.plan.nodes).toHaveLength(3);
    expect(await workspace.readFile('src/a.ts')).toBe('export const a = 2;');
    expect(await workspace.readFile('src/b.ts')).toBe('export const b = 2;');
    expect(await workspace.readFile('src/index.ts')).toContain("from './b.js'");
    expect(events).toContain('plan_created');
    expect(events).toContain('task_done');
    expect(events).toContain('integrate_done');
    expect(events).toContain('run_done');
  });
});
