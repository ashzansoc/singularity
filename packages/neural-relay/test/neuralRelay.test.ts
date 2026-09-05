import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyContextExpansion,
  buildDeepSeekContext,
  confidenceAction,
  contextReduction,
  costUsd,
  deterministicResolution,
  expandFromVerifierFailure,
  FilesystemRepoIndex,
  isNeuralRelayEnabled,
  OpenRouterNemotronProvider,
  parseContextResolution,
  pathsFromFailureOutput,
  prepareNeuralRelayContext,
  rankCandidates,
  readNeuralRelayFlags,
  renderDeepSeekPrompt,
  type AnalyzeContextResult,
  type ContextIntelligenceModel,
} from '../src/index.js';
import { deterministicRetrieve, semanticRetrieve } from '../src/retrieval/pipeline.js';

const OAUTH_FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../benchmark/fixtures/oauth-app',
);

function writeFixture(root: string): void {
  const auth = join(root, 'src', 'auth');
  const tests = join(root, 'tests');
  mkdirSync(auth, { recursive: true });
  mkdirSync(join(root, 'src', 'routes'), { recursive: true });
  mkdirSync(tests, { recursive: true });
  writeFileSync(
    join(auth, 'AuthProvider.tsx'),
    `export function AuthProvider() { return login(); }
export function login() { return signInWithGoogle(); }
import { signInWithGoogle } from './google';
`,
    'utf8',
  );
  writeFileSync(
    join(auth, 'google.ts'),
    `export function signInWithGoogle() { return 'google-oauth'; }
export const GOOGLE_CLIENT_ID = 'x';
`,
    'utf8',
  );
  writeFileSync(
    join(auth, 'authMiddleware.ts'),
    `export function authMiddleware() { return 'callback'; }\n`,
    'utf8',
  );
  writeFileSync(
    join(root, 'src', 'routes', 'AppRouter.tsx'),
    `import { AuthProvider } from '../auth/AuthProvider';
export function AppRouter() { return AuthProvider(); }
`,
    'utf8',
  );
  writeFileSync(
    join(tests, 'auth.test.ts'),
    `import { signInWithGoogle } from '../src/auth/google';
test('google', () => { signInWithGoogle(); });
`,
    'utf8',
  );
  writeFileSync(join(root, 'README.md'), '# fixture\n', 'utf8');
  writeFileSync(
    join(root, 'src', 'unrelated.ts'),
    `export function noise() {\n${'  return 1;\n'.repeat(400)}}\n`,
    'utf8',
  );
}

function mockModel(
  resolution: ReturnType<typeof deterministicResolution>,
  source: AnalyzeContextResult['source'] = 'llm',
): ContextIntelligenceModel {
  return {
    id: 'mock',
    async analyzeContext() {
      return {
        resolution,
        source,
        inputTokens: 100,
        outputTokens: 50,
        ttftMs: 10,
        tokensPerSecond: 80,
        latencyMs: 12,
        raw: JSON.stringify(resolution),
      };
    },
  };
}

const tmpDirs: string[] = [];
afterEach(() => {
  delete process.env.SINGULARITY_NEURAL_RELAY;
  delete process.env.NEURAL_RELAY_ENABLED;
  delete process.env.NEURAL_RELAY_MODE;
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe('flags', () => {
  it('is enabled by default', () => {
    expect(isNeuralRelayEnabled()).toBe(true);
    expect(readNeuralRelayFlags().enabled).toBe(true);
    expect(readNeuralRelayFlags().mode).toBe('NEURAL_RELAY_ITERATIVE');
  });

  it('disables via SINGULARITY_NEURAL_RELAY=0', () => {
    process.env.SINGULARITY_NEURAL_RELAY = '0';
    expect(isNeuralRelayEnabled()).toBe(false);
    expect(readNeuralRelayFlags().enabled).toBe(false);
  });

  it('enables via SINGULARITY_NEURAL_RELAY or NEURAL_RELAY_ENABLED', () => {
    process.env.SINGULARITY_NEURAL_RELAY = 'true';
    expect(isNeuralRelayEnabled()).toBe(true);
    expect(readNeuralRelayFlags().mode).toBe('NEURAL_RELAY_ITERATIVE');
  });
});

describe('schema parse', () => {
  it('parses fenced JSON and think tags', () => {
    const raw = `<think>nope</think>\n\`\`\`json\n{"task_understanding":"t","relevant_files":[{"path":"a.ts","reason":"r","priority":1}],"relevant_symbols":["Auth"],"dependencies_to_inspect":[],"missing_context":[],"confidence":0.91}\n\`\`\``;
    const parsed = parseContextResolution(raw, 't');
    expect(parsed?.confidence).toBe(0.91);
    expect(parsed?.relevant_files[0]?.path).toBe('a.ts');
  });

  it('returns undefined on garbage', () => {
    expect(parseContextResolution('not json', 't')).toBeUndefined();
  });
});

describe('confidence', () => {
  const flags = { confidenceHigh: 0.65, confidenceLow: 0.25 };
  it('routes by threshold', () => {
    expect(confidenceAction(0.9, flags)).toBe('use_selected');
    expect(confidenceAction(0.5, flags)).toBe('retrieve_more');
    expect(confidenceAction(0.2, flags)).toBe('fallback_broader');
  });
});

describe('retrieval + builder', () => {
  it('indexes oauth files and ranks auth candidates', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nr-idx-'));
    tmpDirs.push(root);
    writeFixture(root);
    const index = new FilesystemRepoIndex(root);
    const paths = index.listFileMetadata().map((f) => f.path);
    expect(paths.some((p) => p.includes('google.ts'))).toBe(true);
    const detHits = index.searchFilename('google');
    expect(detHits.length).toBeGreaterThan(0);
    const [d, sem] = await Promise.all([
      deterministicRetrieve(index, 'Google OAuth Apple Sign-In'),
      Promise.resolve(semanticRetrieve(index, 'Google OAuth')),
    ]);
    expect(d.filename.length + d.symbol.length + d.keyword.length).toBeGreaterThan(0);
    const ranked = rankCandidates(index, d, sem, { task: 'Google OAuth', limit: 50 });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.length).toBeLessThanOrEqual(50);
    expect(ranked.some((c) => c.path.includes('auth'))).toBe(true);
  });

  it('caps candidates at 50', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nr-cap-'));
    tmpDirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    for (let i = 0; i < 80; i++) {
      writeFileSync(join(root, 'src', `mod${i}.ts`), `export const v${i} = ${i};\n`, 'utf8');
    }
    const index = new FilesystemRepoIndex(root);
    const d = await deterministicRetrieve(index, 'mod export const');
    const sem = semanticRetrieve(index, 'mod export', 80);
    const ranked = rankCandidates(index, d, sem, { task: 'mod export', limit: 50 });
    expect(ranked.length).toBeLessThanOrEqual(50);
  });

  it('builder omits unselected files and keeps stable prefix', () => {
    const root = mkdtempSync(join(tmpdir(), 'nr-b-'));
    tmpDirs.push(root);
    writeFixture(root);
    const index = new FilesystemRepoIndex(root);
    const built = buildDeepSeekContext({
      task: 'replace google oauth',
      resolution: deterministicResolution('replace google oauth', [
        'src/auth/google.ts',
        'src/auth/AuthProvider.tsx',
      ]),
      index,
      projectInstructions: 'PROJECT INSTRUCTIONS',
    });
    expect(built.stablePrefix).toContain('PROJECT INSTRUCTIONS');
    expect(built.filesUsed).toContain('src/auth/google.ts');
    expect(built.relevantBlock).not.toContain('# fixture');
    const again = buildDeepSeekContext({
      task: 'other',
      resolution: deterministicResolution('other', ['src/auth/google.ts']),
      index,
      projectInstructions: 'PROJECT INSTRUCTIONS',
    });
    expect(again.stablePrefix).toBe(built.stablePrefix);
    expect(again.promptCacheKey).toBe(built.promptCacheKey);
    const prompt = renderDeepSeekPrompt(built);
    expect(prompt.indexOf(built.stablePrefix)).toBe(0);
  });
});

describe('orchestrator', () => {
  it('is a no-op when disabled', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nr-off-'));
    writeFixture(root);
    const index = new FilesystemRepoIndex(root);
    const res = await prepareNeuralRelayContext({
      task: 'x',
      index,
      flags: { enabled: false },
    });
    expect(res.usedRelay).toBe(false);
    expect(res.promptBlock).toBe('');
    expect(res.mode).toBe('BASELINE');
  });

  it('uses Nemotron selection and records egress', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nr-on-'));
    writeFixture(root);
    const index = new FilesystemRepoIndex(root);
    const resolution = {
      task_understanding: 'Replace Google OAuth with Apple Sign-In',
      relevant_files: [
        { path: 'src/auth/AuthProvider.tsx', reason: 'provider', priority: 1 },
        { path: 'src/auth/google.ts', reason: 'google impl', priority: 1 },
        { path: 'tests/auth.test.ts', reason: 'tests', priority: 2 },
      ],
      relevant_symbols: ['AuthProvider', 'signInWithGoogle'],
      dependencies_to_inspect: [],
      missing_context: [],
      confidence: 0.91,
    };
    const res = await prepareNeuralRelayContext({
      task: 'Find the Google OAuth implementation and replace it with Apple Sign-In',
      index,
      flags: { enabled: true, mode: 'NEURAL_RELAY' },
      model: mockModel(resolution),
    });
    expect(res.usedRelay).toBe(true);
    expect(res.promptBlock).toContain('src/auth/google.ts');
    expect(res.promptBlock).toContain('signInWithGoogle');
    expect(res.experiment.egress.some((e) => e.role === 'CONTEXT_INTELLIGENCE')).toBe(true);
    expect(res.experiment.egress.some((e) => e.role === 'CODING')).toBe(true);
    expect(res.experiment.context_reduction).toBeGreaterThan(0);
    expect(res.built!.filesUsed.length).toBeLessThan(index.listFileMetadata().length);
  });

  it('retries invalid JSON then falls back to deterministic', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nr-bad-'));
    writeFixture(root);
    const index = new FilesystemRepoIndex(root);
    let calls = 0;
    const model: ContextIntelligenceModel = {
      id: 'bad',
      async analyzeContext() {
        calls += 1;
        return {
          resolution: deterministicResolution('t', []),
          source: 'error',
          inputTokens: 1,
          outputTokens: 0,
          ttftMs: 1,
          tokensPerSecond: 0,
          latencyMs: 1,
          raw: 'not-json',
        };
      },
    };
    const res = await prepareNeuralRelayContext({
      task: 'Google OAuth',
      index,
      flags: { enabled: true, mode: 'NEURAL_RELAY' },
      model,
    });
    expect(calls).toBe(2);
    expect(res.fallbackReason).toBeUndefined();
    expect(res.resolution?.relevant_files.length).toBeGreaterThan(0);
  });

  it('falls back when Nemotron is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nr-un-'));
    writeFixture(root);
    const index = new FilesystemRepoIndex(root);
    const model: ContextIntelligenceModel = {
      id: 'down',
      async analyzeContext() {
        return {
          resolution: deterministicResolution('t', []),
          source: 'unavailable',
          inputTokens: 0,
          outputTokens: 0,
          ttftMs: 0,
          tokensPerSecond: 0,
          latencyMs: 0,
        };
      },
    };
    const res = await prepareNeuralRelayContext({
      task: 'Google OAuth',
      index,
      flags: { enabled: true, mode: 'NEURAL_RELAY' },
      model,
    });
    expect(res.usedRelay).toBe(true);
    expect(res.fallbackReason).toBe('nemotron_unavailable');
  });

  it('uses LLM file picks even when confidence is low', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nr-low-'));
    writeFixture(root);
    const index = new FilesystemRepoIndex(root);
    const resolution = {
      task_understanding: 'oauth',
      relevant_files: [
        { path: 'src/auth/google.ts', reason: 'impl', priority: 1 },
        { path: 'tests/auth.test.ts', reason: 'tests', priority: 2 },
      ],
      relevant_symbols: [],
      dependencies_to_inspect: [],
      missing_context: [],
      confidence: 0.45,
    };
    const res = await prepareNeuralRelayContext({
      task: 'Google OAuth',
      index,
      flags: { enabled: true, mode: 'NEURAL_RELAY' },
      model: mockModel(resolution),
    });
    expect(res.usedRelay).toBe(true);
    expect(res.fallbackReason).toBeUndefined();
    expect(res.promptBlock).toContain('src/auth/google.ts');
    expect(res.built!.filesUsed.length).toBeLessThanOrEqual(10);
  });

  it('appends expansion without rewriting stable prefix', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nr-ex-'));
    writeFixture(root);
    const index = new FilesystemRepoIndex(root);
    const resolution = {
      task_understanding: 'oauth',
      relevant_files: [{ path: 'src/auth/google.ts', reason: 'impl', priority: 1 }],
      relevant_symbols: [],
      dependencies_to_inspect: [],
      missing_context: [],
      confidence: 0.9,
    };
    const res = await prepareNeuralRelayContext({
      task: 'oauth',
      index,
      flags: { enabled: true, mode: 'NEURAL_RELAY_ITERATIVE' },
      model: mockModel(resolution),
    });
    const prefix = res.built!.stablePrefix;
    const expanded = applyContextExpansion(
      res,
      index,
      ['src/auth/authMiddleware.ts'],
      'OAuth callback handling may depend on this middleware.',
    );
    expect(expanded.built!.stablePrefix).toBe(prefix);
    expect(expanded.built!.promptCacheKey).toBe(res.built!.promptCacheKey);
    expect(expanded.built!.relevantBlock).toContain('authMiddleware.ts');
    expect(expanded.experiment.context_expansions).toBe(1);
  });

  it('expands from verifier failure output without rewriting the prefix', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nr-vf-'));
    tmpDirs.push(root);
    writeFixture(root);
    const index = new FilesystemRepoIndex(root);
    const resolution = {
      task_understanding: 'oauth',
      relevant_files: [{ path: 'src/auth/google.ts', reason: 'impl', priority: 1 }],
      relevant_symbols: [],
      dependencies_to_inspect: [],
      missing_context: [],
      confidence: 0.9,
    };
    const res = await prepareNeuralRelayContext({
      task: 'oauth',
      index,
      flags: { enabled: true, mode: 'NEURAL_RELAY_ITERATIVE' },
      model: mockModel(resolution),
    });
    const next = expandFromVerifierFailure(
      res.built!,
      index,
      'FAIL tests/auth.test.ts\nError in src/auth/authMiddleware.ts: expected callback',
    );
    expect(next.stablePrefix).toBe(res.built!.stablePrefix);
    expect(next.relevantBlock).toContain('authMiddleware.ts');
    expect(
      pathsFromFailureOutput('src/auth/authMiddleware.ts failed', [
        'src/auth/authMiddleware.ts',
      ]),
    ).toEqual(['src/auth/authMiddleware.ts']);
  });
});

describe('oauth fixture', () => {
  it('selects auth files for the Apple Sign-In task', async () => {
    const index = new FilesystemRepoIndex(OAUTH_FIXTURE);
    const paths = index.listFileMetadata().map((f) => f.path);
    expect(paths).toContain('src/auth/google.ts');
    expect(paths).toContain('src/auth/AuthProvider.ts');
    const d = await deterministicRetrieve(
      index,
      'Find the Google OAuth implementation and replace it with Apple Sign-In',
    );
    expect(d.merged.some((f) => f.path.includes('auth'))).toBe(true);
    const resolution = deterministicResolution(
      'Apple Sign-In',
      ['src/auth/AuthProvider.ts', 'src/auth/google.ts', 'tests/auth.test.ts'],
    );
    resolution.confidence = 0.91;
    const res = await prepareNeuralRelayContext({
      task: 'Find the Google OAuth implementation and replace it with Apple Sign-In',
      index,
      flags: { enabled: true, mode: 'NEURAL_RELAY' },
      model: mockModel(resolution),
    });
    expect(res.promptBlock).toContain('signInWithGoogle');
    expect(res.promptBlock).not.toMatch(/unrelated-module/);
    expect(res.experiment.egress.find((e) => e.role === 'CONTEXT_INTELLIGENCE')?.files.length).toBeGreaterThan(0);
    expect(res.experiment.egress.find((e) => e.role === 'CODING')?.files).toEqual(
      expect.arrayContaining(['src/auth/google.ts', 'src/auth/AuthProvider.ts']),
    );
  });
});

describe('OpenRouterNemotronProvider', () => {
  it('posts json_schema to OpenRouter and parses the resolution', async () => {
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('nvidia/nemotron-3-nano-30b-a3b:free');
      expect(body.response_format.type).toBe('json_schema');
      expect(body.response_format.json_schema.name).toBe('context_resolution');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer test-key');
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  task_understanding: 'oauth',
                  relevant_files: [
                    { path: 'src/auth/google.ts', reason: 'impl', priority: 1 },
                  ],
                  relevant_symbols: ['signInWithGoogle'],
                  dependencies_to_inspect: [],
                  missing_context: [],
                  confidence: 0.92,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 80, completion_tokens: 20 },
        }),
        { status: 200 },
      );
    };
    const provider = new OpenRouterNemotronProvider({
      apiKey: 'test-key',
      fetch: fetchFn as unknown as typeof fetch,
    });
    const result = await provider.analyzeContext({
      task: 'replace google oauth',
      candidates: [
        {
          path: 'src/auth/google.ts',
          language: 'typescript',
          size: 10,
          summary: 'google oauth',
          symbols: ['signInWithGoogle'],
          imports: [],
          importedBy: [],
          tests: [],
          excerpt: 'export function signInWithGoogle',
          score: 1,
          reasons: ['filename'],
        },
      ],
    });
    expect(result.source).toBe('llm');
    expect(result.resolution.relevant_files[0]?.path).toBe('src/auth/google.ts');
    expect(result.inputTokens).toBe(80);
  });

  it('returns unavailable when no API key is set', async () => {
    const prevOr = process.env.OPENROUTER_API_KEY;
    const prevDec = process.env.SINGULARITY_DECISION_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.SINGULARITY_DECISION_API_KEY;
    const provider = new OpenRouterNemotronProvider();
    const result = await provider.analyzeContext({ task: 'x', candidates: [] });
    if (prevOr) {
      process.env.OPENROUTER_API_KEY = prevOr;
    }
    if (prevDec) {
      process.env.SINGULARITY_DECISION_API_KEY = prevDec;
    }
    expect(result.source).toBe('unavailable');
  });
});

describe('metrics', () => {
  it('computes reduction and free nemotron cost', () => {
    expect(contextReduction(500_000, 40_000)).toBeCloseTo(0.92);
    expect(costUsd('nvidia/nemotron-3-nano-30b-a3b:free', 72_000, 1_000)).toBe(0);
    expect(costUsd('deepseek/deepseek-v4-flash-0731', 40_000, 0)).toBeGreaterThan(0);
  });
});
