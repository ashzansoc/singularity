#!/usr/bin/env node
/**
 * Budget gate: compares a latency-ladder run (METRICS.json) against BUDGETS.json.
 *
 * Usage:
 *   node benchmarks/latency-ladder/check-budgets.mjs            # check existing METRICS.json
 *   node benchmarks/latency-ladder/check-budgets.mjs --dry      # run dry harness first, then check
 *   node benchmarks/latency-ladder/check-budgets.mjs --runs 3   # run live harness first, then check
 *
 * Exit 0 = within budget, exit 1 = regression or missing data.
 * The live section is skipped when METRICS.json was produced in dry mode
 * (dry runs cannot measure network-dependent budgets).
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const METRICS_PATH = join(__dirname, 'METRICS.json');
const BUDGETS_PATH = join(__dirname, 'BUDGETS.json');

const args = process.argv.slice(2);
if (args.includes('--dry') || args.includes('--runs')) {
  const passThrough = args.filter((a) => a !== '--dry');
  const res = spawnSync(
    process.execPath,
    [join(__dirname, 'run.mjs'), ...(passThrough.length ? passThrough : ['--dry'])],
    { stdio: 'inherit' },
  );
  if (res.status !== 0) {
    console.error('harness failed; budgets not checked');
    process.exit(1);
  }
}

if (!existsSync(METRICS_PATH)) {
  console.error(`No ${METRICS_PATH}. Run the ladder first: node benchmarks/latency-ladder/run.mjs --dry`);
  process.exit(1);
}
const metrics = JSON.parse(readFileSync(METRICS_PATH, 'utf8'));
const budgets = JSON.parse(readFileSync(BUDGETS_PATH, 'utf8'));

const failures = [];
const checks = [];

function check(label, actual, max) {
  if (actual === undefined || actual === null || Number.isNaN(actual)) {
    failures.push(`${label}: no data`);
    return;
  }
  const ok = actual <= max;
  checks.push({ label, actual, max, ok });
  if (!ok) failures.push(`${label}: ${actual}ms > budget ${max}ms`);
}

function p50(tier, fx, key) {
  return metrics.tiers?.[tier]?.[fx]?.[key];
}

const fixtures = new Set(
  Object.values(metrics.tiers ?? {})
    .filter((t) => t && typeof t === 'object')
    .flatMap((t) => Object.keys(t)),
);

const isDry = metrics.mode === 'dry';
const budgetSection = isDry ? budgets.dry : { ...budgets.dry, ...budgets.live };

for (const fx of fixtures) {
  check(
    `B.totalP50[${fx}]`,
    p50('B', fx, 'totalP50Ms'),
    budgetSection.tierBTotalP50MsMax,
  );
  check(
    `C.totalP50[${fx}]`,
    p50('C', fx, 'totalP50Ms'),
    budgetSection.tierCTotalP50MsMax,
  );
  check(`C.ttftP50[${fx}]`, p50('C', fx, 'ttftP50Ms'), budgetSection.tierCTtftP50MsMax);

  const attr = metrics.attribution?.[fx] ?? {};
  check(
    `routingOverheadP50[${fx}]`,
    attr.routingAndPipelineMs,
    budgetSection.routingOverheadP50MsMax,
  );
  if (!isDry) {
    check(
      `providerOverheadP50[${fx}]`,
      attr.providerOverheadMs,
      budgetSection.providerOverheadP50MsMax,
    );
  }
}

console.log(`\nBudget check (${isDry ? 'dry' : 'live'} mode, model=${metrics.model}):`);
for (const c of checks) {
  console.log(
    `  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label.padEnd(34)} ${String(c.actual).padStart(6)}ms ≤ ${c.max}ms`,
  );
}

if (failures.length) {
  console.error(`\n${failures.length} budget violation(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nAll budgets within limits.');
