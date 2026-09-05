# Cross-Package Dependency Graph (source of truth: @singularity/* imports)

## Package → @singularity/* deps (from depscan.mjs, src only)
| Pkg | Depends on |
|---|---|
| architecture | cache, context |
| brain | (none) |
| cache | router |
| context | (none) |
| design | (none) |
| intelligence | architecture, memory, outcome, prompt |
| memory | cache, context |
| neural-relay | intelligence, router |
| outcome | context |
| prompt | cache |
| router | cache, prompt |
| runtime | context, design, prompt, router |
| wiki | context |

## Consumers per package (whole repo, excl self/dist/node_modules)
- **brain**: vscode brainBridge, intelligenceShell/shellPanel
- **memory**: intelligence(http), memoryBridge, project-intelligence, (intelligence pkg)
- **neural-relay**: cacheTelemetry, neuralRelayBridge
- **architecture**: intelligence(pkg), architectureBridge, project-intelligence
- **context**: memory, runtime(test), wiki, outcome, architecture, contextEngineBridge
- **intelligence**: neural-relay(index), intelligenceWorkerProcess/Bridge/RemoteEngine, architectureBridge, project-intelligence
- **wiki**: wikiBridge
- **cache**: memory, architecture, prompt, router
- **prompt**: intelligence, runtime, router
- **router**: cache(DESIGN only), runtime
- **runtime**: extension.ts, runtimeChatParticipant, runtimeBridge, shellPanel
- **design**: (extension)
- **outcome**: intelligence(pkg), outcomeBridge, project-intelligence

## Key structural facts
1. **router is the hot-path hub** — SingularityAI (router/src/runtime.ts) is the only place that wires
   route → cache → prompt-engine → provider → stream. Its promptEngine is @singularity/prompt.
2. **intelligence is the deep-path hub** — the only package depending on architecture+memory+outcome.
   project-intelligence/src/main.ts is the daemon that wires IntelligenceEngine + architecture + memory + outcome
   + graph/memory sinks onto one HTTP server.
3. **brain has ZERO package deps and NO @singularity consumers except extension bridge** — it is a
   user-level (not project-level) persistent memory graph, deliberately separate.
4. **Verification truth = outcome** (sqlite); **architecture truth = architecture.sqlite**.
5. **Triplicated event fabric**: architecture/memory/outcome each implement InMemoryEventBus+OutboxPublisher+WAL.
6. **Four independent retrieval/ranking/assembly** implementations: context, prompt, intelligence, wiki.
