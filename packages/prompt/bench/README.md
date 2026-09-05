# Prompt Engine Benchmarks

## Targets

| Metric | Target |
|--------|--------|
| Warm prompt compilation | < 100 ms |
| Average input tokens vs naive full-repo dump | 60–90% reduction |
| Prompt construction overhead | 80–90% reduction via IR cache + delta |
| Prompt size across long conversations | Stable (summary + recent turns) |

## How to run

```bash
npm run bench -w @singularity/prompt
```

## Methodology notes (vs Cursor / Windsurf / Cline / Roo)

We cannot instrument closed products. Comparisons use **proxy workloads**:

1. Same synthetic repo (N files, M symbols)
2. Same conversation length (T turns)
3. Measure Singularity Prompt Engine compile/retrieve/cache stats
4. Compare against a naive baseline in-repo: concatenate open files + full history

Competitive claims should cite these proxy numbers, not undocumented third-party internals.
