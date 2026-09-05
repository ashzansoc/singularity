#!/usr/bin/env node
/**
 * Latency ladder — attribute end-to-end latency per stack layer.
 *
 * Tiers:
 *   A  direct gateway HTTP call (fetch, streaming)
 *   B  OpenRouterProvider.streamChatCompletions
 *   C  SingularityAI.completeStream (routing + prompt pipeline + provider)
 *   D  full runtime engine run (planner → worker → integrator → verify) [live only]
 *
 * Writes benchmarks/latency-ladder/METRICS.json (baseline for later steps).
 *
 * Usage:
 *   node benchmarks/latency-ladder/run.mjs            # live API (needs auth)
 *   node benchmarks/latency-ladder/run.mjs --runs 5
 *   node benchmarks/latency-ladder/run.mjs --tiers A,B,C
 *   node benchmarks/latency-ladder/run.mjs --dry      # mock transport, no network
 *
 * Auth: AI_GATEWAY_API_KEY / OPENROUTER_API_KEY (+ optional AI_GATEWAY_BASE_URL),
 * Singularity beta auth (~/.singularity/beta-auth.json), or .env at repo root.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const OUT_PATH = join(__dirname, 'METRICS.json');

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
    /* no .env — fine */
  }
}

function parseArgs(argv) {
  const out = {
    runs: Number(process.env.LADDER_RUNS ?? 5),
    tiers: 'A,B,C',
    dry: process.argv.includes('--dry'),
    maxTokens: 128,
    model: process.env.LADDER_MODEL || 'deepseek/deepseek-v4-flash-0731',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') out.runs = Number(argv[++i]) || 5;
    else if (a === '--tiers') out.tiers = String(argv[++i]);
    else if (a === '--dry') out.dry = true;
    else if (a === '--max-tokens') out.maxTokens = Number(argv[++i]) || 128;
    else if (a === '--model') out.model = String(argv[++i]);
  }
  out.tiers = out.tiers.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES = [
  {
    id: 'explain',
    prompt:
      'Explain in two sentences what the LockManager in packages/runtime/src/locks/lockManager.js is for.',
    system: 'You are Singularity coding assistant. Be brief.',
  },
  {
    id: 'single-file-edit',
    prompt:
      'In one sentence: what would you change in packages/router/src/cache.ts to add a TTL sweep? Do not output code.',
    system: 'You are Singularity coding assistant. Be brief.',
  },
  {
    id: 'multi-file-goal',
    prompt:
      'Outline a 3-step plan to add a SINGULARITY_TRACE env flag across packages/router. One line per step.',
    system: 'You are Singularity coding assistant. Be brief.',
  },
];

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

async function timedStream(iterable, hooks) {
  const onFirst = hooks?.onFirst;
  const start = performance.now();
  let first = null;
  let text = '';
  let tokens;
  for await (const ev of iterable) {
    if (ev.delta && first === null) {
      first = performance.now() - start;
      onFirst?.(first);
    }
    if (ev.delta) text += ev.delta;
    if (ev.tokensUsed !== undefined) tokens = ev.tokensUsed;
  }
  const total = performance.now() - start;
  return { ttftMs: first, totalMs: total, chars: text.length, tokens, text };
}

function summarize(samples) {
  const ok = samples.filter((s) => s.ok);
  const pick = (arr) => (arr.length ? arr : [0]);
  const ttft = pick(ok.map((s) => s.ttftMs).filter((v) => v !== null && v !== undefined));
  const totals = pick(ok.map((s) => s.totalMs));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sorted = (a) => [...a].sort((x, y) => x - y);
  return {
    runs: samples.length,
    okRuns: ok.length,
    ttftMeanMs: Math.round(mean(ttft)),
    ttftP50Ms: Math.round(sorted(ttft)[Math.floor(ttft.length / 2)]),
    totalMeanMs: Math.round(mean(totals)),
    totalP50Ms: Math.round(sorted(totals)[Math.floor(totals.length / 2)]),
    errors: samples.filter((s) => !s.ok).map((s) => String(s.error).slice(0, 200)),
  };
}

// ---------------------------------------------------------------------------
// Tier implementations
// ---------------------------------------------------------------------------

async function tierA({ fixture, opts, auth, fetchFn }) {
  const start = performance.now();
  const res = await (fetchFn ?? fetch)(`${auth.base}/chat/completions`, {
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
  let tokens;
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
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          if (first === null) first = performance.now() - start;
          chars += delta.length;
        }
        if (chunk.usage) tokens = chunk.usage.total_tokens;
      } catch {
        /* skip malformed */
      }
    }
  }
  reader.releaseLock();
  return { ttftMs: first, totalMs: performance.now() - start, chars, tokens };
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
      sessionId: 'latency-ladder',
      messages: [
        { role: 'system', content: fixture.system },
        { role: 'user', content: fixture.prompt },
      ],
      skipPromptPipeline: true,
      maxTokens: opts.maxTokens,
    }),
  );
}

async function tierD({ fixture, runtime }) {
  const start = performance.now();
  let first = null;
  const result = await runtime.engine.run({
    goal: fixture.prompt,
    maxConcurrentSubagents: 1,
    enableVerification: false,
  });
  if (first === null) first = performance.now() - start;
  const outChars = (result.summary ?? '').length;
  return {
    ttftMs: null, // runtime renders once at the end today
    totalMs: performance.now() - start,
    chars: outChars,
    tokens: result.usage?.outputTokens,
  };
}

// ---------------------------------------------------------------------------
// Mock transport for --dry mode
// ---------------------------------------------------------------------------

function makeMockFetch() {
  return (async (input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const chunks = ['Hello ', 'from ', 'mock ', 'stream.'];
    const wantsStream = body.stream === true;
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const c of chunks) {
          if (wantsStream) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`,
              ),
            );
          }
          await new Promise((r) => setTimeout(r, 15));
        }
        if (wantsStream) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                choices: [{ delta: {}, finish_reason: 'stop' }],
                usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
              })}\n\n`,
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
        controller.close();
      },
    });
    if (wantsStream) {
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return new Response(
      JSON.stringify({
        id: 'mock',
        model: body.model,
        choices: [
          { index: 0, message: { role: 'assistant', content: chunks.join('') }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

// ---------------------------------------------------------------------------
// Bootstrap SingularityAI / runtime from the workspace packages
// ---------------------------------------------------------------------------

async function loadRouter() {
  return import(pathToFileURL(join(ROOT, 'packages/router/dist/index.js')).href);
}

async function loadRuntime() {
  return import(pathToFileURL(join(ROOT, 'packages/runtime/dist/index.js')).href);
}

function resolveAuth() {
  // .env / explicit env keys win; bundled fallbacks are last resort (may be stale).
  const apiKey =
    process.env.TOKENROUTER_API_KEY?.trim() ||
    process.env.AI_GATEWAY_API_KEY?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    '';
  const base = (
    process.env.TOKENROUTER_BASE_URL?.trim() ||
    process.env.AI_GATEWAY_BASE_URL?.trim() ||
    process.env.OPENROUTER_BASE_URL?.trim() ||
    'https://ai-gateway.vercel.sh/v1'
  ).replace(/\/$/, '');
  return { apiKey, base };
}

/** Minimal catalog entry so the routing engine has a candidate for tier C/D. */
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

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));

  const router = await loadRouter();
  router.applySingularityBundledEnv();
  const auth = resolveAuth();

  const mockFetch = opts.dry ? makeMockFetch() : undefined;
  if (opts.dry) {
    // Route the provider's fetch through the mock transport.
    process.env.AI_GATEWAY_BASE_URL = 'https://mock.local/v1';
    auth.base = 'https://mock.local/v1';
    auth.apiKey = 'mock-key';
    // Keep dry runs fully offline and unthrottled: the specialty / flash-pro /
    // decision classifiers use global fetch (not the mocked provider
    // transport), and the process-wide rate gate spaces initiations 15s apart
    // at the default 4 RPM — both would poison dry-mode latency numbers.
    process.env.SINGULARITY_LLM_ROUTER = '0';
    process.env.SINGULARITY_SPECIALTY_LLM = '0';
    process.env.SINGULARITY_NEMOTRON_ROUTER = '0';
    router.setRateGateConfig({ rpm: 1_000_000, rateLimitedCooldownMs: 1, minSpacingMs: 0 });
  }

  const provider = new router.OpenRouterProvider({
    apiKey: auth.apiKey,
    baseUrl: auth.base,
    ...(mockFetch ? { fetch: mockFetch } : {}),
  });

  const ai = router.createSingularityAI({
    workspaceId: 'latency-ladder',
    routing: {
      models: [makeLadderModelSpec(opts.model)],
    },
    adapter: {
      openrouter: {
        apiKey: auth.apiKey,
        baseUrl: auth.base,
        ...(mockFetch ? { fetch: mockFetch } : {}),
      },
    },
  });

  let runtime = null;
  if (opts.tiers.includes('D')) {
    const rt = await loadRuntime();
    const workspace = new rt.InMemoryWorkspace({
      'src/index.ts': 'export const x = 1;\n',
    });
    runtime = {
      engine: rt.createRuntimeEngineFromAI({
        ai,
        workspace,
        edit: new rt.InMemoryEditPort(workspace),
        concurrency: 1,
        enableVerification: false,
        sessionId: 'latency-ladder',
      }),
    };
  }

  if (!opts.dry && !auth.apiKey) {
    console.error(
      'No API key found (AI_GATEWAY_API_KEY / OPENROUTER_API_KEY). Use --dry for a mock run.',
    );
    process.exit(1);
  }

  console.log(
    `Latency ladder · model=${opts.model} · runs=${opts.runs} · tiers=${opts.tiers.join(',')} ${opts.dry ? '(dry)' : '(LIVE)'}`,
  );

  const results = {};
  for (const tier of opts.tiers) {
    results[tier] = {};
    for (const fixture of FIXTURES) {
      const samples = [];
      for (let i = 0; i < opts.runs; i++) {
        try {
          let sample;
          const attempt = async (isRetry) => {
            if (tier === 'A') return tierA({ fixture, opts, auth, fetchFn: mockFetch });
            if (tier === 'B') return tierB({ fixture, opts, provider });
            if (tier === 'C') return tierC({ fixture, opts, ai });
            if (tier === 'D') {
              if (!runtime) throw new Error('runtime not initialized');
              return tierD({ fixture, runtime });
            }
            throw new Error(`unknown tier ${tier}`);
          };
          try {
            sample = await attempt(false);
          } catch (err) {
            // One retry after the RPM window rolls over.
            if (/429/.test(String(err))) {
              console.log(`  [${tier}] ${fixture.id} #${i + 1}: 429 — waiting 65s for rate window`);
              await new Promise((r) => setTimeout(r, 65000));
              sample = await attempt(true);
            } else {
              throw err;
            }
          }
          samples.push({ ok: true, ...sample });
          console.log(
            `  [${tier}] ${fixture.id} #${i + 1}: ttft=${sample.ttftMs ?? '—'}ms total=${Math.round(sample.totalMs)}ms chars=${sample.chars}`,
          );
        } catch (err) {
          samples.push({ ok: false, error: err instanceof Error ? err.message : String(err) });
          console.log(`  [${tier}] ${fixture.id} #${i + 1}: ERROR ${err instanceof Error ? err.message : err}`);
        }
        // Respect the shared-account RPM gate between live calls (gateway: 5 req/min).
        if (!opts.dry) {
          await new Promise((r) => setTimeout(r, 13000));
        }
      }
      results[tier][fixture.id] = summarize(samples);
      const s = summarize(samples);
      console.log(
        `  [${tier}] ${fixture.id}: ttft p50=${s.ttftP50Ms}ms mean=${s.ttftMeanMs}ms · total p50=${s.totalP50Ms}ms (${s.okRuns}/${s.runs} ok)`,
      );
    }
  }

  const metrics = {
    startedAt: new Date().toISOString(),
    mode: opts.dry ? 'dry' : 'live',
    model: opts.model,
    runs: opts.runs,
    maxTokens: opts.maxTokens,
    tiers: results,
    attribution: computeAttribution(results),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`\nWrote ${OUT_PATH}`);
  printTable(results);
}

function computeAttribution(results) {
  const attr = {};
  const p50 = (tier, fx) => results[tier]?.[fx]?.totalP50Ms;
  for (const fx of Object.keys(results.A ?? results.B ?? results.C ?? {})) {
    attr[fx] = {
      providerOverheadMs:
        p50('B', fx) !== undefined && p50('A', fx) !== undefined
          ? p50('B', fx) - p50('A', fx)
          : undefined,
      routingAndPipelineMs:
        p50('C', fx) !== undefined && p50('B', fx) !== undefined
          ? p50('C', fx) - p50('B', fx)
          : undefined,
      orchestrationMs:
        p50('D', fx) !== undefined && p50('C', fx) !== undefined
          ? p50('D', fx) - p50('C', fx)
          : undefined,
    };
  }
  return attr;
}

function printTable(results) {
  console.log('\nLayer attribution (total p50, ms):');
  console.log('fixture            |    A    |    B    |    C    |    D');
  for (const fx of new Set(Object.values(results).flatMap((t) => Object.keys(t)))) {
    const cell = (t) => String(results[t]?.[fx]?.totalP50Ms ?? '—').padStart(6);
    console.log(`${fx.padEnd(18)} | ${cell('A')} | ${cell('B')} | ${cell('C')} | ${cell('D')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
