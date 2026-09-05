# Singularity Chat Runtime — Implementation Plan

Status: Plan only (Rule 1 — no code modified in the investigation phase).

Goal: bring Singularity's chat runtime throughput/TTFT closer to DeepSeek Harness
while **preserving every Singularity subsystem** (memory, context, neural relay,
model router, mission controller, planning, tools, verification, persistence, UI,
observability, auth, integrations).

Every step below is (a) backward compatible, (b) toggleable, (c) measured
before/after with `benchmarks/bench-perf`, (d) covered by the regression suite.

---

## The core principle

Separate the **hot path** (what must happen before the first token) from the
**async path** (everything else):

```
HOT (must block first token):
  user input → minimal context → model request → stream → UI
ASYNC (never blocks first token):
  memory persistence, telemetry, embeddings, graph updates, history,
  analytics, background summarization, non-critical context enrichment
```

Never make the user wait for background Singularity intelligence before the
first token unless it is genuinely required for correctness.

---

## Step 0 — Baseline (DONE)
`benchmarks/bench-perf/run.mjs` + `results/` captured the before picture,
including live evidence that raw OpenRouter TTFT varies 1.3s–20.6s and TPS
45–107 — i.e. the gateway is a large variance source, and the pipeline must
not add to it.

## Step 1 — Rate-gate lane separation + slot timeout (highest value)
**File:** `packages/router/src/rateLimit.ts`

Do NOT remove the gate (Rule: keep throttle behavior). Change it so:
- `waitForSlot()` gets a **hard deadline** (env `SINGULARITY_LLM_SLOT_TIMEOUT_MS`,
  default 30s). If a slot is not available in time, the request proceeds
  **unthrottled** (bypasses the spacing for that initiation) instead of queuing
  forever. This converts a silent 10-minute "Evaluating" hang into at most a
  30s wait then a real attempt.
- Add an **interactive lane** (`gateLlmRequest(fn, {signal, priority:'interactive'})`)
  that is not appended to the shared `queueTail` behind workers. Interactive
  chat requests get their own queue head so they are not serialized behind
  background agent LLM calls at 15s spacing. Workers use the existing lane.
- Keep `noteRateLimited`/429 cooldown behavior exactly as-is for both lanes.

**Why:** measured #1 bottleneck — default 4 RPM + serialized queue tail turns
background/parallel work into a health-of-chat throttle. This is the 
"chat stuck on Evaluating for 10 minutes" mechanism.

**Regression:** rateLimit tests must still pass; new tests for slot-timeout
+ lane bypass.

## Step 2 — Hot-path routing trim (no routing removal)
**Files:** `packages/router/src/engine.ts`, `specialtyClassifier.ts`

- Route decision stays authoritative (user → router → best model — Rule 5).
- Move the specialty-classifier LLM hop **off the first-token critical path**:
  - When `modelId`/`preferredTier` is forced (common in chat), skip the LLM
    hop entirely **(already implemented** — `routeAsync` lines 96-101).
  - Otherwise fire classification **in parallel** with the model call when the
    memo misses, so TTFT isn't extended by a serial Nemotron round trip; the
    classification result is used for the *next* turn's routing.
- Keep memoization (60s TTL) and the 2.5s hard timeout. Never remove routing.

## Step 3 — Zero-copy SSE parsing (provider hygiene)
**File:** `packages/router/src/providers/openrouter.ts`

Replace the manual `buffer += decoder.decode(...)` + `\n`-scan + `slice`/`trim`
loop with a single-pass streaming parser (the Harness pattern: `TextDecoderStream`
→ `EventSourceParserStream`-equivalent, one `JSON.parse` per frame).
- Preserve the exact provider boundary, error semantics, `[DONE]` handling,
  usage capture, cache headers.
- Reduces per-chunk garbage and string copying on the token hot path.

## Step 4 — UI streaming: batch renders, kill O(n²)
**Files (vendored chat, active Stack A):**
`vscode/extensions/singularity-chat/src/extension/prompt/node/pseudoStartStopConversationCallback.ts`,
`chatMLFetcher.ts`

- Batch per-delta `progress.markdown()`/`progress.thinkingProgress()` — flush
  the response stream at a cadence that still *looks* real-time (e.g. every
  32-64ms or every N tokens), instead of per SSE frame.
- Fix the O(n²) stop-word scanner: keep a running tail buffer instead of
  re-`join()`-ing the entire staged text on every delta (line 167).
- Keep citations/tool-invocation cards (per-tool, not per-token).

## Step 5 — Async decouple (Harness write-behind pattern)
- Channel persistence/telemetry/fingerprint-history/embedding writes to an
  async sink (write-behind, batched) so they never sit on the token path.
- Reuse existing stores — do not add a second persistence layer.

## Step 6 — Tool lifecycle & structured runtime
- Adapt Harness's tool *architecture* (executor, timeout, progress events,
  structured results) into the existing Singularity tool registry without
  replacing it; existing tools keep working.

## Step 7 — Benchmark & regression gates
- `benchmarks/bench-perf` runs before/after each step.
- `packages/*/test/*` extended: chat, streaming, tools, todo, questions,
  cancel, resume, memory, neural relay, router, mission, verification.

---

## Sequencing / safety
1. Step 1 is config + bounded-timeout only — lowest risk, highest value.
2. Step 2 has pre-existing escape hatches (`SINGULARITY_INLINE_CLASSIFIER=1`).
3. Steps 3-5 are behind flags; default preserves today's behavior until measured
   better.
4. Run `npm run test:packages` + `bench-perf` after every step; roll back any
   step that regresses a subsystem.

## Explicit non-goals
- Do NOT hard-code DeepSeek as the only provider.
- Do NOT delete/bypass/disable Neural Relay, Memory, Model Router, Mission
   Controller, or any engine.
- Do NOT rewrite Singularity around Harness; only adapt runtime ideas.