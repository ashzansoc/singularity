# Benchmark Perf — Harness vs Singularity Chat Runtime

Reproducible comparison of DeepSeek Harness (`dsh --profile headless`) vs the
Singularity chat runtime using **identical model, API key, prompt, temperature,
max tokens**.

## What it measures

| Metric | Definition |
|--------|-----------|
| TTFT | ms from request start to first content delta |
| Total latency | ms from request start to stream end |
| Raw network TPS | tokens/sec as received from the gateway |
| Parsed TPS | tokens/sec after SSE parsing (Singularity) |
| Rendered TPS | effective tokens/sec the consumer observes |
| Tokens | completion tokens (usage.total_tokens) |
| Tool-call latency | ms for a tool call round-trip (Harness) |

## Runs

```bash
# Singularity tiers (raw gateway A / provider B / SingularityAI C / runtime D)
node benchmarks/bench-perf/run.mjs --side singularity --tiers A,B,C
node benchmarks/bench-perf/run.mjs --side singularity --tiers A,B,C --dry

# DeepSeek Harness headless one-shot (uses ~/.dsh credentials, real model)
node benchmarks/bench-perf/run.mjs --side harness

# Full comparison (both sides, live)
node benchmarks/bench-perf/run.mjs
```

## Auth

- Singularity side: `OPENROUTER_API_KEY` from repo `.env` (default) or
  `~/.singularity/beta-auth.json`.
- Harness side: `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` from
  `~/.dsh/.credentials.yaml` (the harness's own credential store).

## Output

Writes `benchmarks/bench-perf/results/<side>-<timestamp>.json` and a
`results/latest.json` side-by-side for CI gates.
