# Sidecar Services Inventory (captured from router-cluster report earlier; restored)

## 1. services/langextract-sidecar/
- Purpose: single-process stdio wrapper around Google `langextract==1.6.0`; converts text → structured ExtractionDelta (requirements/constraints/technologies/architecture decisions/preferences/goals/entities/files).
- Transport: stdio JSON-lines; spawned by packages/context/src/sidecarClient.ts (venv, persistent, correlation by id, timeouts, respawn, circuit breaker).
- Ops: `ping` (`{ok, pong}`), `extract` (text, source_metadata, existing_state_summary, complexity, config→model default gemini-2.0-flash, provider, temp, max_output_tokens, api_key, base_url) → `{ok, delta, raw_item_count, provider, model, tokens}`.
- Consumer: packages/context (LangExtractSidecarClient + LangExtractContextExtractor, ContextEngine, langextract_enabled flag); vscode contextEngineBridge + langExtractBackgroundAgent.

## 2. services/agent-framework-sidecar/
- Purpose: MVP stub for an optional Agent-Framework orchestration substrate (MAF workflows from DAG JSON). `health` = false unless agent_framework installed; `run_workflow` returns not_implemented_use_native → native scheduler is de-facto default.
- transport stdio JSON-lines; spawn by packages/runtime/src/execution/sidecarClient.ts (StdioAgentFrameworkSidecar).
- Consumer: packages/runtime execution/substrate.ts (AgentFrameworkExecutionSubstrate falls back to native when unhealthy); vscode runtimeBridge reads substrate config (native|agent-framework default native).

## 3. services/project-intelligence/
- Purpose: standalone Context Intelligence daemon/index (Node package @singularity/project-intelligence → dist/main.js). Hosts IntelligenceEngine + createArchitectureSubsystem + createMemorySubsystem + createOutcomeSubsystem + GraphSink; HTTP on 127.0.0.1:4781.
- Endpoints mounted from packages/intelligence http.ts: /health, /project-status, /context?q=, POST /search, /symbols, /impact, /dependencies, /architecture, /events, /lsp, /bootstrap, /plane/coding-event.
- Consumer: vscode intelligenceWorkerProcess.ts spawns dist/intelligenceWorker/main.js; bridges intelligence/intelligenceRemoteEngine/architectureBridge/outcomeBridge/memoryBridge use IntelligenceClient.

## 4. services/qwen-router-sidecar/
- Purpose: stdio JSON-lines local MLX routing classifier (Qwen3-1.7B-MLX-4bit default) → structured routing JSON (intent, scoping, risk booleans, ambiguity/complexity/scope). Optional, unused unless local MLX model present; SINGULARITY_QWEN_ROUTER=1 gated.
- Transport stdio; spawned by packages/router/src/localRoutingClassifier/sidecarClient.ts (QwenSidecarClient).
- Ops: `classify`, `ping`, `stats`. Output keys per localRoutingClassifier/schema.ts.
- Consumer: packages/router localRoutingClassifier (classifyAndRoute in index.ts); not invoked on hot path today.

## Summary
- langext→context intake; agent-framework→(dead stub) runtime; project-intelligence→intelligence daemon; qwen-router→optional local router classifier.
