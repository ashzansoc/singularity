/**
 * Benchmark local Qwen classifier + policy.
 *
 *   SINGULARITY_QWEN_ROUTER=1 npx tsx test/localRoutingBenchmark.ts
 *
 * If the MLX sidecar is unavailable, reports 100% fallback (does not fail CI).
 */

import { classifyAndRoute, disposeQwenClassifier } from '../src/localRoutingClassifier/index.js';
import { warmupQwenClassifier } from '../src/localRoutingClassifier/sidecarClient.js';

const PROMPTS = [
  'Rename the variable userName to username in src/user.ts.',
  'Rename UserService to AccountService throughout the repository.',
  'Replace http://localhost:3000 with the staging URL in config.',
  'Add a straightforward GET /health endpoint following the existing API pattern.',
  'Add a straightforward unit test for formatDate.',
  'Change the log level from debug to info in logger.ts.',
  'Add pagination to the list endpoint following existing API patterns.',
  'Explain what Array.prototype.map does in JavaScript.',
  'Users are intermittently being logged out. Investigate the codebase and identify the root cause.',
  'Production payment capture is failing for some Stripe transactions. Diagnose and fix.',
  'Investigate this security vulnerability in token validation.',
  'Update CSRF protection on the login form.',
  'Write a database migration to add a unique constraint on email.',
  'Plan an architecture migration from the monolith to services.',
  'Do a root cause analysis of the flaky checkout errors.',
  'Investigate why production API latency is intermittent and unexplained.',
  'Change JWT expiration from 15m to 1h.',
  'Improve caching for the user profile endpoint.',
  'Optimize the /search endpoint query.',
  'Modify production configuration to raise the log retention days.',
  'Refactor authentication code in the session helper.',
  'Modify database indexes on the orders table for read speed.',
  'Change the API timeout from 10s to 15s.',
  'Change the retry policy to 3 attempts with linear backoff.',
  'Implement a small helper to clamp numbers.',
  'Add a log line when the cache misses.',
  'Document the environment variables in README.',
  'Why does this reducer reset state on navigation?',
  'Walk through how the request pipeline authenticates users.',
  'Fix a typo in the error message string.',
];

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

async function main(): Promise<void> {
  const n = Math.max(100, Number(process.env.SINGULARITY_QWEN_BENCH_N) || 100);
  warmupQwenClassifier();
  // Give the sidecar a moment to spawn (model load may still be in progress).
  await new Promise((r) => setTimeout(r, 1500));

  const latencies: number[] = [];
  let fallbacks = 0;
  let failures = 0;
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const prompt = PROMPTS[i % PROMPTS.length]!;
    const decision = await classifyAndRoute(prompt);
    latencies.push(decision.latency_ms);
    if (decision.fallback) {
      fallbacks += 1;
    }
    if (decision.source === 'error' || decision.source === 'timeout') {
      failures += 1;
    }
  }
  const elapsed = Date.now() - t0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = latencies.reduce((s, x) => s + x, 0) / latencies.length;
  const report = {
    requests: n,
    elapsed_ms: elapsed,
    avg_routing_latency_ms: Math.round(avg * 10) / 10,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    p99_ms: percentile(sorted, 99),
    fallback_rate: fallbacks / n,
    classification_failures: failures,
    note: 'load_ms / TTFT / TPS are emitted by the sidecar on successful classify responses',
  };
  console.log(JSON.stringify(report, null, 2));
  disposeQwenClassifier();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
