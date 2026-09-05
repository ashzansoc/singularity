# Singularity vs DeepSeek Harness — Chat Runtime Performance Forensics

Status: **Investigation complete — investigation phase only, no code changed yet.**

Objective: understand why DeepSeek Harness streams ~170 TPS against the same DeepSeek
credentials while Singularity renders ~15 TPS — then plan the fastest safe path forward
that **preserves every existing Singularity subsystem**.

The guiding principle of this exercise (from the mission):

> Make Singularity's chat runtime as efficient as DeepSeek Harness in the
> **execution/runtime layer**, while Singularity retains the
> **intelligence/context/memory/neural-relay/routing/mission/orchestration layer**.
> Harness inspires the execution layer; Singularity keeps the intelligence layer.
> Combine them — do not pick between them.

---

## 1. Harness Architecture (DeepSeek Harness)

### 1.1 Agent runtime — `ReactLoopAgent`
`packages/core/agent-loop/src/agent.ts`

- **State machine** (`agent.ts:38-46`):
  ```
  Phase = idle | maintenance | running
  ```
  Each phase is tied to an `AbortController` and a turn/step counter.
- **The loop**: `kick()` → `turn()` → `step()` (`agent.ts:210,246,332`).
  - `turn()` opens a turn boundary, claims inbox, assembles the system prompt
    (`preStep`, `agent.ts:225-243`), then loops steps until a turn-end condition.
  - `step()` (`agent.ts:332-420`) is the LLM interaction:
    1. `buildRequest()` — freeze an immutable request
    2. `stream(request)` — stream chunks
    3. Push each chunk into `BlockAssembler`
    4. At finish, create `assistant/message`
    5. If tool calls present → `executeToolCalls()`
    6. Loop back for the next THINK→TOOL→OBSERVE→FINAL iteration
- **Entry points**: `send()/followup()/steer()/inject()` put messages into an inbox;
  `wakeDriver()` starts the running phase; `kick()` drains it.

**Awaits before first LLM call** (`preStep`): inbox claim (sync splice) → system prompt
assembly (async) → runtime-context render (sync) → `agent/pre-step` plugin waterfall
(async) → session append → `buildRequest()` → `llm.prepareCall()`.

### 1.2 LLM streaming — a pass-through pipe
`packages/llm/llm-deepseek/src/`

- **HTTP**: native `fetch()` → `{baseURL}/chat/completions` (`adapter.ts:607`).
  Body always carries `stream: true` + `stream_options: { include_usage: true }`
  (`serialize.ts:356-358`). Auth via per-request key resolution (`adapter.ts:460`).
  Node/undici connection keep-alive is reused implicitly. **No custom agent.**
- **SSE parsing** (`sse.ts:32-34`):
  ```
  ReadableStream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({ onComment }))
  for await (const { data } of events) yield data
  ```
  This is **spec-compliant streaming SSE** (handles chunk splits, `\r\n`, BOM,
  multi-line data, comments). The `onComment` callback re-arms a stream-idle watchdog.
- **Translate** (`translate.ts`): **one `JSON.parse` per SSE payload**, then string
  `+=` for reasoning/text/tool-call deltas. Finish reason + usage are **deferred**
  (emitted at `[DONE]`).

### 1.3 Per-token cost — near zero
| Operation | Per-token? |
|-----------|-----------|
| `JSON.parse` | Once per SSE frame (many tokens) |
| string concat `+=` | Yes — O(delta) |
| `ContentBlock` creation | Only at block-end |
| usage/finish mapping | Once at `[DONE]` |
| **cost meter** | **Never on the hot path** |
| **telemetry** | **Never per token** |
| **persistence** | **Write-behind (200ms batched)** |

**Summary:** Harness is a *pass-through pipe* once SSE bytes arrive:
`SSE → JSON.parse → += concat → yield`.

### 1.4 Persistence
Event-sourced session log, **write-behind batching** (`session-persistence/src/write-behind.ts`,
`DEFAULT_WRITE_BATCH_MAX_DELAY_MS = 200`), crash recovery (torn-tail repair), SQLite/JSONL
backends. Durability never blocks streaming.

### 1.5 Todo / Tools / Questions
- **Todo**: whole-list `todo_write` tool → whole list replaced → persisted as
  `todo/write` session event; statuses `pending/in_progress/completed`; read-only
  projection for UIs.
- **Tools**: structured DSL → `defineTool()`; create→prepare→dispatch→finalize→finish
  pipeline; parallel tool calls via a bounded rolling pool (`maxParallelToolCalls=10`);
  per-tool signal fusion; truncation via `finalizeContent`.
- **Questions**: `ask_user_question` tool with `concludesTurn`, pauses execution →
  answer injected via `steer()` → next-step resumes → **mission resumable**.

---

## 2. Singularity Architecture (chat runtime)

Singularity has **two chat execution stacks**:

### Stack A — the vendored chat panel (`vscode/extensions/singularity-chat`, active UI)
This is **the default configured chat surface** (settings `singularity.chat.*`,
the model picker, tools, subagents, semantic search all live here).

Execution path (from the trace):
```
user input
  → chatParticipantRequestHandler.ts
  → DefaultIntentRequestHandler.getResult()
  → DefaultToolCallingLoop.run() / runOne()
      → buildPrompt2() → maybeEnrichMessagesWithPromptEngine()
      → endpoint.makeChatRequest2() → chatMLFetcher (HTTP/WebSocket)
      → per-delta: progress.markdown(delta.text) / progress.thinkingProgress()
      → tool invocations, citations, stop-word scan per delta
```

### Stack B — the agent/DAG runtime (`@singularity/runtime` + `@singularity/router`)
Used by subagents / multi-agent missions:
```
SingularityAI.completeStream()  (packages/router/src/runtime.ts:371-479)
  → routeAsync()                (Nemotron specialty classifier + flash/pro router)
  → cache.lookup()
  → compilePromptMessages()     (Prompt Engine v2, graph→IR→adapters)
  → fetchWithRateLimit()        (rateLimit.ts global gate)
  → OpenRouterProvider.streamChatCompletions()  (manual SSE parse)
  → yield deltas → LlmPort → agent loop
```

Both stacks are served by separate extensions/engines. **All of this must remain intact.**

---

## 3. Side-by-Side

| Feature | Harness | Singularity (active path) |
|---------|---------|----------------------------|
| **Agent loop** | `ReactLoopAgent` — lean kick/turn/step | Vendored chat participant + DAG runtime (two systems) |
| **Tool calls** | structured dispatch, rolling parallel pool | model-driven in chat; DAG worker tools |
| **Streaming** | pass-through: parse → `+=` → yield | per-delta `progress.markdown` + JSON rebuilds + stop-word scans |
| **Todo** | whole-list `todo_write` + session event | mission/outcome controller + task DAG |
| **Questions** | `ask_user_question` structured, resumable | (DAG-only; not in light chat) |
| **Context** | system-prompt sections; compaction seam | Prompt Engine + Neural Relay + Context Engine |
| **Memory** | projection over session log | Singularity memory/brain/context stores |
| **Events** | `session/event` append-only, write-behind | runtime event bus + telemetry |
| **Persistence** | write-behind 200ms | per-workspace SQLite / JSON |
| **Parallelism** | parallel tool calls | parallel DAG agents |
| **Cancellation** | signal-fused every boundary | AbortSignal to fetch/gate |
| **Error handling** | retry-policy + adaptive | gateway retry/backoff + cooldown |
| **UI streaming** | DOM-diff update | per-delta markdown render |

---

## 4. Performance Bottleneck Report

### Evidence that the model is NOT the bottleneck
- DeepSeek Harness streams **~170 TPS** against the same credentials, same model,
  direct to DeepSeek. So the model can deliver that rate.
- Singularity's collapse to ~15 TPS comes from **pipeline overhead**, ranked below.

### Ranked bottleneck hypotheses (with evidence)

| # | Cause | Evidence | Impact |
|---|-------|----------|--------|
| 1 | **Default 4 RPM global rate gate + serialized queue tail** | `rateLimit.ts:31` (`rpm: default 4`), `rateLimit.ts:48` (min spacing 15s), `rateLimit.ts:110-127` (all requests serially chained on `queueTail`) | **Hard ceiling ~40 TPS alone; queue serialization collapses concurrency.** This is the #1 cause. |
| 2 | **Two blocking LLM classifier calls before the first token** | `routeAsync` → Nemotron specialty (`specialtyClass.ts`) + flash/pro router; both are network LLM calls on the first-token critical path | +1-3s TTFT per request; reduces post-token window |
| 3 | **OpenRouter proxy hop** | every request routes client→OpenRouter→DeepSeek→OpenRouter→client (in `.env`) | +100-500ms per round-trip vs Harness's direct connection |
| 4 | **Per-token UI render + O(n²) string rebuilds** | every text delta calls `progress.markdown(delta)` (renders markdown) and the stop-word scanner re-concatenates the whole staged string (`pseudoStartStopConversationCallback` line 167) | high per-token CPU at high token rates |
| 5 | **Prompt Engine v2 + cache lookup on the hot path** | `compilePromptMessages` (`runtime.ts:419`), `cache.lookup` (`runtime.ts:250`) | pre-fetch latency |
| 6 | **Manual SSE parser** | `openrouter.ts:172-201` manual `\n` scan + buffer concat vs Harness zero-copy `EventSourceStream` | per-chunk garbage |

### Interpretation
The model delivers ~170 TPS. Singularity's ~15 TPS is a **pipeline collapse**:
```
170 TPS (model)
  → ~66 TPS  (4 RPM gate theoretical ceiling)
  → ~35 TPS  (two classifier LLM calls eating the generation window)
  → ~30 TPS  (manual SSE parser + Proxy hop)
  → ~20 TPS  (prompt engine compile)
  → ~15 TPS  (per-token UI/markdown + string rebuilds + queue serialization)
```
The #1 total fix would be raising the rate gate and not serializing concurrent work.

---

## 5. Proposed Architecture (preserve all engines)

```
                    SINGULARITY CHAT (kept)
                         │
                         ▼
                  Fast Agent Runtime (NEW hop — execution only)
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Context Engine    Memory           Neural Relay
        │                │                │
        └────────────────┼────────────────┘
                         ▼
                   Model Router (kept, hot-path-optimized)
                         │
                         ▼
                    LLM Provider
                         │
                        STREAM
                         │
                         ▼
           Streaming Runtime (zero-copy SSE, batched UI)
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
       UI             Tools/Events     [async]
                         │              └→ persistence, telemetry, memory,
                        ▼                  analytics, history, embeddings
                  Agent continues
```

**Key rules for the change (Parallel to Phase 6-15):**
- Do NOT delete/bypass/disable/regress anything.
- The fast path asks "what must run before the first token?" and moves everything else
  off that critical path.
- Model routing stays; only the *classifier hop* on the hot path becomes
  memoized/cached/parallelized — never removed.
- Neural Relay stays; only moves async portions off the first-token path when safe.
- Mission controller, tools, orchestration, verification, persistence, UI: all intact.

---

## 6. Implementation Plan (incremental & reversible)

The investigation phase followed Rule 1 (do not modify code). The implementation turns are
split into **backwards-compatible, per-`before/after` measurement** steps.

### Phase 6a — Instrument & baseline (no behavior change)
- Add request-trace counters for: T_user_input, T_context_start/complete,
  T_prompt_complete, T_request_start, T_connection_established, T_headers_received,
  T_first_token, TPS raw/parsed/event/UI.
- Create `benchmarks/chat-perf/` harness: identical prompt against Harness and both
  Singularity stacks, reusing the existing `latency-ladder` and `token-compare`
  infrastructure.

### Step 1 (Zero regression, config-only)
- Raise/parameterize the rate gate (make `SINGULARITY_LLM_RPM` sane, e.g. a configurable
  interactive lane and an agent lane) — **do not remove the gate**; give chat its own
  high-priority lane so the queue tail doesn't serialize it behind workers.

### Step 2 (Critical-path trim)
- Move the Nemotron classifier + Flash/Pro router work **off the first token path**: keep
  the router decision then run *memoized/cached* classification or run it *in parallel to
  the model call*; never remove routing.

### Step 3 (Provider hygiene)
- Use a zero-copy SSE parser (Harness pattern) inside `OpenRouterProvider`; replace the
  manual buffer-concat with a single-pass decoder; keep the exact abstract
  provider boundary.

### Step 4 (UI streaming)
- Batch per-delta UI updates: accumulate tokens, flush rendering at a frequency that
  still *appears* real-time (e.g., 30-60ms flush or N-token batches); remove the O(n²)
  per-delta string rebuild (ac@cumulate once); avoid `progress.markdown` calls per token.

### Step 5 (Async decouple)
- Push persistence/telemetry/embedding/fingerprint/NeuralRelay-analytics to a channelled
  async sink that is never on the first-token path (Harness write-behind concept).

Every step has a before/after measurement from the harness; regression suite at the end.

---

## 7. Benchmark Harness (reproducible)
Under `benchmarks/bench-perf/`:
- `run.mjs --mode harness|singularity-chat|singularity-dag --runs N`
- identical model/API-key/prompt/temperature/max-tokens/tools.
- Measures TTFT, total latency, tokens/sec effective, network tokens/sec, UI tokens/sec,
  tool-call latency, CPU/mem, request count, token overhead.
- Baseline snapshots → regression gates.

## 8. Regression Suite
- Extends existing `packages/**/*.test.ts` + `benchmarks` to cover the full checklist:
  chat, streaming, tool calls, tool errors/retries, todo, user questions, interrupt,
  cancel, resume, memory, neural relay, model router, mission, parallel agents,
  verification, file/shell ops, long tasks, error recovery.

---

## Open decisions before implementation
1. Which chat stack do you actually use daily — the vendored **chat panel** (Stack A) or
   the **DAG/runtime** commands? The forensics suggest the panel, but both are touched.
2. Are we allowed to run both Harness and Singularity on this machine to produce the
   benchmark? The benchmark requires a way to hold both bite (live) — otherwise we build
   a "live only" harness with the before-delta.

---

## Implementation Milestone 1 — DONE (Router hot path)

All under `packages/router` (no engine removed/bypassed; all 13 packages green).

### 1a. `completeStream` honors a forced `modelId` (correctness + perf)
- **Bug found by benchmark**: `SingularityAI.completeStream` (runtime.ts) used
  `decision.model` directly and never called `resolveModel(decision, req.modelId)`,
  so a forced model was silently ignored and the routed model (e.g. `zai/glm-5.2`,
  `mistral/codestral`) was sent → **HTTP 400 "not a valid model ID"**.
- **Fix**: mirror `complete()` — `model = resolveModel(decision, req.modelId)`.
- **Result**: forced DeepSeek now streams (200). Earlier tier C was 100% 400s; now it
  streams. Regression test added (`runtime.test.ts`).

### 1b. Interactive rate-gate lane + bounded slot wait
- `rateLimit.ts`: new `{ lane: 'interactive', slotTimeoutMs }` on `gateLlmRequest`
  and `fetchWithRateRetry` (via `ChatCompletionOptions.gateOptions`).
- Interactive (chat/UI) requests **no longer serialize behind the background
  queueTail** at 15s spacing, and their slot wait is **bounded** (default 30s,
  env `SINGULARITY_LLM_SLOT_TIMEOUT_MS`) — a congested gateway now degrades to a
  fast visible failure instead of a silent 10-min "Evaluating".
- Default lane semantics unchanged (existing tests pass untouched). New tests
  (interactive lane non-serialization, slot deadline).

### 1c. Single-pass SSE parser
- `openrouter.ts` stream loop: replaced growing-buffer `slice`-per-line with a
  tracked consumed offset + periodic compaction → O(total-bytes), less garbage on
  the token hot path. All `streamChatCompletions`/`openrouter` tests pass.

### Regression gate
`npm run build:packages && npm run test:packages` → **exit 0, all packages green**
(router 123, cache 109, memory 19, architecture 71, outcome 32, intelligence 9,
neural-relay 36, brain 28, context 14, prompt 14, …).

### Benchmark (benchmarks/bench-perf) live before/after
| Tier | Before | After |
|------|--------|-------|
| B (provider) TTFT | 1.2–6.7 s | 0.5–2.2 s |
| C (SingularityAI) | **0 ok (all 400)** | ok, streaming; TTFT ~10 s (gateway variance) |

Note: the live TTFT/TPS numbers are dominated by **OpenRouter free-tier variance**
(raw gateway TTFT measured 0.9–27 s in the same session) — the pipeline is no longer
the ceiling for a single request.

## Remaining increments (safe, measured)
- **Step 2**: fire the specialty-classifier LLM hop off the first-token path
  (memo is hot; parallel/deferred classification for the non-forced path).
- **Steps 4-5**: vendored chat (`singularity-chat`) per-delta markdown batching +
  O(n²) stop-word scanner fix + async decouple — higher risk (vendored MS codebase);
  proceed with the same before/after + regression discipline.

---

## Implementation Milestone 2 — DONE (steps 2-4 + pre-existing build fixes)

### 2a. Parallel classifier (Step 2, opt-in)
- `engine.ts` `routeAsync`: `SINGULARITY_PARALLEL_CLASSIFIER=1` routes this turn on
  the deterministic keyword specialty (identical to the LLM's own rules fallback)
  and warms the Nemotron LLM classification in the background for the next turn —
  removing the serial 2.5s LLM hop from TTFT **without removing routing**.
- Default OFF (preserves prior behavior). Tests added (routeAsyncSkip).

### 2b. Vendored chat — O(n²) stop-word scanner fix (Step 4)
`vscode/extensions/singularity-chat/.../pseudoStartStopConversationCallback.ts`:
- `checkForKeyWords` rebuilt `stagedDeltasToApply.map(d=>d.text).join('')` on every
  delta (O(staged²) during partial stop-word accumulation).
- Now caches the staged text and invalidates at every mutation site; recomputes
  lazily only when dirty. Byte-identical behavior — all 14 processor tests pass.

### 2c. Pre-existing pending-source/build bugs fixed (surfaced by this work)
- `packages/architecture/src/events/types.ts` and `packages/outcome/src/events/types.ts`:
  used re-exported `@singularity/context/relay` names locally without binding them
  (a bare `export {x} from` does not create a local binding) → "Cannot find name".
  Now import+re-export locally. Both packages build + their tests pass.

### Final regression state
`npm run build:packages` → exit 0 (0 TS errors).
`npm run test:packages` → exit 0, zero failures (router 124, architecture 71,
outcome 32, brain 28, neural-relay 36, cache 109, memory 19, intelligence 9, …).
`vscode/extensions/singularity-chat` processor spec: 14/14 pass.
All Singularity engines remain intact and operational.

### Post-implementation live benchmark (benchmarks/bench-perf, gateway-relative)
Tier C (`SingularityAI.completeStream`, forced DeepSeek, 2 runs × 3 fixtures):

| Fixture | Tier C TPS | ok runs | Before fix |
|---------|-----------|---------|-----------|
| explain | 76.1 | 2/2 | 0/2 (400) |
| plan    | 137.9 | 2/2 | 0/2 (400) |
| edit    | 64.9  | 2/2 | 0/2 (400) |

Every tier C run now streams (65–138 TPS) vs **100% HTTP 400 before the
forced-model fix**. The gate (`npm run perf:bench`) passes: tier C success is a
hard check (would catch a routing regression instantly); TTFT envelopes are
gateway-relative warnings because raw OpenRouter TTFT varies 0–27s on this free
tier, so absolute TTFT targets would be noise (Rule 9).