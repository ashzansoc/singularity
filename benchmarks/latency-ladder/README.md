# Latency Ladder — Layer Attribution Benchmark

Measures where end-to-end latency is added across Singularity's stack:

| Tier | Layer |
|---|---|
| A | Direct gateway HTTP call (raw `fetch`, streaming) |
| B | `OpenRouterProvider` (+ SSE parsing) |
| C | `SingularityAI.completeStream` (routing + prompt pipeline + provider) |
| D | Full runtime engine run (planner → worker → integrator) |

## Usage

```bash
node benchmarks/latency-ladder/run.mjs --dry              # mock transport, no network
node benchmarks/latency-ladder/run.mjs --runs 3           # live, 3 runs per tier/fixture
node benchmarks/latency-ladder/run.mjs --tiers A,B,C      # select tiers
```

Auth: `.env` at repo root (`TOKENROUTER_API_KEY` / `AI_GATEWAY_*`) or
`OPENROUTER_API_KEY`. The gateway enforces **5 requests / minute** — the harness
paces calls 13s apart and retries once after a 65s cooldown on HTTP 429.
A full `A,B,C` pass with N runs takes ≈ `9 × N × 13s`.

## Output

- `METRICS.json` — per-tier/per-fixture TTFT + total p50/mean, layer attribution deltas
  (`B−A` = provider overhead, `C−B` = routing/prompt-pipeline overhead).
- `BUDGETS.json` — regression gates derived from the measured baselines above.
  Live numbers carry ~1s headroom (gateway jitter); dry numbers carry 2–4x headroom
  on in-process overhead. Update only from a fresh baseline.

## Budget gate

```bash
node benchmarks/latency-ladder/check-budgets.mjs --dry   # run harness + check (also: npm run perf:budgets)
node benchmarks/latency-ladder/check-budgets.mjs         # check existing METRICS.json only
```

Exit 1 on any violation; live-mode runs additionally enforce provider-overhead
and absolute-TTFT budgets. In dry mode tier A has no mock transport by design,
so network-dependent budgets are skipped there.

## Baseline (2026-08-21, live, deepseek/deepseek-v4-flash-0731, runs=1)

| fixture          | A total | B total | C total | B−A   | C−B   |
|------------------|--------:|--------:|--------:|------:|------:|
| explain          | 1099ms  | 2564ms  | 4246ms  | ~1.5s | ~1.7s |
| single-file-edit | 1167ms  | 2677ms  | 3899ms  | ~1.5s | ~1.2s |
| multi-file-goal  | 1336ms  | 2624ms  | 2554ms  | ~1.3s | ≈0    |

Streaming TTFT vs buffered totals: tier B/C stream first tokens in ~1.7–3.7s
while the pre-Step-2 non-streaming path only returned after the full generation.

Notes:
- Tier C includes a Nemotron specialty-classifier network hop on cold routing
  (`routeAsync`); Step 4 targets removing that from the hot path.
- Tier D requires a workspace fixture and is exercised in dry mode; live D is
  gated behind RPM budget and omitted by default.
