import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  classifyFastPath,
  isFastPathEnabled,
  tryFastPath,
} from '../src/fastpath/classifier.js';
import { InMemoryWorkspace, InMemoryEditPort } from '../src/ports.js';
import type { LlmCompleteRequest } from '../src/ports.js';

describe('classifyFastPath', () => {
  beforeEach(() => {
    delete process.env.SINGULARITY_FAST_PATH;
  });
  afterEach(() => {
    delete process.env.SINGULARITY_FAST_PATH;
  });

  it('kill-switch forces deep path', () => {
    process.env.SINGULARITY_FAST_PATH = '0';
    const d = classifyFastPath('rename this variable');
    expect(d.use).toBe(false);
    expect(d.reason).toBe('kill_switch');
    expect(isFastPathEnabled()).toBe(false);
  });

  it('trivial chat never takes the fast lane', () => {
    const d = classifyFastPath('hello');
    expect(d.use).toBe(false);
    expect(d.reason).toBe('trivial_chat');
  });

  it('explicit subagent / DAG requests go deep', () => {
    for (const goal of [
      'use subagents to explore the auth flow',
      'run the dag on this refactor',
      'parallel workers should handle this',
    ]) {
      expect(classifyFastPath(goal).reason).toBe('explicit_subagents');
    }
  });

  it('multi-file build goals go deep', () => {
    for (const goal of [
      'build a SaaS dashboard with billing',
      'implement oauth login and a landing page',
      'refactor src/a.ts and src/b.ts',
      'create app.ts, util.ts and index.css',
    ]) {
      expect(classifyFastPath(goal).use).toBe(false);
    }
  });

  it('blocking tool/engine asks go deep', () => {
    expect(classifyFastPath('run the tests please').use).toBe(false);
    expect(classifyFastPath('fix the stack trace in the console').use).toBe(false);
  });

  it('single-file edits take the fast lane', () => {
    const d = classifyFastPath('rename this variable to count');
    expect(d.use).toBe(true);

    const d2 = classifyFastPath('in utils.ts rename fetchUser to getUser');
    expect(d2.use).toBe(true);
    expect(d2.reason).toBe('single_file_edit');
  });

  it('localized imperative edits are FAST regardless of verb (Phase 13 P0)', () => {
    for (const goal of [
      'Fix this typo in utils.ts.',
      'Add a null check to parseInput.ts.',
      'Rename this local variable.',
      'Update this JSDoc.',
      'Fix this obvious bug in this function',
      'remove the unused import in src/a.ts',
      'change the error message string in config loader file loader.ts',
    ]) {
      const d = classifyFastPath(goal);
      expect(d.use, `${goal} → ${d.reason}`).toBe(true);
    }
  });

  it('risky scopes force DEEP even with small-edit wording', () => {
    for (const goal of [
      'Refactor authentication across the application',
      'Update the API and all consumers',
      'Migrate the database schema',
      'Refactor these three modules',
      'Change the public API',
      'Add a new payment flow',
      'Change deployment configuration',
      'Make this production-safe',
      'fix the typo in the auth login handler',
      'update a dependency package.json',
    ]) {
      const d = classifyFastPath(goal);
      expect(d.use, `${goal} → ${d.reason}`).toBe(false);
    }
  });

  it('explicit planning / project-wide verification asks go deep', () => {
    for (const goal of ['plan this refactor first', 'verify this across the whole project']) {
      expect(classifyFastPath(goal).reason).toBe('planning_or_verification_requested');
    }
  });

  it('short questions take the fast lane', () => {
    const d = classifyFastPath('what does debounce do?');
    expect(d.use).toBe(true);
    expect(d.reason).toBe('short_question');
  });

  it('very long goals are uncertain ⇒ deep', () => {
    const long = 'rename this variable ' + 'with lots of extra detail '.repeat(60);
    const d = classifyFastPath(long);
    expect(long.length).toBeGreaterThan(400);
    expect(d.use).toBe(false);
    expect(d.reason).toBe('goal_too_long_uncertain');
  });

  it('classifyComplexity maps lanes deterministically', async () => {
    const { classifyComplexity } = await import('../src/fastpath/classifier.js');
    expect(classifyComplexity('Fix this typo in utils.ts.')).toBe('fast');
    // Small bug fix, no file mention, no risk/build signal ⇒ medium.
    expect(classifyComplexity('Fix the off-by-one error in the sweep timer logic.')).toBe('medium');
    expect(classifyComplexity('Migrate the database schema')).toBe('deep');
    expect(classifyComplexity('use subagents to explore the auth flow')).toBe('deep');
  });
});

describe('tryFastPath', () => {
  const mkLlm = (text: string) => ({
    complete: async (_req: LlmCompleteRequest) => ({
      text,
      modelId: 'test-model',
      tokensUsed: 10,
    }),
  });

  it('applies diffs and reports success', async () => {
    const ws = new InMemoryWorkspace({ 'src/a.ts': 'const a = 1;' });
    const out = await tryFastPath({
      goal: 'in src/a.ts rename a to b',
      llm: mkLlm(
        JSON.stringify({
          summary: 'renamed',
          diffs: [{ path: 'src/a.ts', newContent: 'const b = 1;' }],
        }),
      ),
      workspace: ws,
      edit: new InMemoryEditPort(ws),
    });
    expect(out.ranFast).toBe(true);
    expect(out.result?.ok).toBe(true);
    expect(out.result?.fastPath).toBe(true);
    expect(await ws.readFile('src/a.ts')).toBe('const b = 1;');
  });

  it('escalates when output is empty', async () => {
    const ws = new InMemoryWorkspace({});
    const out = await tryFastPath({
      goal: 'tiny task',
      llm: mkLlm(JSON.stringify({})),
      workspace: ws,
      edit: new InMemoryEditPort(ws),
    });
    expect(out.ranFast).toBe(false);
    expect(out.escalated).toBe(true);
  });

  it('escalates on invented paths (file missing, not marked new)', async () => {
    const ws = new InMemoryWorkspace({});
    const out = await tryFastPath({
      goal: 'small fix',
      llm: mkLlm(
        JSON.stringify({
          summary: 'x',
          diffs: [{ path: 'nope/missing.ts', newContent: 'hello' }],
        }),
      ),
      workspace: ws,
      edit: new InMemoryEditPort(ws),
    });
    expect(out.ranFast).toBe(false);
    expect(out.escalated).toBe(true);
  });

  it('allows genuinely new files', async () => {
    const ws = new InMemoryWorkspace({});
    const out = await tryFastPath({
      goal: 'create src/new-file.ts with a greeting',
      llm: mkLlm(
        JSON.stringify({
          summary: 'created',
          diffs: [{ path: 'src/new-file.ts', newContent: 'export const hi = 1;', isNew: true }],
        }),
      ),
      workspace: ws,
      edit: new InMemoryEditPort(ws),
    });
    expect(out.ranFast).toBe(true);
    expect(await ws.readFile('src/new-file.ts')).toBe('export const hi = 1;');
  });

  it('escalates on LLM error (deep path retries)', async () => {
    const ws = new InMemoryWorkspace({});
    const out = await tryFastPath({
      goal: 'small fix',
      llm: {
        complete: async () => {
          throw new Error('gateway down');
        },
      },
      workspace: ws,
      edit: new InMemoryEditPort(ws),
    });
    expect(out.ranFast).toBe(false);
    expect(out.escalated).toBe(true);
  });
});
