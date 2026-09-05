# Baseline Test Run (before any changes)

`npm run test:packages` — chained run, STOPS at packages/router due to 1 pre-existing failure:

- `packages/router/test/openrouter.test.ts` — "posts to /chat/completions with auth headers"
  Expected: `https://ai-gateway.vercel.sh/v1/chat/completions`
  Received: `https://openrouter.ai/api/v1/chat/completions`
  This test asserts an ai-gateway URL but the provider code posts to openrouter.ai.
  -> PRE-EXISTING failure, unrelated to any refactor.

Passing as of baseline (beyond router the chain stops, so results below are only for earlier packages):
- cache: 18 passed
- prompt: 340 passed
- design: 52 passed
- context: 14 passed
- wiki: 14 passed
- router: 119 passed / 1 failed (until chain halt)

Remaining packages (memory, architecture, outcome, intelligence, neural-relay, brain) NOT yet run — RERUN separately to establish full baseline.

## Baseline re-run (individual packages)

- memory: pass (fail 0)
- architecture: pass (fail 0)
- outcome: pass (fail 0)
- intelligence: pass (fail 0)
- brain: pass (fail 0)
- neural-relay: 36 passed (3 files)

ONLY PRE-EXISTING FAILURE: packages/router openrouter.test.ts (asserts ai-gateway URL, code posts openrouter.ai). Unrelated to refactor.
