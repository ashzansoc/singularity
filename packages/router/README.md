# @singularity/router

Cost-aware model routing engine for the Singularity AI IDE.

Routes each request to the cheapest model that can complete the task using:

1. Feature extraction  
2. Rule-based intent classification  
3. Capability filtering  
4. Weighted scoring (`0.40` quality + `0.25` cost + `0.20` latency + `0.10` reliability + `0.05` preference)  
5. Tier escalation fallback  
6. OpenRouter (plus local/direct stubs)

This package is **standalone** and is also wired into the Singularity IDE:

- Singularity Auto mode uses `SingularityAutoRouter` when `singularity.chat.chat.singularityRouter.enabled` is `true` (default).
- Launch everything from the repo root: `npm start` (builds the router, then runs `vscode/scripts/code.sh`).

## Install & develop

```bash
# From repo root — builds router and launches the IDE
npm start

# Package only
cd packages/router
npm install
npm test
npm run build
```

## Quick start

```ts
import { createRoutingEngine, OpenRouterProvider, ModelAdapter } from '@singularity/router';

const engine = createRoutingEngine();

const decision = engine.route({
  prompt: 'refactor the payment module',
  mode: 'chat',
  openFileCount: 3,
  language: 'typescript',
});

console.log(decision.model.id, decision.tier, decision.intent);

// On timeout / low quality / tool failure:
const next = engine.escalate(decision, 'timeout');

// Optional: call the chosen provider (needs OPENROUTER_API_KEY)
const adapter = new ModelAdapter({
  openrouter: { apiKey: process.env.OPENROUTER_API_KEY },
});
```

## Environment

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | Required for live OpenRouter chat completions |

Routing itself does **not** need a network call — only `OpenRouterProvider.chatCompletions` does.

## Public API

- `createSingularityAI(config?)` → `complete()`, `status()`, `clearCaches()` (route + cache + provider)
- `createRoutingEngine(config?)` → `route(ctx)`, `escalate(decision, reason)`, `clearCache()`
- `DEFAULT_MODEL_CATALOG` — static T0–T6 capability matrix
- `OpenRouterProvider` / `LocalProvider` / `DirectProvider` / `ModelAdapter`

## Out of scope (MVP package)

- ML intent classifier  
- Persistent telemetry / Postgres  
- REST service  

IDE Auto-mode integration lives in `vscode/extensions/singularity-chat/.../singularityRouterBridge.ts`.
The `singularity-ai` extension boots `createSingularityAI()` on IDE startup.
