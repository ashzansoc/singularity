#!/usr/bin/env node
/**
 * bench-perf — reproducible Harness vs Singularity chat-runtime benchmark.
 *
 *   --side singularity --tiers A,B,C   Singularity tiers (live or --dry)
 *   --side harness                    Harness headless one-shot
 *   --side both (default)             Harness + Singularity A/B/C live
 *
 * Metrics: TTFT, total latency, tokens, raw/parsed/rendered TPS.
 * Identical fixture prompts + model on both sides.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const OUT_DIR = join(__dirname, 'results');
const HARNESS_ROOT = '/Users/ashutosh/deepseek-harness';

// --- Shared fixtures (identical on both sides) -------------------------------
const FIXTURES = [
  {
    id: 'explain',
    prompt:
      'Write a short technical explanation (150-200 words) of how an event-driven agent harness processes a user turn: message ingress, context assembly, model streaming, tool calls, and final response. Be concrete and use plain prose.',
    system: 'You are a concise technical writer.',
  },
  {
    id: 'plan',
    prompt:
      'Write a concise engineering plan (150-200 words) for adding a configurable feature flag across a TypeScript monorepo: where the flag lives, how packages read it, and how CI gates it. Use plain prose with a short list.',
    system: 'You are a concise staff engineer.',
  },
  {
    id: 'edit',
    prompt:
      'Write a short advisory (150-200 words) for an engineer about to edit a file that three concurrent agents may touch: locking, rebasing, verification, and rollback. Be concrete and practical.',
    system: 'You are a concise engineering lead.',
  },
];

const MODEL = process.env.BENCH_MODEL || 'deepseek/deepseek-v4-flash-0731';
const MAX_TOKENS = Number(process.env.BENCH_MAX_TOKENS || 300);
const TEMP = 0.2;
const RUNS = Number(process.env.BENCH_RUNS || 3);

function parseArgs(argv) {
  const out = {
    side: 'both',
    tiers: 'A,B,C',
    dry: argv.includes('--dry'),
    runs: RUNS,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--side') out.side = String(argv[++i]).toLowerCase();
    else if (a === '--tiers') out.tiers = String(argv[++i]);
    else if (a === '--runs') out.runs = Number(argv[++i]) || RUNS;
  }
  out.side = out.side === 'both' ? 'both' : out.side === 'singularity' ? 'singularity' : 'harness';
  out.tiers = out.tiers.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
  return out;
}

function loadEnv() {
  const envPath = join(ROOT, '.env');
  try {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch { /* no .env */ }
}

function resolveAuth() {
  const candidates = [
    process.env.OPENROUTER_API_KEY?.trim(),
    process.env.AI_GATEWAY_API_KEY?.trim(),
  ].filter(Boolean);
  if (candidates.length) {
    return {
      apiKey: candidates[0],
      base: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    };
  }
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), '.singularity', 'beta-auth.json'), 'utf8'));
    if (auth?.openrouterApiKey) {
      return {
        apiKey: auth.openrouterApiKey,
        base: (auth.openrouterBaseUrl || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
      };
    }
  } catch { /* ignore */ }
  return undefined;
}

// --- timing helpers ----------------------------------------------------------
function summarize(samples) {
  const ok = samples.filter((s) => s.ok);
  const pick = (arr) => (arr.length ? arr : [0]);
  const ttft = pick(ok.map((s) => s.ttftMs).filter((v) => v != null));
  const tot = pick(ok.map((s) => s.totalMs).filter((v) => v != null));
  const tps = pick(ok.map((s) => s.tpsRendered).filter((v) => v != null && v > 0));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sorted = (a) => [...a].sort((x, y) => x - y);
  return {
    runs: samples.length,
    okRuns: ok.length,
    ttftMeanMs: Math.round(mean(ttft)),
    ttftP50Ms: Math.round(sorted(ttft)[Math.floor(ttft.length / 2)]),
    totalMeanMs: Math.round(mean(tot)),
    totalP50Ms: Math.round(sorted(tot)[Math.floor(tot.length / 2)]),
    tpsRenderedMean: Number(mean(tps).toFixed(1)),
    tpsRenderedP50: Number(sorted(tps)[Math.floor(tps.length / 2)].toFixed(1)),
    tokensMean: Math.round(mean(pick(ok.map((s) => s.tokens).filter((v) => v != null)))),
    errors: samples.filter((s) => !s.ok).map((s) => String(s.error).slice(0, 160)),
  };
}

async function timedStream(iterable) {
  const start = performance.now();
  let first = null;
  let rawChars = 0;
  let tokens;
  let summary;
  for await (const ev of iterable) {
    if (ev.summary) {
      summary = ev.summary;
      continue;
    }
    if ((ev.delta || ev.reasoningDelta) && first === null) first = performance.now() - start;
    if (ev.delta) rawChars += ev.delta.length;
    if (ev.tokensUsed !== undefined) tokens = ev.tokensUsed;
    if (ev.usage?.completion_tokens !== undefined) tokens = ev.usage.completion_tokens;
    // Provider stream events carry normalized usage under { promptTokens, completionTokens }.
    if (ev.usage?.completionTokens !== undefined) tokens = ev.usage.completionTokens;
  }
  const total = summary?.totalMs ?? (performance.now() - start);
  const ttft = summary?.ttftMs ?? first;
  const genMs = total - (ttft ?? total);
  const estTokens = summary?.tokens ?? tokens ?? Math.max(1, Math.round(rawChars / 4));
  return {
    ttftMs: ttft,
    totalMs: total,
    genMs,
    tokens: estTokens,
    tpsRendered: genMs > 0 ? (estTokens / genMs) * 1000 : 0,
  };
}

// --- Singularity tiers (mirrors latency-ladder) ------------------------------
async function tierA({ fixture, auth }) {
  const start = performance.now();
  const res = await fetch(`${auth.base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, stream: true, stream_options: { include_usage: true },
      max_tokens: MAX_TOKENS, temperature: TEMP,
      messages: [{ role: 'system', content: fixture.system }, { role: 'user', content: fixture.prompt }],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`gateway ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`);
  return timedStream(parseSse(res.body, start));
}

async function* parseSse(body, start) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let first = null;
  let rawChars = 0;
  let tokens;
  try {
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
        if (!payload || payload === '[DONE]') {
          if (payload === '[DONE]') yield { done: true };
          continue;
        }
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            if (first === null) first = performance.now() - start;
            rawChars += delta.length;
            yield { delta };
          }
          if (chunk.usage?.completion_tokens) tokens = chunk.usage.completion_tokens;
        } catch { /* skip */ }
      }
    }
    const total = performance.now() - start;
    const genMs = total - (first ?? total);
    const estTokens = tokens ?? Math.max(1, Math.round(rawChars / 4));
    yield { summary: { ttftMs: first, totalMs: total, genMs, tokens: estTokens, tpsRendered: genMs > 0 ? (estTokens / genMs) * 1000 : 0 } };
  } finally {
    reader.releaseLock();
  }
}

async function tierB({ fixture, provider }) {
  const s = timedStream(
    provider.streamChatCompletions({
      model: MODEL,
      messages: [{ role: 'system', content: fixture.system }, { role: 'user', content: fixture.prompt }],
      temperature: TEMP, maxTokens: MAX_TOKENS,
    }),
  );
  const r = await s;
  return r;
}

async function tierC({ fixture, ai }) {
  const r = await timedStream(
    ai.completeStream({
      prompt: fixture.prompt,
      mode: 'chat',
      temperature: TEMP,
      sessionId: 'bench-perf',
      modelId: MODEL, // force identical model (routing preserved for non-benchmark use)
      messages: [{ role: 'system', content: fixture.system }, { role: 'user', content: fixture.prompt }],
      skipPromptPipeline: true,
      maxTokens: MAX_TOKENS,
    }),
  );
  return r;
}

// --- Harness side ------------------------------------------------------------
function runHarness(fixture) {
  const script = join(HARNESS_ROOT, 'apps', 'cli', 'src', 'bin.ts');
  const start = performance.now();
  let out;
  try {
    out = execFileSync('node', ['--import', 'tsx/esm', script, '--profile', 'headless', fixture.prompt], {
      cwd: HARNESS_ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, DSH_HOME: join(homedir(), '.dsh') },
    }).trim();
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message || e).slice(0, 300) };
  }
  const total = performance.now() - start;
  const estTokens = Math.max(1, Math.round(out.length / 4));
  return {
    ok: true,
    ttftMs: null, // harness prints final text only (one-shot)
    totalMs: total,
    genMs: total,
    tokens: estTokens,
    tpsRendered: total > 0 ? (estTokens / total) * 1000 : 0,
    textLen: out.length,
  };
}

// --- main --------------------------------------------------------------------
async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  const results = { ts: new Date().toISOString(), model: MODEL, maxTokens: MAX_TOKENS, temp: TEMP, side: opts.side, fixtures: {} };

  if (opts.side === 'harness' || opts.side === 'both') {
    for (const f of FIXTURES) {
      const samples = [];
      for (let i = 0; i < opts.runs; i++) samples.push(runHarness(f));
      results.fixtures[f.id] = { ...results.fixtures[f.id], harness: summarize(samples) };
      console.log(`[harness] ${f.id}: `, JSON.stringify(results.fixtures[f.id].harness));
    }
  }

  if (opts.side === 'singularity' || opts.side === 'both') {
    if (opts.dry) {
      for (const f of FIXTURES) {
        results.fixtures[f.id] = { ...results.fixtures[f.id], singularityDry: { note: 'dry mode — no network' } };
      }
      console.log('dry run — skipped live Singularity tiers');
    } else {
      const auth = resolveAuth();
      if (!auth) {
        console.error('No OPENROUTER_API_KEY found for Singularity tiers. Use --dry or set .env.');
        process.exitCode = 2;
      } else {
        // dynamic import of the router provider + SingularityAI
        const routerMod = await import(pathToFileURL(join(ROOT, 'packages/router/dist/index.js')).href);
        const provider = new routerMod.OpenRouterProvider({ apiKey: auth.apiKey, baseUrl: auth.base });
        const ai = routerMod.createSingularityAI({ adapter: { openrouter: { apiKey: auth.apiKey, baseUrl: auth.base } } });
        for (const f of FIXTURES) {
          const samples = { A: [], B: [], C: [] };
          for (let i = 0; i < opts.runs; i++) {
            if (opts.tiers.includes('A')) {
              try { samples.A.push({ ok: true, ...(await tierA({ fixture: f, auth })) }); }
              catch (e) { samples.A.push({ ok: false, error: e }); }
            }
            if (opts.tiers.includes('B')) {
              try { samples.B.push({ ok: true, ...(await tierB({ fixture: f, provider })) }); }
              catch (e) { samples.B.push({ ok: false, error: e }); }
            }
            if (opts.tiers.includes('C')) {
              try { samples.C.push({ ok: true, ...(await tierC({ fixture: f, ai })) }); }
              catch (e) { samples.C.push({ ok: false, error: e }); }
            }
          }
          results.fixtures[f.id] = {
            ...results.fixtures[f.id],
            singularity: {
              A: summarize(samples.A),
              B: summarize(samples.B),
              C: summarize(samples.C),
            },
          };
          console.log(`[singularity] ${f.id}: `, JSON.stringify(results.fixtures[f.id].singularity));
        }
      }
    }
  }

  writeFileSync(join(OUT_DIR, `latest.json`), JSON.stringify(results, null, 2));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(OUT_DIR, `${opts.side}-${stamp}.json`), JSON.stringify(results, null, 2));
  console.log(`\nWrote results to benchmarks/bench-perf/results/latest.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });