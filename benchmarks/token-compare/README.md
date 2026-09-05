# Token compare benchmark

Compare **normal DeepSeek automatic prefix caching** (engines off) vs **engines-on** prefix caching.

Both arms use the DeepSeek direct API (`deepseek-v4-flash` / `deepseek-v4-pro`) and the same prompt suite. The only difference is the stable system prefix.

| Arm | What it is |
|-----|------------|
| **normal** | Realistic coding-agent system + tool schemas (long enough to hit DeepSeek cache blocks) |
| **engines** | Identical normal prefix **plus** Context / Wiki / Memory / Architecture / Outcome blocks |

Primary metrics from DeepSeek `usage`:

| Field | Meaning |
|-------|---------|
| `promptTokens` | Total input |
| `cachedTokens` | `prompt_cache_hit_tokens` |
| `freshInputTokens` | input − cache hits (miss-priced portion) |
| `completionTokens` | Output |

## Auth

- `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`
- or `~/.singularity/deepseek.json`

No OpenRouter / TokenRouter.

## Run

```bash
node benchmarks/token-compare/run.mjs
node benchmarks/token-compare/run.mjs --model flash
node benchmarks/token-compare/run.mjs --model pro
node benchmarks/token-compare/run.mjs --arm normal
node benchmarks/token-compare/run.mjs --arm engines --warm 2
```

Default: both models, both arms, `--warm 2` (primes each prefix before the suite).

Outputs: `results/latest.md` / `latest.json`.

## Cursor (manual)

Same prompts in `prompts.json` → fill `cursor-results.json` from the example file → re-run to include a Cursor row.
