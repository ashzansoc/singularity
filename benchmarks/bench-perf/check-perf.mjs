#!/usr/bin/env node
/**
 * bench-perf gate — asserts the Singularity pipeline did NOT regress vs its own
 * most recent captured baseline (latest.json), using stable, meaningful signals:
 *
 *   1. Functionality gate (hard): tier C (SingularityAI) must have okRuns > 0 —
 *      any 100% 400/failure regresses the mission (this caught the zai/glm-5.2
 *      routing bug).
 *   2. TTFT envelope (soft, derived): median TTFT for tiers B/C must not exceed
 *      3× the same run's tier A (raw-gateway) median — i.e. the pipeline must
 *      not add more than ~3× the network's own first-token latency. This is
 *      gateway-variance-relative, so it works across provider-speed changes.
 *   3. Throughput floor (soft, derived): when tier C streamed >0 tokens, its
 *      rendered TPS must be >0 (a true dead/zero-TPS pipeline is a regression).
 *
 * Exit 0 = passed, exit 1 = any violation. No assumptions about absolute TPS
 * targets — the gateway's variance dominates single-run numbers, so the gate is
 * relative (Rule 9: measure, don't assume).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(__dirname, 'results', 'latest.json');

const fail = [];
const warn = [];

function num(x) {
  return x !== undefined && x !== null && !Number.isNaN(x) ? x : undefined;
}
function hasOkTier(t) {
  return !!t && (t.okRuns ?? 0) > 0;
}

let results;
try {
  results = JSON.parse(readFileSync(RESULTS, 'utf8'));
} catch {
  console.error(`No ${RESULTS}. Run: node benchmarks/bench-perf/run.mjs --side singularity --tiers A,B,C --runs 3`);
  process.exit(1);
}

const fixtures = results.fixtures ?? {};
if (Object.keys(fixtures).length === 0) {
  console.error('no fixtures recorded');
  process.exit(1);
}

for (const [fid, arms] of Object.entries(fixtures)) {
  const sing = arms?.singularity;
  if (!sing) {
    warn.push(`${fid}: no singularity arms measured (skipped)`);
    continue;
  }
  const A = sing.A;
  const B = sing.B;
  const C = sing.C;

  // 1. Functionality: tier C must succeed at least once.
  if (!hasOkTier(C)) {
    fail.push(
      `${fid}: tier C (SingularityAI) produced no successful runs — functional regression (errors: ${(C?.errors ?? []).slice(0, 2).join(' | ')})`,
    );
    continue;
  }

  // 2. TTFT envelope vs raw gateway (gateway-relative).
  const aTtft = num(A?.ttftP50Ms);
  const bTtft = num(B?.ttftP50Ms);
  const cTtft = num(C?.ttftP50Ms);
  if (aTtft !== undefined) {
    if (bTtft !== undefined && bTtft > aTtft * 3 + 250) {
      warn.push(`${fid}: tier B TTFT (${Math.round(bTtft)}ms) > 3× raw gateway (${Math.round(aTtft)}ms) + 250ms`);
    }
    if (cTtft !== undefined && cTtft > aTtft * 3 + 250) {
      warn.push(`${fid}: tier C TTFT (${Math.round(cTtft)}ms) > 3× raw gateway (${Math.round(aTtft)}ms) + 250ms`);
    }
  }

  // 3. Throughput: a streamed tier C must not be dead-zero.
  const cTps = num(C?.tpsRenderedMean);
  if (cTps !== undefined && cTps === 0 && (C?.tokensMean ?? 0) > 0) {
    fail.push(`${fid}: tier C streamed tokens but rendered 0 TPS — pipeline dead`);
  }
}

console.log(
  `bench-perf gate: fixtures=${Object.keys(fixtures).length}, failed=${fail.length}, warnings=${warn.length}`,
);
for (const w of warn) console.log(`  [warn] ${w}`);
for (const f of fail) console.log(`  [FAIL] ${f}`);
process.exit(fail.length ? 1 : 0);