# Model Routing + Surfacing (Extension Bridges) Cluster — Architecture Inventory

Generated from reading the real source tree. Packages examined:

- `packages/router` (`@singularity/router`) — cost-aware model routing
- `vscode/extensions/singularity-ai/src` — the VS Code "surface layer" bridges
- `services/{langextract-sidecar, agent-framework-sidecar, project-intelligence, qwen-router-sidecar}` — sidecars

---

## TASK A — packages/router (@singularity/router)

### A1. NAME / DIR / PURPOSE

| Field | Value |
|---|---|
| **Name** | `@singularity/router` |
| **Dir** | `/Users/ashutosh/Singularity/packages/router/` (src tree under `packages/router/src/`) |
| **Purpose** | Cost-aware model routing engine for the Singularity AI IDE. Routes each request to the cheapest model that can still complete the task, via feature extraction → intent classification → capability filter → weighted scoring → tier escalation → provider dispatch. |

Package `package.json`: version 0.1.0, type module, main `./dist/index.js`. Build/test: `tsc -p tsconfig.json`, `vitest run`, bench script `test/localRoutingBenchmark.ts` (`bench:qwen-router`). Runtime: Node >=18.

---

### A2. PUBLIC API (index.ts exports)

`packages/router/src/index.ts` re-exports the following (grouped by the task's requested symbols):

- **Types & constants**: `Tier`, `Intent`, `InteractionMode`, `ProviderKind`, `ToolPermissions`, `FallbackReason`, `RouteContext`, `RouteFeatures`, `ModelSpec`, `IntentClassification`, `ScoredCandidate`, `RouteDecision`, `RouteDecisionCache`, `RoutingEngineConfig`, `TelemetryEvent`, `SpeedClass`/`CostClass`/`ContextWindowClass`/`ModelVendor`/`ModelCapabilities`/`SubTier`, linked helpers `TIERS`, `tierIndex`, `nextTier`, `subTierIndex`, `contextClassToTokens`.
- **Tiers** (`./tiers.ts`): `TIER_PURPOSE`, `INTENT_DEFAULT_TIER`, `INTENT_TEMPERATURE`, `INTENT_MAX_TOKENS`, `INTENT_SYSTEM_HINT`, `resolveToolPermissions`.
- **Engine** (`./engine.ts`): `createRoutingEngine`, `RoutingEngine`.
- **Runtime** (`./runtime.ts`): `createSingularityAI`, `SingularityAI`, config/request/result types.
- **Providers** (`./providers/*`): `OpenRouterProvider`, `LocalProvider`, `DirectProvider`, `ModelAdapter` (+ `IModelProvider`, `Chat*`, `ProviderError`, `ResponseFormat`).
- **Tiers / models**: `models/catalog.ts` → `DEFAULT_MODEL_CATALOG` (via engine), `findModel`, `isModelEligibleForTier`, `TIER_RECOMMENDED_MODELS`.
- **Specialty** (`specialty.ts` / `specialtyClassifier.ts` / `specialtyMemo.ts`): `detectSpecialty`, `specialtyFromContext`, `isFrontendSpecialty`, `FRONTEND_OWNER_MODEL_ID`, `FRONTEND_SYSTEM_HINT`, `classifySpecialty`, `parseSpecialtyContent`, `decisionModelCoolingDown`, `resetDecisionModelHealth`, `specialtyMemoKey`/`get|set|clearSpecialtyMemo`.
- **Task classifier**: `taskClassifier.ts` → `classifyTask`, `taskClassToIntent`, `TaskClass`, `TaskClassification`.
- **Score**: `score.ts` → `scoreCandidates`, `SCORE_WEIGHTS`.
- **Model matcher**: `modelMatcher.ts` → `callWhenScore`, `capabilityFitScore`, `tagMatches`, `pickBestSubTier`.
- **Filter**: `filter.ts` → `CapabilityFilter`, `buildRequirements`, `resolveMinTier`, `CapabilityRequirements`.
- **Cache**: `cache.ts` → `InMemoryRouteCache`, `buildCacheKey`, `shouldCacheRoute` (router-local route-decision cache; the durable KV cache lives in `@singularity/cache`).
- **LLM decision**: `llmDecision.ts` → `LlmDecisionEngine`, `createLlmDecisionEngine`, `DEFAULT_DECISION_MODEL`, `LlmRouteRequest`/`LlmRouteDecision`.
- **Local routing classifier**: `localRoutingClassifier/index.ts` → `classifyAndRoute`, `routeWithSignals`, `applyRoutingPolicy`, `detectSafetyOverrides`, `parseRoutingSignals`, `warmupQwenClassifier`/`isQwenClassifierReady`/`disposeQwenClassifier`, plus `FLASH_MODEL_ID`, `PRO_MODEL_ID`, `LOCAL_CLASSIFIER_ID`, `EMPTY_ROUTING_SIGNALS`, `QWEN_CLASSIFIER_SYSTEM_PROMPT`.
- **Nemotron flash/pro**: `nemotronFlashPro/index.ts` → `decideFlashOrPro`, `coerceFlashOrPro`, `isNemotronRouterEnabled`, `NEMOTRON_ROUTER_MODEL`, `NEMOTRON_ROUTER_SYSTEM` (the decision is currently **disabled — always returns `choice: flash`, `source: 'disabled'`** because DeepSeek V4 Pro is disabled in the build).
- **Conversation switch**: `conversationSwitch.ts` → `providerOf`, `parseTier`, `escalateCandidateIfNeeded`, `decideConversationSwitch`, `applySwitchToState`, `MIN_ACCEPT_CONFIDENCE`.
- **Fallback**: `fallback.ts` → `buildFallbackChain`, `escalateDecision`, `canEscalateToTier`.
- **Rate limit**: `rateLimit.ts` → global single LLM rate gate: `gateLlmRequest`, `fetchWithRateRetry`, `noteRateLimited`, `computeBackoffMs`, `parseRetryAfterMs`/`parseRetryAfterValue`, `setRateGateConfig`/`getRateGateConfig`/`resetRateGate`, `getRateGateStats`/`resetRateGateStats`, `sleepAbortable`, `rateLimitedUntilTs`.
- **Context / contextSegments**: `context.ts` + `contextSegments.ts` → Level-3 context segmentation mirror (dirty-tracked segment hashes), `createSegmentedContext`, `updateContextSegments`, `hashContent`, `estimateTokens`, `ContextSegment*`.
- **Telemetry**: `telemetry.ts` (`emitTelemetry`) + `telemetry/requestTrace.ts` (`requestTracer` singleton, `startTrace`, `hashPromptForTrace`, `computeMetrics`, `TRACE_PHASES`) — append-only JSONL under `.singularity/traces/`.
- **Features**: `features.ts` → `extractFeatures`, `estimateOutputTokens`.
- **Env/auth**: `bundledEnv.ts` (`applySingularityBundledEnv`, `getGatewayApiKey`, `getTokenRouter*`, `getOpenRouter*`, `isOpenRouterApiKey`), `betaAuth.ts` (`read|write|clearBetaAuth`, `ensureDeviceId`, `refreshBetaSessionIfNeeded`, `getBetaProxyAuthHeaders`, `fetchBetaQuota`).
- **Re-export from `@singularity/prompt`**: `createPromptPipeline`, `runPromptPipeline`, `createPromptEngine`, `compilePrompt`, `normalizePromptIntent`, `segmentsForIntent` + prompt IR types — the router surface also exposes the Prompt Engine v2 API.

Note: `subTierIndex`, `contextClassToTokens` are exported via a second `export { ... } from './types.js'`.

---

### A3. How model selection / routing works (intent → tier → model)

Two entry points; both end in `RoutingEngine`:

1. **`RoutingEngine.route(ctx)`** — synchronous deterministic fast path (used in tests and as a fallback). Extracts features → keyword specialty (`detectSpecialty`), keyword intent classifier (`RuleIntentClassifier`).
2. **`RoutingEngine.routeAsync(ctx)`** — production path. Calls `classifySpecialty()` (Nemotron LLM - network hop, memoized 60 s in `specialtyMemo`) to understand *intent beyond keywords*; falls back to the sync keyword path on timeout/error/cooldown. Skipped entirely (zero network) when the caller forces `modelId`/`preferredTier`. Then overlays a Flash/Pro decision via `decideFlashOrPro` (currently disabled → no-op).

Both funnel into `routeWithSpecialty`:

- **Feature extraction** (`extractFeatures`): token/char counts, code detection, mode, images, tools, keywords.
- **Intent classification** (`RuleIntentClassifier.classify` → `applyIntentRules`): mode overrides first (`autocomplete`→`AUTOCOMPLETE`, `agent`→`AGENT`, `inline`→`INLINE_EDIT`, `terminal`→`TERMINAL`), then keyword heuristics (security/review, architecture, refactor, debug, test, document, explain, search, docker/k8s, multi-file).
- **Requirements & tier floor** (`buildRequirements` / `resolveMinTier`): floors from `INTENT_DEFAULT_TIER`, then raises for long context (>64k→T2, >128k→T4), docker/k8s→T5, performance/security→T5, images→T4, agent/tools→T1.
- **Capability filter** (`CapabilityFilter`): drops models not eligible for the tier, or lacking maxContext / tools / vision / JSON / streaming.
- **Scoring** (`scoreCandidates`): weights `quality 0.30 + cost 0.15 + latency 0.15 + reliability 0.10 + preference 0.05 + callWhen 0.25`. Quality blends `qualityByIntent` + capability-fit. Preference blends user-pref models + tier recommendation rank; low-confidence (intent < 0.4) forces the T6 frontier slot.
- **Fallback chain**: `buildFallbackChain` ⇒ ordered remaining same-tier candidates then next-tier escalation; `escalate` / `escalateDecision` pops the next model.
- **Return** `RouteDecision` { model, tier, subTier, intent, intentConfidence, temperature, maxTokens, systemPromptHint, toolPermissions, score, candidates, fallbackChain, specialty }.

`SingularityAI.complete` (**runtime.ts**) is the top-level orchestration: classifyTask (task classifier) → `engine.routeAsync` → optional task-intent nudge → cache lookup (`@singularity/cache` CacheManager L3/L4) → prompt pipeline (Prompt Engine v2) → `ModelAdapter.complete` (provider dispatch) → cache write-through → economy/trace. There is also a streaming variant `completeStream`.

---

### A4. STATE OWNED

- **Model catalog** (`DEFAULT_MODEL_CATALOG` in `models/catalog.ts`) — static T0–T6 capability/cost matrix (DeepSeek V4 Flash-0731 owns T0; DeepSeek V4 Pro-0813 owns T2–T6 primary; Gemini 2.5 Flash is the vision slot; Kimi/Laguna/Codestral etc. fill sub-slots). Owned **in-process**; the extension also seeds **live TokenRouter prices** into `tokenPricing` in the extension layer.
- **Specialty memo** (`specialtyMemo.ts`) — session-scoped 64-entry / 60 s Map keyed by sha256 of the normalized prompt; only LLM-sourced classifications are stored.
- **Telemetry** (`requestTrace.ts`) — process-wide trace registry + JSONL sink (`SINGULARITY_TRACE_DIR` or default `.singularity/traces/`). `telemetry.ts` is a pure event-emitter callback wrapper (no storage).
- **Rate gate** (`rateLimit.ts`) — module-level mutable config + last-start timestamp + cooldown-until + queue-tail promise + stats. Global within the process.
- **Route decision cache** — backed either in-Router (`InMemoryRouteCache`) or bridged to the `@singularity/cache` RoutingCache adapter (`createRouteDecisionCacheBridge`).
- Nothing persistent (no DB / no durable store) lives in the router package itself.

---

### A5. MODEL CALLS MADE BY ROUTER vs pure routing

The package is **both** a router and a thin model-invoker:

- **Pure routing** (no network): `features / intent/rules / tiers / filter / score / modelMatcher / fallback / conversationSwitch / cache`, plus `models/catalog`.
- **Makes outbound LLM calls** (it does invoke providers itself for its *own* decision and for *execution*):
  - `providers/openrouter.ts` — full OpenAI-compatible client (`chatCompletions`, `streamChatCompletions`, SSE parsing, `fetchWithRateRetry`, beta-proxy headers). Used to complete the chosen model when called via `ModelAdapter`.
  - `providers/adapter.ts` — dispatches to openrouter/local/direct providers per `ModelSpec.provider`.
  - `providers/direct.ts`/`local.ts` — stubs (Direct always throws "not implemented"; local echoes when `localEcho`).
  - `specialtyClassifier.ts` — calls **Nemotron** (`/chat/completions`) to classify the specialty lane (network hop gated by the shared rate gate; falls back to keyword rules).
  - `llmDecision.ts` — `LlmDecisionEngine` calls a high-TPS OpenRouter free model to pick tier/model (races a timeout; `readyInstant` fast path).
  - `nemotronFlashPro/index.ts` — currently **disabled** (always returns flash), but is structurally a router sidecar call.
  - `localRoutingClassifier/sidecarClient.ts` — spawns **Qwen3-1.7B MLX** Python sidecar over stdio to classify routing signals (gated by `SINGULARITY_QWEN_ROUTER=1`; referenced only in tests today).

So: the router package **owns both** route decision and the concrete provider/client that executes the request. In the IDE deployment, the extension calls `createSingularityAI()` and uses its `engine` + `adapter`; the runtime package then decouples these behind `LlmPort` (see Dependencies).

---

### A6. DEPENDENCIES on other `@singularity/*`

From `packages/router/package.json` dependencies:
- **`@singularity/cache`** (`file:../cache`) — `runtime.ts` uses `CacheManager`, `createCacheManager`, `FingerprintHistoryStore`, `ContextFingerprintInput`, `PrefixHints`, plus the routing-cache adapter.
- **`@singularity/prompt`** (`file:../prompt`) — `runtime.ts` uses Prompt Engine v2 (`createPromptEngine`, IR compilation, `buildEconomyReport`, `normalizePromptIntent`, etc.); `contextSegments.ts` uses `hashContent`/`estimateTokens`; `index.ts` re-exports prompt architecture surface.

The router package otherwise has no dependency on `@singularity/runtime`, `@singularity/brain`, or the surface layer. **Dependency direction: the router is a standalone barrel that `runtime` depends on, not vice-versa.**

---

## A7. CALLERS — who calls @singularity/router

Grep for `@singularity/router` (source trees only, excluding `dist/` and the bundled app snapshot):

**`packages/runtime`** — largest consumer:
- `runtime/llm.ts` — `createLlmPortFromSingularityAI({ ai?, config?, sessionId? })` wraps `SingularityAI` behind the `LlmPort` interface; calls `ai.engine.route`, `forceModel` (rewrites decision to a pinned model), `ai.complete`/`completeStream`, `ai.engine.escalate`, `classifyTask`. Maintains its **own** `TOKENROUTER_TIER_MODELS` allowlist (DeepSeek Flash only, Pro disabled) and MIT md5.
- `runtime/runtime.ts` — `createRuntimeEngineFromAI({ ai, ... })` wires `createLlmPortFromSingularityAI` as the engine's `llm`; re-exports it.
- `runtime/scheduler/scheduler.ts` — imports `computeBackoffMs`, `extractRetryAfterFromText`, `sleepAbortable` from router, and `FRONTEND_OWNER_MODEL_ID`/`modelIdForSpecialty` from `@singularity/design`.
- `runtime/fastpath/classifier.ts` — `classifyTask` from router (regex-only fast-path classification).
- `runtime/subagent/{roleCatalog,modelPolicy,types}.ts`, `runtime/{ports,types}.ts`, `runtime/planner/planner.ts` — only `type Tier` and the routing surface.

**`vscode/extensions/singularity-ai`** — surface layer:
- `extension.ts` — lazy `await import('@singularity/router')`; calls `createSingularityAI`, `applySingularityBundledEnv`, `getTokenRouterApiKey`, `getTokenRouterBaseUrl`, `getTokenRouterRequestHeaders`, `fetchBetaQuota`, `formatEconomyMarkdown`, `requestTracer`. Owns the single `SingularityAI` instance (`ai`).
- `brainBridge.ts`, `contextEngineBridge.ts`, `runtimeBridge.ts`, `runtimeChatParticipant.ts` — `import type SingularityAI` (pass the instance into their wrapped subsystems).
- `langExtractBackgroundAgent.ts`, `promptDebugPanel.ts` — `SingularityAI` type usage.

**`packages/brain`** — does **NOT** use `@singularity/router`; it has its **own** independent `OpenAiCompatibleBrainClient` (`brain/modelClient.ts`).

`packages/prompt` — does **NOT** import router; its `routing/routerIntegration.ts` + `routing/packs.ts` are **metadata-only** (no model invocation) and slice the prompt context by intent (consumed *by* the router).

---

## A8. SYNC / ASYNC & latency profile

- **Synchronous**: `engine.route`, keyword intent/specialty, filtering, scoring, cache hit — sub-millisecond; no network.
- **Async path (`routeAsync`)**: the specialty-classify network hop (tries Nemotron at `SINGULARITY_SPECIALTY_LLM`; 2.5 s default decision timeout, memoized 60 s). Skipped when caller forces a model/tier, so most hot-path requests bypass the hop.
- **Rate limiting** (`rateLimit.ts`): a **single process-wide gate** serializes every LLM request initiation (default `SINGULARITY_LLM_RPM=4`, min spacing 250 ms). Handles 429 → cooldown (`SINGULARITY_LLM_429_COOLDOWN_MS` 20 s), exponential backoff with jitter; abort-aware sleep. Not kept per-request; it is a shared throttle.
- **Streaming**: `SingularityAI.completeStream` and `OpenRouterProvider.streamChatCompletions` (SSE parser, reasoning deltas; falls back to buffered delta when the gateway drops the SSE content-type, and to a single non-streaming call when the provider has no streaming). Cancellation propagates via `AbortSignal` to the fetch layer.
- **Conversation-time**: mid-conversation model switching is decided in `conversationSwitch.ts` (affinity/`escalate-before-stream`) but **no live switch decision is currently called on the hot path** — it exposes pure deciders.

---

## A9. TESTS

`packages/router/test/` (vitest):

| File | Covers |
|---|---|
| `catalog.test.ts` | catalog covers recommended models |
| `contextEconomy.test.ts` | context-segment / economy integration |
| `conversationSwitch.test.ts` | switch/affinity/escalate |
| `engine.test.ts` | sync + async routing |
| `filter.test.ts` | capability filter |
| `intent.test.ts` | intent rules |
| `llmDecision.test.ts` | LLM decision + rule fallback |
| `localRoutingClassifier.test.ts` | Qwen sidecar signals/policy/safety |
| `nemotronFlashPro.test.ts` | coerce/flash-pro decider |
| `openrouter.test.ts` | OpenRouter provider |
| `promptPipeline.test.ts` | prompt-engine pipeline |
| `rateLimit.test.ts` | rate gate / retry |
| `requestTrace.test.ts` | trace metrics |
| `routeASyncSkip.test.ts` | async skip when model forced |
| `runtime.test.ts` | SingularityAI + adapter |
| `score.test.ts` | scoring weights |
| `specialty.test.ts` | specialty lanes |
| `specialtyClassifier.test.ts` | Nemotron classifier fallback |
| `specialtyMemo.test.ts` | memo/kv |
| `streamChatCompletions.test.ts` | SSE parse/stream |
| `helpers/providerBody.ts` | body helpers |

**Known failing test (left edge OpenRouter)**: I ran the suite — **`test/openrouter.test.ts` → "posts to /chat/completions with auth headers" FAILS**. The mock expects `https://ai-gateway.vercel.sh/v1/chat/completions` but the provider now defaults to `https://openrouter.ai/api/v1/chat/completions` (OPENROUTER_DEFAULT_BASE_URL). 119/120 pass; the assert is stale relative to the current provider default base URL. This is a left-edge test that needs updating (either inject baseUrl in the test or update the expected URL).

---

## A10. Duplicates / overlap — disconnected duplicate model clients

There are **multiple independent model-invocation paths** across the repo that do NOT share `ModelAdapter`/provider code:

1. **`packages/router/src/providers/*`** — the canonical client (`OpenRouterProvider`/`ModelAdapter`) + the classification hops.
2. **`packages/brain/src/modelClient.ts`** — its **own** OpenAI-compatible HTTP client (`OpenAiCompatibleBrainClient`), independent of router. Branch-dedicated; used by `BrainEngine`.
3. **`packages/neural-relay/src/intelligence/OpenRouterNemotronProvider.ts`** — own `/chat/completions` client for the Nemotron context-intelligence model. Note `openrouterEnv.ts` says it deliberately does **not** import `@singularity/router` (to avoid loading the heavy catalog barrel) — a deliberate but real client duplication.
4. **`packages/design/src/agencyAgentClassifier.ts`** — its **own** `callAgencyAgentLlm` `/chat/completions` post for the design-failure agency/agent classifier.
5. **`vscode/extensions/singularity-ai/src/cobuild/cobuildService.ts`** — direct HTTP `fetch(.../chat/completions)` to the Cobuild pod gateway (separate substrate).
6. **`vscode/extensions/singularity-chat/.../platform/endpoint/node/singularityRouterBridge.ts`** — a **complete re-implementation** of routing: `SingularityAutoRouter` with its own `SUB_TIER_MODELS` (DeepSeek Flash-0731 / Gemini vision @T0.4) and its own `inferIntent`/`resolveTargetTier`/`pickSubTier`/`endpointScore`/`inferTier`. This is a **disconnected duplicate of `@singularity/router`'s tiering logic** living in the chat extension, with a different tier table shape.

Also note: `packages/design/src/types.ts` re-defines `FRONTEND_OWNER_MODEL_ID = 'deepseek-v4-flash-0731'` (a duplicate constant copy of the same id, rather than importing from the router). And `packages/runtime/src/llm.ts` carries its own second `TOKENROUTER_TIER_MODELS` allowlist rather than reusing `models/catalog.ts`.

- `packages/prompt` `routing/*` (routerIntegration, packs, segmentsForIntent) is **not** a duplicate — it only metadata for context assembly, no model selection/invocation.

---

## TASK B — Surface layer bridges (vscode/extensions/singularity-ai/src)

Full per-bridge detail in `.arch-inventory/tmp-bridges.md` (captured by inventory subagent). Summary table:

| Bridge file | Wraps | Endpoints / commands | User-facing feature | Target system |
|---|---|---|---|---|
| `architectureBridge.ts` | `@singularity/architecture` (+`@singularity/intelligence`) | `getArchitectureSubsystem`, `start/disposeArchitectureDaemon`, `emitArchitectureEvent`, `lookupArchitectureContext`, `listArchitectureForUi`, `architectureNeighborsForUi` | Architecture Intelligence (ADRs, graph, drift/conflict/impact) | Intelligence plane; remote→worker `client.postCodingEvent` |
| `brainBridge.ts` | `@singularity/brain` | 14 `singularity.brain.*`/`singularity.ai.(intelligence|memory|architecture|tasks|brain).*` commands: open, syncEverything, ultrathink, status, relevant, global, observeChat, observeFile, insightFeedback… | persistent USER-level cognitive runtime; graph UI | in-process `BrainEngine` |
| `contextEngineBridge.ts` | `@singularity/context` × | `ensureContextEngine`, `ingestChatMessage`, `scheduleContextIngest`, `buildRuntimeContextPayload`, `prepareContextForChat`, `getActiveContextEngine` | workspace context engine (LangExtract background) | context engine + LangExtract sidecar |
| `designPreviewGate.ts` | `@singularity/design` + runtime gate port | `promptDesignPreviewGate` (**disabled→always 'skipped'**), `createVsCodeDesignPreviewGatePort`, `readGate` | Design Canvas HITL gate (off; coding unlocked) | design gate + runtime gate port |
| `memoryBridge.ts` | `@singularity/memory` | `getMemorySubsystem`, `start/disposeMemoryDaemon`, `emitMemoryEvent`, `lookupMemoryContext`, `list/search/removeMemoriesForUi` | Memory Engine decisions/preferences/lessons | memory subsystem shell route |
| `neuralRelayBridge.ts` | `@singularity/neural-relay` | `getNeuralRelayFlagsFromConfig`, `resolveNeuralRelay`, `expandNeuralRelay`, `neuralRelayStatus`, `latestNeuralRelayExperiment`, `registerNeuralRelayStatusBar`, `isRelayEnvEnabled` | compact context for DeepSeek (token reduction); feeds Runtime `onContextRequest` | neural-relay / Nemotron sidecar, cacheTelemetry |
| `outcomeBridge.ts` | `@singularity/outcome` | `createOutcomeSubsystem` etc., `emitOutcomeEvent` (READY_FOR_VERIFICATION, mission.execution.updated), `queueRemediationReplan` | Outcome Engine mission/intent + verification | outcome subsystem |
| `runtimeBridge.ts` | `@singularity/runtime` | `createVsCodeWorkspacePort`/`createVsCodeEditPort`, `runRuntimeInIde`, `getMultiAgentLimitsFromConfig` | Multi-agent DAG runtime, verification shell | runtime engine in VS Code host |
| `wikiBridge.ts` | `@singularity/wiki` | `ensureWikiEngine`, `initWiki`, `ingestIntoWiki`, `queryWiki`, `searchWiki`, `lintWiki`, `fileWikiAnswer`, `buildWikiPromptBlock` | LLM wiki KB, injected into chat | wiki engine + wikiPanel |
| `globalMemoryBridge.ts` | none (fs + brain) | `singularity.ai.globalMemory.block`, `.extractFromChat`, `shareUserIdentity` | durable USER identity/profile | globalStorage + brain |
| `intelligenceBridge.ts` | `@singularity/intelligence` | `start/disposeIntelligenceDaemon`, `requestIntelligenceIndex`, `intelligenceContext`, passive capture notify* | Project Intelligence passive capture + retrieval | out-of-process worker |
| `intelligenceRemoteEngine.ts` | `@singularity/intelligence` | `RemoteIntelligenceEngine` facade/proxies | read-path facade over remote worker | remote worker |
| `intelligenceShell/protocol.ts` | none | `ShellRoute` type, `Shell*Message`, payload unions | webview↔host contract | shell panel |
| `intelligenceShell/shellApp.ts` | none | webview UI for all routes | arbitrary shell UI | webview |
| `intelligenceShell/shellPanel.ts` | `@singularity/runtime` + local bridges | `IntelligenceShellPanel` — host, build route payloads, handleBrainMessage, ingestRuntimeEvent | unified Context/Brain/Memory/Arch/Tasks shell | webview, runtime |
| `intelligenceWorkerProcess.ts` | `@singularity/intelligence` | `ensureIntelligenceWorker` (spawns child), `getIntelligenceClient`, `getBaseUrl` | child process for project-intelligence | out-of-process worker |
| `cobuild/cobuildService.ts` (+Ui, hyperspaceCli, types) | none (vscode + local) | `CobuildService` — `createPod/joinPod/leave`, LM provider `singularity.ai.cobuild` (streams `/chat/completions`) | multi-user VRAM pod, shared local model | Hyperspace CLI/gateway |
| `langExtractBackgroundAgent.ts` | router + context | `scheduleLangExtractJob`, `waitFor`, `isLangExtractSkipPrompt` | background LangExtract extraction (never blocks chat) | context engine |
| `penpotManager.ts` | `@singularity/design` | `PenpotManager` ensureStarted/stop, `startPenpot`/`stopPenpot` | design server lifecycle | Penpot (Docker) |
| `engineCatalog.ts` | none | `ENGINE` record, `uniqueEngines` | plane display-name catalog | — |
| `tokenPricing.ts` | none | `ModelTokenPrice`, `estimateUsageCostUsd`, `getTokenPrice`, `ingestModelsPricingPayload` | per-model USD billing | — |
| `tokenUsage.ts` | local | `ProjectTokenUsageStore`, `formatUsageStatusText/Tooltip` | Spend & Tokens status bar | — |
| `runtimeChatParticipant.ts` (**this repo has NO `runtimeChatObserver.ts`**) | runtime + router | `registerRuntimeChatParticipant` — `singularity.dag` participant; **paused placeholder**; `formatRuntimeMarkdown` | DAG runtime execution in chat (paused) | runtime engine |
| `dotSingularityExplorer.ts` | none | `ensureDotSingularityVisibleInExplorer` | reveal `.singularity` folder | explorer |
| `cacheTelemetry.ts` | `@singularity/neural-relay` | `beginRequest`, `setRequestPhase`, `recordDeepSeekProviderUsage`, 3 status items + commands | DeepSeek-cache vs Neural-Relay telemetry | status bar |

Key wiring facts (from `extension.ts`):
- **Activated** at startup: `startBrainBridge`, `startIntelligenceDaemon`, `startGlobalMemoryBridge`, `CobuildService`, `registerNeuralStatusBar`/`registerCacheStatusBar`, `PenpotManager`, `prepareContextForChat`, `IntelligenceShellPanel.handleRuntimeEvent`.
- `startArchitectureDaemon`/`startMemoryDaemon`/`startOutcomeDaemon` in the VS Code bridge files are **NOT invoked by `extension.ts`** — the actual architecture/memory/outcome subsystems run inside the spawned worker `services/project-intelligence/src/main.ts`.
- **Deactivate** disposes brain / intelligence / context / wiki; cobuild + status bar.
- `runtimeChatObserver.ts` does **not exist** in this repo; its role is handled by `shellPanel.handleRuntimeEvent` + `runtimeChatParticipant.ts`.

---

## TASK C — services/ sidecars

Per-sidecar (from real README/main.py + consumers):

**1. `services/langextract-sidecar/`** — Python stdio JSON-lines wrapper around Google `langextract==1.6.0`. Converts text → structured `ExtractionDelta` (requirements, constraints, tech, architecture decisions, goals, entities). Ops: `ping`, `extract`. Consumed by **`packages/context`** (`sidecarClient.ts`→`LangExtractContextExtractor`→`engine.ts`, gate `flags.langextract_enabled` / `SINGULARITY_LANGEXTRACT_ENABLED`), and by the surface layer via **`contextEngineBridge` + `langExtractBackgroundAgent`**. Runs under its own .venv; long-lived.

**2. `services/agent-framework-sidecar/`** — Python stdio stub for an optional Agent-Framework/MAF execution substrate. `health` false unless `agent_framework` installed; `run_workflow` returns `not_implemented_use_native` → **native scheduler remains default**. Consumed by **`packages/runtime`** (`execution/sidecarClient.ts` `StdioAgentFrameworkSidecar`, `execution/substrate.ts` fallback) and the surface layer **`runtimeBridge`** when substrate config = `agent-framework` (default native).

**3. `services/project-intelligence/`** — standalone Context Intelligence daemon (Node package `@singularity/project-intelligence`, `dist/main.js`). Hosts `IntelligenceEngine` + architecture/memory/outcome subsystems + GraphSink; **HTTP** on `127.0.0.1:4781`, `SINGULARITY_INTELLIGENCE_PORT`. Endpoints mounted from `@singularity/intelligence` (`/health`, `/project-status`, `/context?q=`, POST `/search`,`/symbols`,`/impact`,`/events`,`/lsp`,`/bootstrap`,`/plane/coding-event`). Consumed by **`packages/intelligence`** (engine + `IntelligenceClient`); the surface layer spawns it via **`intelligenceWorkerProcess.ts`**; bridged through `intelligenceBridge`, `intelligenceUtils`, `architectureBridge`, etc.

**4. `services/qwen-router-sidecar/`** — Python stdio local MLX routing classifier (Qwen3-1.7B-MLX-4bit). Emits structured routing JSON (intent/scoping/risk flags/ambiguity/complexity). ops: `classify`, `ping`, `stats`. Consumed by **`packages/router/src/localRoutingClassifier/`** (`sidecarClient.ts` `QwenSidecarClient` → `index.ts` `classifyAndRoute`), gated by `SINGULARITY_QWEN_ROUTER=1`, load-once, never HTTP. **Currently only referenced by tests — not wired into the live routing hot path.**

---

## CLASSIFICATION & RECOMMENDATIONS (Target: Model Router as single model-selection owner)

Design target: a single **Model Router** should own model selection. Mapping:

### Router internals (`packages/router`)

- **KEEP (core, single-owner kernel)**: `engine.ts` (routing pipeline), `models/catalog.ts`, `tiers.ts`, `filter.ts`, `score.ts`, `modelMatcher.ts`, `features.ts`, `fallback.ts`, `conversationSwitch.ts` (decider surface), `cache.ts` (route-decision cache), `rateLimit.ts`, `telemetry/*`, `contextSegments.ts`, `taskClassifier.ts`, middleware/re-exports, types.
- **MERGE into Model Router**: `providers/adapter.ts` (+ `openrouter.ts`/`local.ts`/`direct.ts`) — should become the **single provider client** (see duplicates below). Also `llmDecision.ts`, `specialtyClassifier.ts`, `specialty.ts`, `specialtyMemo.ts`, `localRoutingClassifier/*`, `nemotronFlashPro/*` — all **decision sub-engines** that should stay as configurable "decision-LLM" strategy slots *inside* the router (they are legit router-branded decision callers, not separate clients per se — but each currently carries its own HTTP hop; consolidate behind one decision client + the shared rate gate).

### Duplicate model clients to MERGE/REPLACE (the real problem)

- **`vscode/.../singularity-chat/.../singularityRouterBridge.ts` `SingularityAutoRouter`** — full tier/intent/subTier re-implementation. **DELETE/REPLACE**: move the auto-router behind `@router` engine + router's tier/subtier mapping; either import the router's `createRoutingEngine` (and default to Flash-0731 via router's catalog) or at minimum share one tier table.
- **`packages/brain/src/modelClient.ts`** — its own HTTP client. **REPLACE** with router's `ModelAdapter`/a provider from `@singularity/router` (or make Brain take an injected `IModelProvider`). Unless Brain intentionally must not load the router barrel — then keep the wrapper but route through a common provider interface.
- **`packages/design/src/agencyAgentClassifier.ts`** own chat/completions call. **MERGE/REDUCE**: use router-side decision clients or the router's `ModelAdapter` for the classifier hop.
- **`packages/neural-relay/src/intelligence/OpenRouterNemotronProvider.ts`** — intentional isolation for barrel-load reasons. **KEEP as a thin wrapper**, but share the provider HTTP/error/rate-gate primitives (not a second full client).
- **`vscode/.../cobuild/cobuildService.ts`** — separate substrate (pod gateway); not a router-client; **KEEP** (external system), but do not let it influence model selection.
- **`packages/runtime/src/llm.ts` `TOKENROUTER_TIER_MODELS`** + **`packages/router/src/models/catalog.ts`** + **`vscode.../singularityRouterBridge.ts SUB_TIER_MODELS`** — **three parallel tier→model tables**. **MERGE** into `@router` `catalog.ts` as the single source of truth; runtime and the chat auto-router should read from it.
- **`packages/design/src/types.ts` `FRONTEND_OWNER_MODEL_ID`** — duplicate constant. **MERGE**: import from `@singularity/router` `specialty.ts`.
- **`packages/prompt/src/routing/packs.ts`/`routerIntegration.ts`** — metadata only, no model calls. **KEEP** as the router's context-pack metadata dependency.

### Bridges — which bridge wires which target system

| Bridge | Wiring (who owns which model-client / selection) |
|---|---|
| `runtimeBridge` | passes the host `SingularityAI` instance into `createRuntimeEngineFromAI` → engine's `LlmPort` → router path. Wires **Model Router** → runtime engine. |
| `brainBridge` | gets `ai` (router instance) but brain uses its **own** `OpenAiCompatibleBrainClient`. **MERGE** to use router's providers. |
| `neuralRelayBridge` | uses `@singularity/neural-relay` (own Nemotron client). **KEEP** isolation; not a router route owner. |
| `contextEngineBridge` | uses `@singularity/context` + router instance. Wires **Model Router** → context extraction (LangExtract). |
| `intelligenceBridge` / `intelligenceRemoteEngine` / `intelligenceWorkerProcess` | use `@singularity/intelligence` (out-of-process daemon). **KEEP**; it is an index/graph server, not a model client. |
| `wikiBridge` | uses `@singularity/wiki` (LLM wiki KB; own ingestion/answer path). **out-of-scope** for routing. |
| `memoryBridge` / `outcomeBridge` / `architectureBridge` / `globalMemoryBridge` | plain subsystems; **KEEP**. |
| `designPreviewGate` | wraps design + runtime gate port; **KEEP** (disabled). |
| `cobuild/*` + `hyperspaceCli` | external pod; **KEEP**. |
| `singularityRouterBridge` (chat auto) | **REPLACE/DELETE** — the duplicate of `@router`. |

### Recommended end-state

- **Model selection owner** = `@singularity/router` (`RoutingEngine` + `catalog.ts`). It is already the primary path in the IDE (via `SingularityAI`). Runtime learns it via the `LlmPort` adapter — correct.
- **Kill the disconnected router-clients**: brain modelClient, design agency classifier, chat auto-router, and the parallel tier tables all collapse onto the single router API. Decision-LLM hops (specialty/flash-pro/qwen) become pluggable decision-strategy slots inside the router, sharing the same provider client and rate gate.
- **NEVER route model selection through**: neural-relay (intentional), cobuild (external gateway), project-intelligence (index/daemon).

---

### Open questions / unknowns
- `SingularityAutoRouter` (chat ext) may be used on the chat default-path but is not wired to router — confirm which path chat actually takes at runtime to decide MERGE vs DELETE.
- qwen-router-sidecar's `classifyAndRoute` is test-only; decide whether to activate it as an offline decision strategy (it competes with the Nemotron specialty hop) or deprecate.
- Whether `brain`/`design` *must* keep load-weight isolation (they may be shipped independently of the router barrel) — this drives whether "merge" becomes "share a provider primitive" instead.

---

*Independent verification notes:* I ran `packages/router` tests; 119/120 pass; the one failure is `openrouter.test.ts` → `posts to /chat/completions with auth headers` (default base URL changed to `openrouter.ai/api/v1`, stale test assertion expects `ai-gateway.vercel.sh/v1`).