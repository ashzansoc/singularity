#!/usr/bin/env node
/**
 * Token compare harness — normal DeepSeek prefix cache vs engines-augmented prefix cache.
 *
 * Arms (both use DeepSeek automatic context caching; no OpenRouter):
 *   normal   — realistic agent system + tool schemas (engines OFF)
 *   engines  — same normal prefix + Context/Wiki/Memory/Architecture/etc blocks (engines ON)
 *
 * Models: deepseek-v4-flash · deepseek-v4-pro only (DeepSeek direct API).
 *
 * Usage:
 *   node benchmarks/token-compare/run.mjs
 *   node benchmarks/token-compare/run.mjs --model flash|pro|both
 *   node benchmarks/token-compare/run.mjs --arm normal|engines|both
 *   node benchmarks/token-compare/run.mjs --warm 2
 *
 * Auth: DEEPSEEK_API_KEY + DEEPSEEK_BASE_URL (or ~/.singularity/deepseek.json)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const OUT_DIR = join(__dirname, 'results');

const FLASH = 'deepseek-v4-flash';
const PRO = 'deepseek-v4-pro';
const DEFAULT_BASE = 'https://api.deepseek.com';

function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}

function mapDeepSeekModel(input) {
  const id = String(input || '').trim().toLowerCase();
  if (!id || id === 'both') return null;
  if (id === 'flash' || id.includes('flash')) return FLASH;
  if (id === 'pro' || id.includes('pro')) return PRO;
  if (id === FLASH || id === PRO) return id;
  throw new Error(
    `Unsupported model "${input}". Use only DeepSeek V4: flash | pro | ${FLASH} | ${PRO}`,
  );
}

function resolveModels(arg) {
  const raw = String(arg || 'both').trim().toLowerCase();
  if (raw === 'both' || raw === 'all') return [FLASH, PRO];
  return [mapDeepSeekModel(raw)];
}

function parseArgs(argv) {
  const out = {
    model: process.env.TOKEN_COMPARE_MODEL || 'both',
    arm: 'both', // normal | engines | both  (baseline = alias for normal)
    warm: 2,
    maxTokens: 256,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') out.model = argv[++i];
    else if (a === '--arm') out.arm = argv[++i];
    else if (a === '--warm') out.warm = Number(argv[++i]) || 0;
    else if (a === '--max-tokens') out.maxTokens = Number(argv[++i]) || 256;
  }
  if (out.arm === 'baseline') out.arm = 'normal';
  return out;
}

function getDeepSeekAuth() {
  let file = {};
  const filePath = join(homedir(), '.singularity', 'deepseek.json');
  if (existsSync(filePath)) {
    try {
      file = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      file = {};
    }
  }
  const apiKey = (process.env.DEEPSEEK_API_KEY || file.apiKey || '').trim();
  const base = (process.env.DEEPSEEK_BASE_URL || file.baseUrl || DEFAULT_BASE).trim().replace(/\/$/, '');
  return { apiKey, base };
}

/**
 * Normal agent prefix — engines OFF.
 * Sized to exceed DeepSeek's ~256-token cache block so automatic prefix cache can hit.
 * Mirrors a typical coding-agent system + tool schemas without Singularity engine injection.
 */
const NORMAL_SYSTEM = `You are Singularity's coding agent (engines off). Answer from repo knowledge; do not invent files.

## Role
- Help with coding, debugging, refactors, and explanations in this TypeScript/Node/React monorepo.
- Prefer the cheapest correct approach. Be direct. Prefer bullets. For code, return only what was asked.
- Never dump secrets. Never claim tools ran when they did not.
- If unsure, say which files you would open first.

## Workspace conventions
- Package manager: npm. Prefer existing patterns in packages/ and vscode/extensions/.
- Do not rewrite unrelated files. Keep diffs tight.
- Tests live near the code they cover when present.
- Prefer TypeScript strictness already used in the file you touch.
- Avoid drive-by refactors, new markdown docs, and speculative abstractions.

## Stable tool schemas (always present; engines off)
read_file:
  description: Read a file slice by path.
  parameters: { path: string, start_line?: number, end_line?: number }
search_codebase:
  description: Semantic / text search across the workspace.
  parameters: { query: string, glob?: string, max_results?: number }
grep:
  description: Exact regex search.
  parameters: { pattern: string, path?: string, glob?: string, case_insensitive?: boolean }
apply_patch:
  description: Apply a unified diff to the workspace.
  parameters: { diff: string }
run_terminal:
  description: Run a shell command in the workspace.
  parameters: { command: string, cwd?: string, block_until_ms?: number }
list_dir:
  description: List directory entries.
  parameters: { path: string }
glob_files:
  description: Find files by glob.
  parameters: { pattern: string }
read_lints:
  description: Read linter diagnostics for paths.
  parameters: { paths?: string[] }

## Tool-use policy
1. Prefer read/search before edit.
2. After edits, re-read or check lints when relevant.
3. Do not run destructive git commands unless explicitly asked.
4. Batch independent reads.
5. Keep terminal commands non-interactive.

## Output contract
- Short answers for Q&A.
- For implementations: code first, brief notes second.
- For plans: numbered steps + risks.
- Frontend: one composition, brand-first when branded, no generic purple SaaS defaults.
- Backend: leave clear seams; do not overbuild.

## Few-shot style anchors (stable; do not change)
User: How do I run tests?
Assistant: From repo root: \`npm test\` (or the package-local script in that package's package.json).

User: Rename a symbol safely.
Assistant: 1) Find all references 2) Rename definition 3) Update imports 4) Run typecheck/tests 5) Fix stragglers.

User: Debug undefined .map in React.
Assistant: Check data is defined before map; verify fetch/loading state; confirm prop name; guard with Array.isArray; inspect parent that supplies the list.

## End of normal agent prefix
All of the above is the stable engines-off system prompt used for DeepSeek automatic context caching measurements.`;

/** Engines ON = identical normal prefix + stable engine context blocks (prompt-cache friendly). */
const ENGINES_EXTRA = `

## Project Context Engine (stable snapshot)
- Product: Singularity AI IDE (VS Code fork)
- Active workspace root: /Users/ashutosh/Singularity
- Stack: TypeScript, Node, Electron/VS Code, React, npm workspaces
- Primary packages: packages/router, packages/design, vscode/extensions/singularity-chat
- Routing policy: Flash for greetings/Q&A; Pro for coding/agent/frontend
- Active models: deepseek-v4-flash, deepseek-v4-pro (DeepSeek direct)

## Wiki Engine (stable index excerpt)
- Architecture: agent host streams turns; singularity extension owns chat UI and BYOK endpoints.
- Token path: DeepSeek direct for catalog DeepSeek models; TokenRouter otherwise.
- Design Intelligence: frontend owner + visual critic on Pro when specialty=frontend.
- Cache Engine: prefers stable system/tool prefixes so provider prompt cache can hit.
- Memory Engine: durable facts about user preferences and project decisions.
- Outcome Engine: tracks whether prior turns achieved the stated goal.
- Risk / Impact / Production Awareness: call out blast radius before risky edits.

## Memory Engine (stable facts)
- User preference: measure input/output/cache tokens explicitly.
- User preference: DeepSeek V4 flash/pro via direct API only for this benchmark.
- Project decision: Auto routes between flash and pro; do not silently swap to OpenRouter GLM.
- Project decision: Engines inject stable context blocks ahead of the user turn when enabled.

## Architecture Engine (stable map)
- vscode/ → IDE fork + extensions
- packages/router → local + Nemotron flash/pro routing helpers
- packages/design → frontend owner / visual critic constants
- benchmarks/token-compare → this measurement harness
- Agent path: intent → model resolve → chat completions → tool loop → response parts

## Outcome / Risk (stable checklist)
- Prefer grounded file reads over speculation.
- Call out auth, billing, and destructive shell risk.
- After multi-file edits, summarize what changed and how to verify.

## End of engines-on augmentation
Everything above the engines sections is identical to the normal arm so DeepSeek prefix cache can share the leading normal agent blocks when warm; engines add additional stable cacheable prefix.`;

const ENGINES_SYSTEM = NORMAL_SYSTEM + ENGINES_EXTRA;

function extractUsage(data) {
  const u = data?.usage ?? {};
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
  const completion = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
  const details = u.prompt_tokens_details ?? u.input_tokens_details ?? {};
  const cached =
    Number(
      u.prompt_cache_hit_tokens ??
        details.cached_tokens ??
        details.cache_read_input_tokens ??
        u.cache_read_input_tokens ??
        u.cached_tokens ??
        0,
    ) || 0;
  return {
    promptTokens: prompt,
    completionTokens: completion,
    cachedTokens: Math.min(cached, prompt),
    freshInputTokens: Math.max(0, prompt - Math.min(cached, prompt)),
    totalTokens: prompt + completion,
    cacheMissTokens: Number(u.prompt_cache_miss_tokens ?? 0) || 0,
    raw: u,
  };
}

async function chatComplete({ base, apiKey, model, system, user, maxTokens }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    temperature: 0,
  };

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(data?.error ?? data).slice(0, 300)}`);
  }
  const content = data?.choices?.[0]?.message?.content ?? '';
  return { usage: extractUsage(data), model: data.model ?? model, content: String(content).slice(0, 200) };
}

function sumUsage(rows) {
  return rows.reduce(
    (a, r) => {
      const u = r.usage;
      a.promptTokens += u.promptTokens;
      a.completionTokens += u.completionTokens;
      a.cachedTokens += u.cachedTokens;
      a.freshInputTokens += u.freshInputTokens;
      a.totalTokens += u.totalTokens;
      a.calls += 1;
      return a;
    },
    { promptTokens: 0, completionTokens: 0, cachedTokens: 0, freshInputTokens: 0, totalTokens: 0, calls: 0 },
  );
}

function pct(n, d) {
  if (!d) return '0%';
  return `${((100 * n) / d).toFixed(1)}%`;
}

function markdownReport(run) {
  const lines = [];
  lines.push(`# Token compare — ${run.startedAt}`);
  lines.push('');
  lines.push(`Provider: DeepSeek direct · Base: \`${run.base}\``);
  lines.push('');
  lines.push(
    'Arms: **normal** = realistic agent + tools (engines off, still DeepSeek auto cache) · **engines** = same prefix + engine context blocks.',
  );
  lines.push('');
  for (const modelRun of run.models) {
    lines.push(`## Model \`${modelRun.model}\``);
    lines.push('');
    lines.push('| Arm | Calls | Input | Fresh input | Cache read | Cache % of input | Output | Total |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const [name, arm] of Object.entries(modelRun.arms)) {
      const s = arm.totals;
      lines.push(
        `| ${name} | ${s.calls} | ${s.promptTokens} | ${s.freshInputTokens} | ${s.cachedTokens} | ${pct(s.cachedTokens, s.promptTokens)} | ${s.completionTokens} | ${s.totalTokens} |`,
      );
    }
    if (run.cursor?.totals) {
      const s = run.cursor.totals;
      lines.push(
        `| cursor (manual) | ${s.calls ?? '—'} | ${s.promptTokens} | ${s.freshInputTokens ?? '—'} | ${s.cachedTokens} | ${pct(s.cachedTokens, s.promptTokens)} | ${s.completionTokens} | ${s.totalTokens} |`,
      );
    }
    lines.push('');
    if (modelRun.arms.normal && modelRun.arms.engines) {
      const n = modelRun.arms.normal.totals;
      const e = modelRun.arms.engines.totals;
      lines.push('### Delta (normal cache → engines-on cache)');
      lines.push(
        `- Cache read: **${n.cachedTokens}** → **${e.cachedTokens}** (Δ **${e.cachedTokens - n.cachedTokens}**)`,
      );
      lines.push(
        `- Cache % of input: **${pct(n.cachedTokens, n.promptTokens)}** → **${pct(e.cachedTokens, e.promptTokens)}**`,
      );
      lines.push(
        `- Fresh input: **${n.freshInputTokens}** → **${e.freshInputTokens}** (Δ **${e.freshInputTokens - n.freshInputTokens}**)`,
      );
      lines.push(
        `- Total input: **${n.promptTokens}** → **${e.promptTokens}** (engines add **${e.promptTokens - n.promptTokens}** input tokens; most should be cacheable)`,
      );
      lines.push('');
    }
    lines.push('### Per-prompt');
    lines.push('');
    for (const [name, arm] of Object.entries(modelRun.arms)) {
      lines.push(`#### ${name}`);
      lines.push('| id | input | cache | fresh | output |');
      lines.push('|---|---:|---:|---:|---:|');
      for (const row of arm.rows) {
        lines.push(
          `| ${row.id} | ${row.usage.promptTokens} | ${row.usage.cachedTokens} | ${row.usage.freshInputTokens} | ${row.usage.completionTokens} |`,
        );
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

async function runArm({ name, system, prompts, opts, base, apiKey, model }) {
  const rows = [];
  for (let w = 0; w < opts.warm; w++) {
    await chatComplete({
      base,
      apiKey,
      model,
      system,
      user: 'ping',
      maxTokens: 8,
    });
  }
  for (const p of prompts) {
    const result = await chatComplete({
      base,
      apiKey,
      model,
      system,
      user: p.text,
      maxTokens: opts.maxTokens,
    });
    rows.push({ id: p.id, category: p.category, usage: result.usage, model: result.model });
    console.log(
      `[${model}/${name}] ${p.id}: in=${result.usage.promptTokens} cache=${result.usage.cachedTokens} fresh=${result.usage.freshInputTokens} out=${result.usage.completionTokens}`,
    );
  }
  return { name, systemChars: system.length, rows, totals: sumUsage(rows) };
}

async function runModel({ model, prompts, opts, base, apiKey }) {
  const arms = {};
  if (opts.arm === 'normal' || opts.arm === 'both') {
    arms.normal = await runArm({
      name: 'normal',
      system: NORMAL_SYSTEM,
      prompts,
      opts,
      base,
      apiKey,
      model,
    });
  }
  if (opts.arm === 'engines' || opts.arm === 'both') {
    arms.engines = await runArm({
      name: 'engines',
      system: ENGINES_SYSTEM,
      prompts,
      opts,
      base,
      apiKey,
      model,
    });
  }
  return { model, arms };
}

async function main() {
  loadEnv();
  const opts = parseArgs(process.argv.slice(2));
  const { apiKey, base } = getDeepSeekAuth();

  if (!apiKey) {
    console.error(
      'Missing DeepSeek API key. Set DEEPSEEK_API_KEY (and optional DEEPSEEK_BASE_URL) or ~/.singularity/deepseek.json',
    );
    process.exit(1);
  }

  const models = resolveModels(opts.model);
  const suite = JSON.parse(readFileSync(join(__dirname, 'prompts.json'), 'utf8'));
  const startedAt = new Date().toISOString();

  console.log(
    `Token compare → DeepSeek ${base} models=${models.join(',')} arm=${opts.arm} warm=${opts.warm}`,
  );
  console.log(`normal system chars=${NORMAL_SYSTEM.length} · engines system chars=${ENGINES_SYSTEM.length}`);

  const modelRuns = [];
  for (const model of models) {
    modelRuns.push(await runModel({ model, prompts: suite.prompts, opts, base, apiKey }));
  }

  let cursor;
  const cursorPath = join(__dirname, 'cursor-results.json');
  if (existsSync(cursorPath)) {
    cursor = JSON.parse(readFileSync(cursorPath, 'utf8'));
  }

  const run = {
    suite: suite.suite,
    startedAt,
    provider: 'deepseek-direct',
    comparison: 'normal-cache-vs-engines-cache',
    base,
    warm: opts.warm,
    systemChars: { normal: NORMAL_SYSTEM.length, engines: ENGINES_SYSTEM.length },
    models: modelRuns,
    cursor: cursor ?? null,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, '-');
  const jsonPath = join(OUT_DIR, `run-${stamp}.json`);
  const mdPath = join(OUT_DIR, `run-${stamp}.md`);
  const latestJson = join(OUT_DIR, 'latest.json');
  const latestMd = join(OUT_DIR, 'latest.md');
  writeFileSync(jsonPath, JSON.stringify(run, null, 2));
  writeFileSync(latestJson, JSON.stringify(run, null, 2));
  const md = markdownReport(run);
  writeFileSync(mdPath, md);
  writeFileSync(latestMd, md);
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log('\n' + md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
