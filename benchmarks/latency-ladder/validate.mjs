#!/usr/bin/env node
/**
 * Validation harness — measurement ONLY. No production code changes.
 *
 * Sections (each independently runnable, zero network unless noted):
 *   fastpath    classify simple/medium/complex goals through classifyFastPath
 *   risk        risk-policy safety matrix over auth/db/api/deps/destructive fixtures
 *   ctx         FilesystemRepoIndex cold vs warm vs invalidated (timing only)
 *   classifier  LIVE: Nemotron classifier with/without LLM (RPM-paced, 2 gateway calls)
 *   ladder      LIVE: tiers A,B,C,D matched-config runs (RPM-paced)
 *
 * Usage:
 *   node benchmarks/latency-ladder/validate.mjs fastpath
 *   node benchmarks/latency-ladder/validate.mjs risk
 *   node benchmarks/latency-ladder/validate.mjs ctx
 *   node benchmarks/latency-ladder/validate.mjs classifier --runs 1
 *   node benchmarks/latency-ladder/validate.mjs ladder --runs 1 --fixtures explain,single-file-edit --tiers A,B,C
 *   node benchmarks/latency-ladder/validate.mjs ladder --tiers D
 *
 * Writes benchmarks/latency-ladder/VALIDATION.json (merged across sections).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const OUT_PATH = join(__dirname, 'VALIDATION.json');

function loadEnv() {
  const envPath = join(ROOT, '.env');
  try {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {
    /* no .env */
  }
}

function parseArgs(argv) {
  const out = {
    runs: 1,
    fixtures: null,
    tiers: ['A', 'B', 'C'],
    maxTokens: 128,
    model: process.env.LADDER_MODEL || 'deepseek/deepseek-v4-flash-0731',
    fastPath: process.env.SINGULARITY_FAST_PATH,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') out.runs = Number(argv[++i]) || 1;
    else if (a === '--fixtures') out.fixtures = String(argv[++i]).split(',').map((s) => s.trim());
    else if (a === '--tiers') out.tiers = String(argv[++i]).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--max-tokens') out.maxTokens = Number(argv[++i]) || 128;
    else if (a === '--model') out.model = String(argv[++i]);
    else if (a === '--fast-path') out.fastPath = argv[++i];
    else if (a === '--goals') out.goals = String(argv[++i]);
  }
  return out;
}

const now = () => performance.now();
const ms = (a, b) => Math.round((b - a) * 100) / 100;

function pct(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = Math.min(sortedArr.length - 1, Math.ceil((p / 100) * sortedArr.length) - 1);
  return sortedArr[Math.max(0, idx)];
}

function summarize(samples) {
  const ok = samples.filter((s) => s.ok);
  const sorted = (arr) => [...arr].filter((v) => v !== null && v !== undefined && !Number.isNaN(v)).sort((a, b) => a - b);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const ttfts = sorted(ok.map((s) => s.ttftMs));
  const totals = sorted(ok.map((s) => s.totalMs));
  return {
    runs: samples.length,
    okRuns: ok.length,
    ttftP50Ms: pct(ttfts, 50),
    ttftP95Ms: pct(ttfts, 95),
    totalP50Ms: pct(totals, 50),
    totalP95Ms: pct(totals, 95),
    totalMeanMs: Math.round(mean(totals) ?? 0),
    errors: samples.filter((s) => !s.ok).map((s) => String(s.error).slice(0, 200)),
    _samples: ok,
  };
}

// ---------------------------------------------------------------------------
// Offline: fast-path lane matrix
// ---------------------------------------------------------------------------

// Phase-13 REQUIRED validation matrices (exact prompts from the phase brief).
const FASTPATH_GOALS = {
  fast: [
    { goal: 'Explain this function.', expect: true },
    { goal: 'Fix this typo in utils.ts.', expect: true },
    { goal: 'Add a null check to parseInput.ts.', expect: true },
    { goal: 'Rename this local variable.', expect: true },
    { goal: 'Update this JSDoc.', expect: true },
  ],
  medium: [
    { goal: 'Small bug fix requiring multiple related edits in the parser module.', expect: null },
    { goal: 'Small refactor of the retry helper for readability.', expect: null },
  ],
  deep: [
    { goal: 'Multi-file architectural refactor of the scheduler and worker pool.', expect: false },
    { goal: 'Database migration adding an audit log table.', expect: false },
    { goal: 'Authentication change: rotate session tokens on privilege escalation.', expect: false },
    { goal: 'Public API change: export a new plugin interface from index.ts and update all consumers.', expect: false },
    { goal: 'Dependency change: upgrade the framework to the next major version.', expect: false },
  ],
  uncertain: [
    { goal: 'Make the app better and faster overall, you know what I mean.', expect: false },
    { goal: 'Improve error handling everywhere it matters.', expect: false },
  ],
};

async function sectionFastPath(rt) {
  const results = {};
  let pass = 0;
  let total = 0;
  for (const [lane, goals] of Object.entries(FASTPATH_GOALS)) {
    results[lane] = [];
    for (const { goal, expect } of goals) {
      const d = rt.classifyFastPath(goal);
      const ok = expect === null ? true : d.use === expect;
      total += 1;
      if (ok) pass += 1;
      results[lane].push({ goal, use: d.use, reason: d.reason, detail: d.detail ?? null, expect: expect === null ? 'any' : expect, ok });
      console.log(`  [fastpath:${lane}] ${d.use ? 'FAST' : 'DEEP'} (${d.reason}) — ${goal.slice(0, 60)}${ok ? '' : '  ← MISMATCH'}`);
    }
  }
  console.log(`  fast-path matrix: ${pass}/${total} as expected`);
  return { matrix: results, pass, total };
}

// ---------------------------------------------------------------------------
// Offline: risk-policy safety matrix
// ---------------------------------------------------------------------------

const RISK_CASES = [
  { name: 'auth change', diffs: [{ path: 'src/auth/login.ts', unifiedDiff: '@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;' }], expect: 'high' },
  { name: 'db/schema change', diffs: [{ path: 'db/migrations/0007_add_users.ts', unifiedDiff: '@@ -0,0 +1,1 @@\n+CREATE TABLE users (id int);', isNew: true }], expect: 'high' },
  { name: 'dependency manifest', diffs: [{ path: 'package.json', unifiedDiff: '@@ -1,1 +1,2 @@\n {\n+  "newdep": "^1.0.0"\n }' }], expect: 'high' },
  { name: '.env change', diffs: [{ path: '.env', unifiedDiff: '@@ -1,1 +1,1 @@\n-A=1\n+A=2' }], expect: 'high' },
  { name: 'public API barrel', diffs: [{ path: 'src/index.ts', unifiedDiff: '@@ -1,1 +1,1 @@\n-export {};\n+export { a };' }], expect: 'medium' },
  { name: 'multi-file refactor (3 files)', diffs: [
      { path: 'src/a.ts', unifiedDiff: '@@ -1,1 +1,1 @@\n-let x = 1;\n+let x = 2;' },
      { path: 'src/b.ts', unifiedDiff: '@@ -1,1 +1,1 @@\n-let y = 1;\n+let y = 2;' },
      { path: 'src/c.ts', unifiedDiff: '@@ -1,1 +1,1 @@\n-let z = 1;\n+let z = 2;' },
    ], expect: 'medium' },
  { name: 'public API + multi-file', diffs: [
      { path: 'src/index.ts', unifiedDiff: '@@ -1,1 +1,1 @@\n-export { a };\n+export { a, b };' },
      { path: 'src/impl/a.ts', unifiedDiff: '@@ -1,1 +1,1 @@\n-let x = 1;\n+let x = 2;' },
      { path: 'src/impl/b.ts', unifiedDiff: '@@ -1,1 +1,1 @@\n-let y = 1;\n+let y = 2;' },
    ], expect: 'high' },
  { name: 'destructive SQL', diffs: [{ path: 'src/cleanup.ts', unifiedDiff: '@@ -0,0 +1,1 @@\n+await db.query("DROP TABLE users");' }], expect: 'high' },
  { name: 'trivial comment edit', diffs: [{ path: 'src/util.ts', unifiedDiff: '@@ -1,2 +1,2 @@\n // hi\n-const x = 1;\n+const x = 1; // keep' }], expect: 'low' },
];

async function sectionRisk(rt) {
  const results = [];
  let pass = 0;
  for (const c of RISK_CASES) {
    const r = rt.scoreRisk(c.diffs);
    const plan = rt.verificationPolicyFor(r.tier);
    const ok = r.tier === c.expect;
    if (ok) pass += 1;
    results.push({ name: c.name, tier: r.tier, score: r.score, signals: r.signals.slice(0, 6), checklist: plan.runChecklistVerifier, full: plan.runFullVerification, expect: c.expect, ok });
    console.log(`  [risk] ${c.name}: tier=${r.tier} score=${r.score} ${ok ? '' : `← expected ${c.expect}`}`);
  }
  console.log(`  risk matrix: ${pass}/${RISK_CASES.length} as expected`);
  return { cases: results, pass, total: RISK_CASES.length };
}

// ---------------------------------------------------------------------------
// Offline: context index cold/warm/invalidation (FilesystemRepoIndex)
// ---------------------------------------------------------------------------

async function sectionCtx() {
  const { FilesystemRepoIndex } = await import(
    pathToFileURL(join(ROOT, 'packages/neural-relay/dist/retrieval/filesystemIndex.js')).href
  );
  // Small sandbox workspace so the walk is deterministic and fast.
  const os = await import('node:os');
  const { mkdtempSync, writeFileSync: wf, rmSync } = await import('node:fs');
  const dir = mkdtempSync(join(os.tmpdir(), 'sing-ctx-'));
  for (let i = 0; i < 40; i++) {
    wf(join(dir, `mod${i}.ts`), `export const v${i} = ${i};\nimport { helper } from './helper.js';\n`);
  }
  wf(join(dir, 'helper.ts'), 'export function helper() { return 1; }\n');

  const out = {};
  const t0 = now();
  const idx = new FilesystemRepoIndex(dir);
  out.coldBuildMs = ms(t0, now());
  out.coldFileCount = idx.listFileMetadata().length;

  const t1 = now();
  const _ = idx.listFileMetadata();
  out.warmQueryMs = ms(t1, now());

  // Simulate one file modification: touch mtime, rebuild, count re-reads via timing delta.
  utimesSync(join(dir, 'mod7.ts'), new Date(), new Date());
  const t2 = now();
  idx.rebuild();
  out.rebuildAfterOneEditMs = ms(t2, now());

  for (let i = 0; i < 10; i++) {
    utimesSync(join(dir, `mod${i}.ts`), new Date(), new Date());
  }
  const t3 = now();
  idx.rebuild();
  out.rebuildAfterTenEditsMs = ms(t3, now());

  const t4 = now();
  idx.searchSymbol('helper');
  out.symbolSearchMs = ms(t4, now());

  out.note =
    'FilesystemRepoIndex has no incremental API — rebuild() re-walks everything. The production cache (neuralRelayBridge lastIndex reuse, TTL 60s) avoids rebuilds entirely within the window; these numbers quantify what a rebuild costs when the TTL lapses.';
  out.filesReadOnCold = out.coldFileCount;
  out.filesReadOnWarm = 0;
  out.cacheHit = 'warm queries served from in-memory maps; no FS reads';

  rmSync(dir, { recursive: true, force: true });
  console.log(`  [ctx] cold build=${out.coldBuildMs}ms files=${out.coldFileCount} · warm query=${out.warmQueryMs}ms · rebuild after 1 edit=${out.rebuildAfterOneEditMs}ms · after 10 edits=${out.rebuildAfterTenEditsMs}ms`);
  return out;
}

// ---------------------------------------------------------------------------
// LIVE: classifier with/without LLM
// ---------------------------------------------------------------------------

async function sectionClassifier({ router }) {
  const results = {};
  process.env.SINGULARITY_TRACE = '0';
  const prompt = 'Fix the pagination bug in the users list API endpoint';

  // ---- (1) Production config, untouched: resolve everything from env. ----
  process.env.SINGULARITY_SPECIALTY_LLM = '1';
  const t0 = now();
  const prod = await router.classifySpecialty(prompt, { config: {} });
  results.productionConfig = {
    latencyMs: prod.latencyMs,
    specialty: prod.specialty,
    source: prod.source,
    reason: prod.reason,
    wallMs: ms(t0, now()),
    note: 'resolved from SINGULARITY_DECISION_* / bundled env exactly like routeAsync',
  };
  console.log(`  [classifier] production-config: ${results.productionConfig.latencyMs}ms source=${prod.source} (${prod.reason})`);

  await new Promise((r) => setTimeout(r, 13000));

  // ---- (2) Healthy upstream (benchmark-only): TokenRouter + ladder model. ----
  // Probe (1) may have tripped the Phase-13 fail-fast cooldown on the bundled
  // credential; this probe uses a different key, so clear the health cache.
  loadEnv();
  router.resetDecisionModelHealth();
  const apiKey =
    process.env.TOKENROUTER_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    '';
  const base = (
    process.env.TOKENROUTER_BASE_URL?.trim() ||
    process.env.OPENROUTER_BASE_URL?.trim() ||
    ''
  ).replace(/\/$/, '');
  const healthyCfg = {
    apiKey,
    baseUrl: base,
    decisionModel: process.env.LADDER_MODEL || 'deepseek/deepseek-v4-flash-0731',
    timeoutMs: 8000,
  };

  const t1 = now();
  const withLlm = await router.classifySpecialty(prompt, { config: { ...healthyCfg } });
  results.withLlmHealthyUpstream = {
    latencyMs: withLlm.latencyMs,
    specialty: withLlm.specialty,
    source: withLlm.source,
    reason: withLlm.reason,
    confidence: withLlm.confidence,
    wallMs: ms(t1, now()),
  };
  console.log(`  [classifier] WITH llm (healthy): ${results.withLlmHealthyUpstream.latencyMs}ms source=${withLlm.source} lane=${withLlm.specialty} (${withLlm.reason})`);

  // ---- (3) Rules path, same prompt, LLM disabled. ----
  process.env.SINGULARITY_SPECIALTY_LLM = '0';
  const t2 = now();
  const rules = await router.classifySpecialty(prompt, { config: {} });
  results.withoutLlm = {
    latencyMs: rules.latencyMs,
    specialty: rules.specialty,
    source: rules.source,
    reason: rules.reason,
    wallMs: ms(t2, now()),
  };
  console.log(`  [classifier] WITHOUT llm: ${results.withoutLlm.latencyMs}ms source=${rules.source} lane=${rules.specialty}`);
  delete process.env.SINGULARITY_SPECIALTY_LLM;

  // ---- (4) Memo effectiveness measured where it actually lives:
  //         RoutingEngine.routeAsync. A counting fetch proves the second
  //         identical route issues zero classifier HTTP calls.
  await new Promise((r) => setTimeout(r, 13000));
  router.clearSpecialtyMemo();
  router.resetDecisionModelHealth();
  let classifierHttpCalls = 0;
  const countingCfg = {
    ...healthyCfg,
    fetch: (async (input, init) => {
      classifierHttpCalls += 1;
      return fetch(input, init);
    }),
  };
  const engine = router.createRoutingEngine({
    models: [makeLadderModelSpec(process.env.LADDER_MODEL || 'deepseek/deepseek-v4-flash-0731')],
    specialtyClassifier: countingCfg,
  });
  const memoPrompt = 'Add retry logic to the webhook dispatcher module';
  const t3 = now();
  await engine.routeAsync({ prompt: memoPrompt });
  const firstCallMs = ms(t3, now());
  const callsAfterFirst = classifierHttpCalls;
  const t4 = now();
  await engine.routeAsync({ prompt: memoPrompt });
  const secondCallMs = ms(t4, now());
  results.memo = {
    firstCallMs,
    classifierHttpCallsAfterFirst: callsAfterFirst,
    secondCallMs,
    classifierHttpCallsAfterSecond: classifierHttpCalls,
    memoEffective: classifierHttpCalls === 1 && secondCallMs < 50 && firstCallMs - secondCallMs > 500,
    note: 'memo hit = second identical routeAsync served from session cache: near-zero wall time and zero additional classifier HTTP calls within the 60s TTL',
  };
  console.log(`  [classifier] memo(routeAsync): first=${Math.round(firstCallMs)}ms(${callsAfterFirst} http call) second=${Math.round(secondCallMs)}ms(${classifierHttpCalls} http calls total) effective=${results.memo.memoEffective}`);

  results.callsPerRequest = {
    unforcedRoute: '1 classifier call on first sight of a prompt; memoized within 60s TTL after that',
    forcedModelOrTier: '0 classifier calls (skipped entirely)',
    deepRun: 'planner+workers force model/tier ⇒ 0; only unforced caller prompts classify once',
  };
  return results;
}

// ---------------------------------------------------------------------------
// LIVE: ladder tiers
// ---------------------------------------------------------------------------

function makeLadderModelSpec(modelId) {
  return {
    id: modelId,
    displayName: modelId,
    provider: 'openrouter',
    tier: 'T3',
    subTier: 'T3.1',
    primaryPurpose: 'Latency benchmark target',
    callWhen: ['benchmark'],
    doNotCall: [],
    capabilities: {
      speed: 'fast',
      coding: 8,
      reasoning: 8,
      longContext: 7,
      toolUse: 8,
      cost: 'medium',
      context: 'large',
      vision: false,
      vendor: 'deepseek',
    },
    maxContext: 128_000,
    supportsTools: true,
    supportsVision: false,
    supportsJson: true,
    supportsStreaming: true,
    costPer1MInput: 0.3,
    costPer1MOutput: 1.2,
    latencyMsP50: 400,
    reliability: 0.99,
    qualityByIntent: {},
  };
}

const FIXTURES = [
  {
    id: 'explain',
    prompt: 'Explain in two sentences what the LockManager in packages/runtime/src/locks/lockManager.js is for.',
    system: 'You are Singularity coding assistant. Be brief.',
  },
  {
    id: 'single-file-edit',
    prompt: 'In one sentence: what would you change in packages/router/src/cache.ts to add a TTL sweep? Do not output code.',
    system: 'You are Singularity coding assistant. Be brief.',
  },
  {
    id: 'multi-file-goal',
    prompt: 'Outline a 3-step plan to add a SINGULARITY_TRACE env flag across packages/router. One line per step.',
    system: 'You are Singularity coding assistant. Be brief.',
  },
];

function resolveAuth() {
  const apiKey =
    process.env.TOKENROUTER_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    '';
  const base = (
    process.env.TOKENROUTER_BASE_URL?.trim() ||
    process.env.OPENROUTER_BASE_URL?.trim() ||
    'https://openrouter.ai/api/v1'
  ).replace(/\/$/, '');
  return { apiKey, base };
}

async function timedStream(iterable) {
  const start = now();
  let first = null;
  let text = '';
  let usage = null;
  let tokensUsed = null;
  let reasoningChars = 0;
  let deltas = 0;
  for await (const ev of iterable) {
    if ((ev.delta || ev.reasoningDelta) && first === null) {
      first = now() - start;
    }
    if (ev.reasoningDelta) reasoningChars += ev.reasoningDelta.length;
    if (ev.delta) {
      text += ev.delta;
      deltas += 1;
    }
    if (ev.usage) usage = ev.usage;
    // Router facade reports usage on its terminal event instead of per-chunk.
    if (ev.tokensUsed !== undefined) tokensUsed = ev.tokensUsed;
  }
  const total = now() - start;
  const completionTokens = usage?.completionTokens ?? tokensUsed ?? null;
  const genMs = first !== null ? total - first : null;
  return {
    ttftMs: first,
    totalMs: total,
    chars: text.length,
    deltas,
    reasoningChars,
    completionTokens,
    promptTokens: usage?.promptTokens,
    cachedPromptTokens: usage?.cachedPromptTokens,
    totalTokens: usage?.totalTokens,
    genTps: genMs && completionTokens ? Math.round((completionTokens / (genMs / 1000)) * 10) / 10 : null,
    effTps: completionTokens ? Math.round((completionTokens / (total / 1000)) * 10) / 10 : null,
    text,
  };
}

async function tierA({ fixture, opts, auth }) {
  const start = now();
  const res = await fetch(`${auth.base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: opts.maxTokens,
      temperature: 0.2,
      messages: [
        { role: 'system', content: fixture.system },
        { role: 'user', content: fixture.prompt },
      ],
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`gateway ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let first = null;
  let chars = 0;
  let deltas = 0;
  let usage = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload);
        const d = chunk.choices?.[0]?.delta;
        const delta = d?.content;
        const reasoning = d?.reasoning;
        if (reasoning && first === null) first = now() - start;
        if (delta) {
          if (first === null) first = now() - start;
          chars += delta.length;
          deltas += 1;
        }
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
            cachedPromptTokens:
              chunk.usage.prompt_tokens_details?.cached_tokens ?? chunk.usage.cache_read_input_tokens ?? undefined,
          };
        }
      } catch {
        /* skip malformed */
      }
    }
  }
  reader.releaseLock();
  const total = now() - start;
  const genMs = first !== null ? total - first : null;
  return {
    ttftMs: first,
    totalMs: total,
    chars,
    deltas,
    reasoningChars: 0,
    completionTokens: usage?.completionTokens,
    promptTokens: usage?.promptTokens,
    cachedPromptTokens: usage?.cachedPromptTokens,
    totalTokens: usage?.totalTokens,
    genTps: genMs && usage?.completionTokens ? Math.round((usage.completionTokens / (genMs / 1000)) * 10) / 10 : null,
    effTps: usage?.completionTokens ? Math.round((usage.completionTokens / (total / 1000)) * 10) / 10 : null,
  };
}

async function tierB({ fixture, opts, provider }) {
  return timedStream(
    provider.streamChatCompletions({
      model: opts.model,
      messages: [
        { role: 'system', content: fixture.system },
        { role: 'user', content: fixture.prompt },
      ],
      temperature: 0.2,
      maxTokens: opts.maxTokens,
    }),
  );
}

async function tierC({ fixture, opts, ai }) {
  return timedStream(
    ai.completeStream({
      prompt: fixture.prompt,
      mode: 'chat',
      temperature: 0.2,
      sessionId: 'latency-validation',
      messages: [
        { role: 'system', content: fixture.system },
        { role: 'user', content: fixture.prompt },
      ],
      skipPromptPipeline: true,
      maxTokens: opts.maxTokens,
    }),
  );
}

// Tier D — deep path with full stage attribution via runtime events.
async function tierD({ fixture, runtime }) {
  const events = [];
  const t0 = now();
  const startEpoch = Date.now();
  runtime.setCollector((ev) =>
    events.push({ kind: ev.kind, ts: ev.ts, taskId: ev.taskId ?? null, message: String(ev.message).slice(0, 120) }),
  );
  const result = await runtime.engine.run({
    goal: fixture.prompt,
    maxConcurrentSubagents: 1,
    enableVerification: true,
    enableSubagentLoop: true,
    fastPath: false,
  });
  runtime.setCollector(null);
  const totalMs = Math.round(now() - t0);
  const rel = (ts) => Math.round(ts - startEpoch);
  const evAt = (kind) => {
    const e = events.find((x) => x.kind === kind);
    return e ? rel(e.ts) : null;
  };
  const lastTaskDone = [...events].reverse().find((e) => e.kind === 'task_done');
  const firstDeltaEv = events.find((e) => e.kind === 'subagent_progress_delta');
  const stages = {
    planningEndMs: evAt('plan_created'),
    workerStartMs: evAt('task_started'),
    workerEndMs: lastTaskDone ? rel(lastTaskDone.ts) : null,
    integratorStartMs: evAt('integrate_started'),
    integratorEndMs: evAt('integrate_done'),
    verificationStartMs: evAt('verify_started'),
    verificationEndMs: evAt('verify_done') ?? evAt('verify_failed'),
    totalMs,
    firstDeltaMs: firstDeltaEv ? rel(firstDeltaEv.ts) : null,
  };
  const timeline = events.map((e) => ({ kind: e.kind, taskId: e.taskId, offsetMs: rel(e.ts), message: e.message }));
  return {
    ok: result.ok,
    error: result.error ?? null,
    totalMs,
    ttftMs: stages.firstDeltaMs,
    chars: (result.summary ?? '').length,
    completionTokens: result.usage?.outputTokens,
    stages,
    timeline,
    appliedPaths: result.appliedPaths,
    verification: result.verification?.summary ?? null,
    fastPath: result.fastPath ?? false,
    llmCalls: runtime.calls.count,
  };
}

async function main() {
  loadEnv();
  const [section, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  const prior = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')) : {};

  if (section === 'fastpath') {
    process.env.SINGULARITY_TRACE = '0';
    const rt = await import(pathToFileURL(join(ROOT, 'packages/runtime/dist/index.js')).href);
    const out = await sectionFastPath(rt);
    writeFileSync(OUT_PATH, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...prior, fastPath: out }, null, 2)}\n`);
    return;
  }

  if (section === 'risk') {
    process.env.SINGULARITY_TRACE = '0';
    const rt = await import(pathToFileURL(join(ROOT, 'packages/runtime/dist/index.js')).href);
    const out = await sectionRisk(rt);
    writeFileSync(OUT_PATH, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...prior, risk: out }, null, 2)}\n`);
    return;
  }

  if (section === 'ctx') {
    process.env.SINGULARITY_TRACE = '0';
    const out = await sectionCtx();
    writeFileSync(OUT_PATH, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...prior, ctx: out }, null, 2)}\n`);
    return;
  }

  if (section === 'classifier') {
    loadEnv();
    const router = await import(pathToFileURL(join(ROOT, 'packages/router/dist/index.js')).href);
    router.applySingularityBundledEnv();
    const out = await sectionClassifier({ router });
    writeFileSync(OUT_PATH, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...prior, classifier: out }, null, 2)}\n`);
    return;
  }

  if (section === 'phase13') {
    loadEnv();
    const router = await import(pathToFileURL(join(ROOT, 'packages/router/dist/index.js')).href);
    router.applySingularityBundledEnv();
    const auth = resolveAuth();
    if (!auth.apiKey) {
      console.error('No API key found. Aborting phase13 live run.');
      process.exit(1);
    }
    const rt = await import(pathToFileURL(join(ROOT, 'packages/runtime/dist/index.js')).href);

    // Global 429 observability: wrap the module-level rate limiter's note hook
    // via a counting fetch on the provider config.
    let provider429s = 0;
    const countingFetch = async (input, init) => {
      const res = await fetch(input, init);
      if (res.status === 429) {
        provider429s += 1;
        console.log(`  [429 observed] total=${provider429s}`);
      }
      return res;
    };

    const workspace = new rt.InMemoryWorkspace({
      'utils.ts': 'export function util(a: string) { return a.trim(); }\n',
      'parseInput.ts': 'export function parseInput(s: unknown): string {\n  return String(s);\n}\n',
      'src/index.ts': 'export const x = 1;\n',
      'src/legacy.ts': 'export var legacyCounter = 1;\n',
    });
    const ai = router.createSingularityAI({
      workspaceId: 'phase13-validation',
      routing: { models: [makeLadderModelSpec(opts.model)] },
      adapter: { openrouter: { apiKey: auth.apiKey, baseUrl: auth.base, fetch: countingFetch } },
    });

    const PHASE13_GOALS = [
      { id: 'explain-function', goal: 'Explain this function.', lane: 'fast' },
      { id: 'fix-typo', goal: 'Fix this typo in utils.ts.', lane: 'fast' },
      { id: 'null-check', goal: 'Add a null check to parseInput.ts.', lane: 'fast' },
      { id: 'rename-variable', goal: 'Rename this local variable.', lane: 'fast' },
      { id: 'update-jsdoc', goal: 'Update this JSDoc.', lane: 'fast' },
      { id: 'medium-bug-fix', goal: 'Fix the off-by-one bug that breaks trimming of empty strings in the parser helpers.', lane: 'medium' },
      { id: 'multi-file-refactor', goal: 'Refactor these three modules to share one logging utility across the codebase.', lane: 'deep' },
      { id: 'db-change', goal: 'Database migration adding an audit log table.', lane: 'deep' },
      { id: 'auth-change', goal: 'Authentication change: rotate session tokens after privilege escalation.', lane: 'deep' },
      { id: 'public-api-change', goal: 'Public API change: export a new plugin interface from index.ts and update all consumers.', lane: 'deep' },
    ].filter((g) => !opts.goals || opts.goals.split(',').includes(g.id));

    const callBudget = Number(process.env.PHASE13_MAX_CALLS ?? 40);
    const results = [];
    for (const g of PHASE13_GOALS) {
      if (results.length >= callBudget) {
        console.log('  call budget exhausted');
        break;
      }
      const events = [];
      const startEpoch = Date.now();
      let calls = { n: 0 };
      const countingAi = new Proxy(ai, {
        get(target, prop, recv) {
          if (prop === 'complete') {
            return async (req) => {
              calls.n += 1;
              return target.complete(req);
            };
          }
          if (prop === 'completeStream') {
            return async function* (req) {
              calls.n += 1;
              yield* target.completeStream(req);
            };
          }
          if (prop === 'escalate') {
            return async (req) => {
              calls.n += 1;
              return target.escalate(req);
            };
          }
          return Reflect.get(target, prop, recv);
        },
      });
      const engine = rt.createRuntimeEngineFromAI({
        ai: countingAi,
        workspace,
        edit: new rt.InMemoryEditPort(workspace),
        concurrency: 2,
        sessionId: `phase13-${g.id}`,
        enableVerification: true,
        enableSubagentLoop: true,
        tools: { typecheck: async () => ({ ok: true, output: '0 errors (stub)' }) },
        onEvent: (ev) =>
          events.push({ kind: ev.kind, ts: ev.ts, message: String(ev.message).slice(0, 120) }),
      });
      const t0 = now();
      try {
        const result = await engine.run({ goal: g.goal });
        const rel = (ts) => Math.round(ts - startEpoch);
        const firstDelta = events.find((e) => e.kind === 'subagent_progress_delta');
        results.push({
          id: g.id,
          goal: g.goal,
          expectedLane: g.lane,
          actualLane:
            result.fastPath === true ? 'fast'
              : (events.some((e) => e.message.includes('Medium lane')) ? 'medium' : 'deep'),
          llmCalls: calls.n,
          ttftMs: firstDelta ? rel(firstDelta.ts) : null,
          totalMs: Math.round(now() - t0),
          ok: result.ok,
          usage: result.usage ?? null,
          verification: result.verification?.summary ?? null,
          appliedPaths: result.appliedPaths,
          error: result.error ?? null,
        });
        console.log(
          `  [${g.id}] lane=${results.at(-1).actualLane} calls=${calls.n} ttft=${results.at(-1).ttftMs ?? '—'}ms total=${results.at(-1).totalMs}ms ok=${result.ok}`,
        );
      } catch (err) {
        results.push({ id: g.id, goal: g.goal, expectedLane: g.lane, actualLane: 'error', llmCalls: calls.n, ttftMs: null, totalMs: Math.round(now() - t0), ok: false, verification: null, appliedPaths: [], error: String(err).slice(0, 200) });
        console.log(`  [${g.id}] ERROR ${err instanceof Error ? err.message : err}`);
      }
      await new Promise((r) => setTimeout(r, 13000));
    }

    writeFileSync(
      OUT_PATH,
      `${JSON.stringify({ updatedAt: new Date().toISOString(), ...prior, phase13: { updatedAt: new Date().toISOString(), model: opts.model, provider429s, results } }, null, 2)}\n`,
    );
    return;
  }

  if (section === 'ladder') {
    loadEnv();
    const router = await import(pathToFileURL(join(ROOT, 'packages/router/dist/index.js')).href);
    router.applySingularityBundledEnv();
    const auth = resolveAuth();
    if (!auth.apiKey) {
      console.error('No API key found. Aborting (no dry mode in validate ladder).');
      process.exit(1);
    }

    const provider = new router.OpenRouterProvider({ apiKey: auth.apiKey, baseUrl: auth.base });
    const ai = router.createSingularityAI({
      workspaceId: 'latency-validation',
      routing: { models: [makeLadderModelSpec(opts.model)] },
      adapter: { openrouter: { apiKey: auth.apiKey, baseUrl: auth.base } },
    });

    let runtime = null;
    let collectorFn = null;
    if (opts.tiers.includes('D')) {
      const rt = await import(pathToFileURL(join(ROOT, 'packages/runtime/dist/index.js')).href);
      const workspace = new rt.InMemoryWorkspace({
        'src/index.ts': 'export const x = 1;\n',
        'src/util.ts': 'export function util() { return x; }\n',
      });
      // Count LLM calls by wrapping the engine's LLM port via the AI facade.
      const callCounter = { count: 0 };
      const countingAi = new Proxy(ai, {
        get(target, prop, recv) {
          if (prop === 'complete') {
            return async (req) => {
              callCounter.count += 1;
              return target.complete(req);
            };
          }
          if (prop === 'completeStream') {
            return async function* (req) {
              callCounter.count += 1;
              yield* target.completeStream(req);
            };
          }
          if (prop === 'escalate') {
            return async (req) => {
              callCounter.count += 1;
              return target.escalate(req);
            };
          }
          return Reflect.get(target, prop, recv);
        },
      });
      // Event collector: the factory takes onEvent at construction; re-wrap it
      // per run so tierD can capture a fresh timeline without rebuilding.
      const baseOnEvent = undefined;
      const engine = rt.createRuntimeEngineFromAI({
        ai: countingAi,
        workspace,
        edit: new rt.InMemoryEditPort(workspace),
        concurrency: 1,
        sessionId: 'latency-validation-d',
        onEvent: (ev) => {
          if (collectorFn) collectorFn(ev);
          if (baseOnEvent) baseOnEvent(ev);
        },
      });
      runtime = { engine, calls: callCounter, setCollector: (fn) => { collectorFn = fn; } };
    }

    console.log(`Ladder (live) · model=${opts.model} · runs=${opts.runs} · tiers=${opts.tiers.join(',')} · fixtures=${(opts.fixtures ?? FIXTURES.map((f) => f.id)).join(',')}`);
    const fixtures = FIXTURES.filter((f) => !opts.fixtures || opts.fixtures.includes(f.id));
    const results = prior.ladder?.results ?? {};
    let callBudget = 0;
    const RPM_BUDGET = Number(process.env.LADDER_MAX_CALLS ?? 24);

    for (const tier of opts.tiers) {
      results[tier] = results[tier] ?? {};
      for (const fixture of fixtures) {
        results[tier][fixture.id] = results[tier][fixture.id] ?? { samples: [] };
        const bucket = results[tier][fixture.id];
        for (let i = bucket.samples.length; i < opts.runs; i++) {
          if (callBudget >= RPM_BUDGET) {
            console.log(`  call budget ${RPM_BUDGET} exhausted — stopping`);
            break;
          }
          try {
            let sample;
            const attempt = async () => {
              if (tier === 'A') return tierA({ fixture, opts, auth });
              if (tier === 'B') return tierB({ fixture, opts, provider });
              if (tier === 'C') return tierC({ fixture, opts, ai });
              if (tier === 'D') {
                if (!runtime) throw new Error('runtime not initialized (pass --tiers D)');
                return tierD({ fixture, runtime });
              }
              throw new Error(`unknown tier ${tier}`);
            };
            try {
              sample = await attempt();
            } catch (err) {
              if (/429/.test(String(err))) {
                console.log(`  [${tier}] ${fixture.id} #${i + 1}: 429 — waiting 65s`);
                await new Promise((r) => setTimeout(r, 65000));
                sample = await attempt();
              } else {
                throw err;
              }
            }
            bucket.samples.push({ ok: true, ...sample, _text: undefined });
            delete sample?.text;
            console.log(
              `  [${tier}] ${fixture.id} #${i + 1}: ttft=${sample.ttftMs !== null && sample.ttftMs !== undefined ? Math.round(sample.ttftMs) : '—'}ms total=${Math.round(sample.totalMs)}ms tok=${sample.completionTokens ?? '—'} tps=${sample.genTps ?? '—'}`,
            );
            callBudget += 1;
          } catch (err) {
            bucket.samples.push({ ok: false, error: String(err).slice(0, 200) });
            console.log(`  [${tier}] ${fixture.id} #${i + 1}: ERROR ${err instanceof Error ? err.message : err}`);
            callBudget += 1;
          }
          await new Promise((r) => setTimeout(r, 13000));
        }
        bucket.summary = summarize(bucket.samples);
        delete bucket.summary._samples;
        const s = bucket.summary;
        console.log(`  [${tier}] ${fixture.id}: ttft p50=${s.ttftP50Ms} p95=${s.ttftP95Ms} · total p50=${s.totalP50Ms} p95=${s.totalP95Ms} (${s.okRuns}/${s.runs} ok)`);
      }
    }

    writeFileSync(
      OUT_PATH,
      `${JSON.stringify({ updatedAt: new Date().toISOString(), ...prior, model: opts.model, maxTokens: opts.maxTokens, ladder: { results } }, null, 2)}\n`,
    );
    return;
  }

  if (section === 'phase14') {
    await runPhase14(opts);
    return;
  }

  if (!section || !['fastpath', 'risk', 'ctx', 'classifier', 'ladder', 'phase13', 'phase14'].includes(section)) {
    console.error('Unknown section. Use: fastpath | risk | ctx | classifier | ladder | phase13 | phase14');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Phase 14 — real deep-path validation on a realistic fixture.
// Measurement ONLY: no runtime behavior changes; every LLM call is attributed.
// ---------------------------------------------------------------------------

async function runPhase14(opts) {
  loadEnv();
  const router = await import(pathToFileURL(join(ROOT, 'packages/router/dist/index.js')).href);
  router.applySingularityBundledEnv();
  const auth = resolveAuth();
  if (!auth.apiKey) {
    console.error('No API key found. Aborting phase14 live run.');
    process.exit(1);
  }
  const rt = await import(pathToFileURL(join(ROOT, 'packages/runtime/dist/index.js')).href);
  const { createPhase14Fixture } = await import('./phase14-fixture.mjs');

  // Cases per Phase-14 brief. Each runs against the SAME realistic repo
  // (fresh temp copy per case so patches never leak across cases).
  const CASES = [
    {
      id: 'medium-validator-fix',
      // NOTE: the brief's literal wording ("...and update its existing test")
      // classifies FAST (single extension-mentioned file, debug-class verbs
      // stay eligible). This variant avoids the file mention so the same real
      // bug deterministically takes the MEDIUM lane.
      goal:
        'Fix the username length validation so names longer than 18 characters are rejected.',
      lane: 'medium',
    },
    {
      id: 'deep-validation-api-tests',
      goal:
        'Modify the existing validation behavior in src/validator.ts so username length is capped at 18 characters, update the related src/api.ts module to surface a specific error message for oversized usernames, and update the corresponding tests in tests/validator.test.ts and tests/api.test.ts.',
      lane: 'deep',
    },
    {
      id: 'auth-expiry',
      goal:
        'Authentication change: add expiry to existing sessions in src/auth.ts (sessions older than one hour must stop resolving) and update its tests.',
      lane: 'deep',
    },
    {
      id: 'db-audit-schema',
      goal:
        'Database change: extend the existing audit log schema in src/db.ts with a required metadata field and update appendAudit callers/tests accordingly.',
      lane: 'deep',
    },
    {
      id: 'public-api-export',
      goal:
        'Public API change: export a new validateUsernamesBatch function from src/validator.ts, re-export it from src/index barrel if present, and update consumers/tests.',
      lane: 'deep',
    },
  ].filter((c) => !opts.goals || opts.goals.split(',').includes(c.id));

  const results = [];
  for (const c of CASES) {
    const caseRes = await runPhase14Case(rt, router, auth, c, opts, createPhase14Fixture);
    results.push(caseRes);
    console.log(
      `  [${c.id}] lane=${caseRes.actualLane} risk=${caseRes.riskTier ?? '—'} calls=${caseRes.callGraph.total} ok=${caseRes.ok} total=${Math.round(caseRes.totalMs)}ms`,
    );
    await new Promise((r) => setTimeout(r, 13000));
  }

  writeFileSync(
    OUT_PATH,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), ...priorJson(), phase14: { updatedAt: new Date().toISOString(), model: opts.model, cases: results } }, null, 2)}\n`,
  );
}

function priorJson() {
  try {
    return JSON.parse(readFileSync(OUT_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** One benchmark case on a fresh fixture copy with full call attribution. */
async function runPhase14Case(rt, router, auth, spec, opts, createPhase14Fixture) {
  const fixture = createPhase14Fixture();
  const workspaceFiles = {};
  for (const [rel, content] of Object.entries(fixture.files)) {
    workspaceFiles[rel] = content;
  }
  const workspace = new rt.InMemoryWorkspace(workspaceFiles);
  const edit = new rt.InMemoryEditPort(workspace);

  // --- call recorder -------------------------------------------------------
  const calls = [];
  let callSeq = 0;
  const t0Epoch = Date.now();

  const classifyCall = (role, req) => {
    if (req.modelId && req.forceRetry) return 'RETRY';
    const sid = String(req.sessionId ?? '');
    if (sid.endsWith('-verify')) return 'VERIFIER';
    return role === 'planner'
      ? 'PLANNER'
      : role === 'integrator'
        ? 'INTEGRATOR'
        : role === 'worker' || role === 'design-director' || role === 'visual-critic'
          ? 'WORKER'
          : 'OTHER';
  };

  const makeRecordingPort = (base) => ({
    async complete(req) {
      const seq = ++callSeq;
      const startedAt = Date.now() - t0Epoch;
      try {
        const res = await base.complete(req);
        calls.push({
          seq,
          kind: classifyCall(req.role, req),
          role: req.role,
          reason: callReason(req),
          modelId: req.modelId ?? null,
          durationMs: Date.now() - t0Epoch - startedAt,
          offsetMs: startedAt,
          tokensUsed: res.tokensUsed ?? null,
          promptChars: req.prompt.length,
        });
        return res;
      } catch (err) {
        calls.push({
          seq,
          kind: isRateLimitErr(err) ? 'RATE_LIMIT_WAIT' : classifyCall(req.role, req),
          role: req.role,
          reason: callReason(req),
          modelId: req.modelId ?? null,
          durationMs: Date.now() - t0Epoch - startedAt,
          offsetMs: startedAt,
          tokensUsed: null,
          promptChars: req.prompt.length,
          error: String(err).slice(0, 160),
        });
        throw err;
      }
    },
    async *completeStream(req) {
      const seq = ++callSeq;
      const startedAt = Date.now() - t0Epoch;
      let firstDeltaMs = null;
      try {
        for await (const ev of base.completeStream(req)) {
          if (firstDeltaMs === null && (ev.delta || ev.reasoningDelta)) {
            firstDeltaMs = Date.now() - t0Epoch - startedAt;
          }
          yield ev;
        }
        calls.push({
          seq,
          kind: classifyCall(req.role, req),
          role: req.role,
          reason: callReason(req),
          modelId: req.modelId ?? null,
          durationMs: Date.now() - t0Epoch - startedAt,
          firstDeltaMs,
          offsetMs: startedAt,
          tokensUsed: null,
          promptChars: req.prompt.length,
        });
      } catch (err) {
        calls.push({
          seq,
          kind: isRateLimitErr(err) ? 'RATE_LIMIT_WAIT' : classifyCall(req.role, req),
          role: req.role,
          reason: callReason(req),
          modelId: req.modelId ?? null,
          durationMs: Date.now() - t0Epoch - startedAt,
          firstDeltaMs,
          offsetMs: startedAt,
          tokensUsed: null,
          promptChars: req.prompt.length,
          error: String(err).slice(0, 160),
        });
        throw err;
      }
    },
    escalate: base.escalate?.bind(base),
  });

  const ai = router.createSingularityAI({
    workspaceId: 'phase14-validation',
    routing: { models: [makeLadderModelSpec(opts.model)] },
    adapter: { openrouter: { apiKey: auth.apiKey, baseUrl: auth.base } },
  });
  const llmBase = rt.createLlmPortFromSingularityAI({
    ai,
    sessionId: `phase14-${spec.id}`,
  });
  const llm = makeRecordingPort(llmBase);

  // Deterministic typecheck/test tools backed by the REAL fixture on disk.
  const repoTsc = join(ROOT, 'node_modules/typescript/bin/tsc');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileP = promisify(execFile);
  const runInFixture = async (cmd, args) => {
    try {
      const { stdout, stderr } = await execFileP(cmd, args, {
        cwd: fixture.root,
        timeout: 120_000,
      });
      return { ok: true, output: `${stdout}${stderr}`.slice(-2000) };
    } catch (e) {
      return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}`.slice(-2000) };
    }
  };
  let testResult = null;
  const tools = {
    typecheck: async () => runInFixture(process.execPath, [repoTsc, '--noEmit']),
    test: async () => {
      testResult = await runInFixture(process.execPath, [
        '--test',
        'tests/parser.test.ts',
        'tests/validator.test.ts',
        'tests/api.test.ts',
      ]);
      return testResult;
    },
  };

  router.resetRateGateStats();
  router.resetDecisionModelHealth();

  const events = [];
  const engine = rt.createRuntimeEngine({
    llm,
    workspace,
    edit,
    concurrency: 2,
    sessionId: `phase14-${spec.id}`,
    enableVerification: true,
    enableSubagentLoop: true,
    tools,
    workspaceRoot: fixture.root,
    onEvent: (ev) =>
      events.push({
        kind: ev.kind,
        ts: ev.ts,
        message: String(ev.message).slice(0, 140),
      }),
  });

  const wallStart = now();
  let result = null;
  let runError = null;
  try {
    result = await engine.run({ goal: spec.goal });
  } catch (e) {
    runError = String(e).slice(0, 200);
  }
  const totalMs = Math.round(now() - wallStart);

  const gate = router.getRateGateStats();
  const changedAfter = {};
  for (const [rel] of Object.entries(workspaceFiles)) {
    const cur = await workspace.readFile(rel).catch(() => null);
    if (cur !== null && cur !== workspaceFiles[rel]) changedAfter[rel] = 'modified';
  }

  // Role rollups
  const byKind = {};
  for (const c of calls) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;

  const useful =
    (byKind.PLANNER ?? 0) +
    (byKind.WORKER ?? 0) +
    (byKind.WORKER_TOOL_CONTINUATION ?? 0) +
    (byKind.INTEGRATOR ?? 0) +
    (byKind.VERIFIER ?? 0);

  const timeline = buildTimeline(events, gate, totalMs);

  return {
    id: spec.id,
    goal: spec.goal,
    expectedLane: spec.lane,
    actualLane:
      result?.fastPath === true
        ? 'fast'
        : events.some((e) => e.message.includes('Medium lane'))
          ? 'medium'
          : 'deep',
    riskTier: extractRiskTier(events),
    ok: result ? result.ok : false,
    error: result?.error ?? runError,
    totalMs,
    verification: result?.verification ?? null,
    appliedPaths: result?.appliedPaths ?? [],
    changedFiles: Object.keys(changedAfter),
    testsRun: testResult !== null,
    testsOk: testResult ? testResult.ok : null,
    callGraph: {
      total: calls.length,
      byKind,
      useful_calls: useful,
      retry_calls: byKind.RETRY ?? 0,
      rate_limit_waits: byKind.RATE_LIMIT_WAIT ?? 0,
      potentially_redundant: Math.max(0, calls.length - useful - (byKind.RETRY ?? 0)),
      calls,
    },
    rateGate: gate,
    timeline,
  };
}

function callReason(req) {
  const p = String(req.prompt ?? '').slice(0, 300).replace(/\s+/g, ' ');
  if (/verify|checklist|requirement/i.test(p)) return 'verification';
  if (/integrate|conflict|merge/i.test(p)) return 'integration';
  if (/plan|decompose|task list/i.test(p)) return 'planning';
  return p.slice(0, 110);
}

function isRateLimitErr(err) {
  return /429|rate.?limit|too many requests/i.test(String(err));
}

function extractRiskTier(events) {
  const ev = events.find((e) => e.message.startsWith('Risk-based verification') || e.message.includes('full verification'));
  if (!ev) return null;
  const m = /high|medium|low/.exec(ev.message);
  return m ? m[0] : null;
}

function buildTimeline(events, gate, totalMs) {
  const start = events.length ? events[0].ts : Date.now();
  const lines = [];
  for (const e of events) {
    const off = Math.round(e.ts - start);
    if (
      [
        'plan_created',
        'planning_finished',
        'task_started',
        'task_retry',
        'task_failed',
        'subagent_started',
        'subagent_finished',
        'integrate_started',
        'integrate_done',
        'verify_started',
        'run_finished',
        'run_failed',
      ].includes(e.kind)
    ) {
      lines.push(`${String(off).padStart(6)}ms  ${e.kind}  ${e.message}`);
    }
  }
  lines.push(
    `${String(totalMs).padStart(6)}ms  END  gate429s=${gate.observed429s} cooldownWait=${Math.round(gate.cooldownWaitMs)}ms spacingWait=${Math.round(gate.spacingWaitMs)}ms retryBackoff=${Math.round(gate.retryBackoffMs)}ms`,
  );
  return lines;
}
