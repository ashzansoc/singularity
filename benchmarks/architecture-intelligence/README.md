# Architecture Intelligence benchmarks

Run:

```bash
npm run test -w @singularity/architecture
```

`METRICS.json` is written by the TPS A–H test (100 concurrent mock coding requests). Scenario F is production-awareness queue pressure on the same coding tick (`emit` + `lookup` only). Scenario H is impact-analysis enqueue with the publisher paused so the tick cannot run Tree-sitter/SCIP.
