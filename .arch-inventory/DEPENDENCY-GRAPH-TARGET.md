# H. TARGET DEPENDENCY GRAPH — how the 14 systems communicate

```
                    Chat Runtime
                        │
                        ▼
                   Neural Relay (event fabric)  ── transport only ──
                        │
                 ┌──────┼──────┬──────┬──────┐
                 ▼      ▼      ▼      ▼      ▼
              Brain   Context   Model   Mission   Architecture
              (store)  Engine   Router  Engine    Intelligence
                        │        │      │   │          │
                        ▼        ▼      ▼   ▼          ▼
                          Architecture Int. │  Agent Runtime ──► Tool Runtime
                                            ▼         │        │
                                        Verification  │        ▼
                                        Engine        ► Observation Engine
                                            │         │
                                            ▼         ▼
                                          Brain (learns)

Supported by: Runtime Persistence / Runtime Observability / Policy Layer (cross-cutting).
Surfaced through: Chat Runtime.
```

### Communication contract
- **Neural Relay** = the ONLY inter-component event path. Chat → Relay → [Brain|Context|Model Router|Mission]. No plane talks to another directly except via the relay + typed ports.
- **Brain** exposes `remember/retrieve/update/relate/consolidate/timeline/forget`. Context reads Brain knowledge via `retrieve`; never writes to another plane's store.
- **Model Router** answers only "which model", returns RouteDecision. Mission/Agent/Tool/Context all consume it for model choice; they never call providers directly.
- **Mission → Agent → Tool** is a strict downward chain. Mission owns the DAG/lifecycle; Agent owns worker spawning; Tool owns side-effect execution boundaries.
- **Verification** reads Tool/Agent/Architecture outcomes to decide accept/reject; **Observation** reads production reality + runtime signals to decide "did outcome happen".
- **Fast path** (User→Chat→Relay→Router→Model→stream→Relay→Chat) touches only: Chat Runtime, Neural Relay, Model Router. No Brain/Architecture/Mission/Agent on the hot path.
- **Deep path** touches the full chain above. The same engines, no duplicate impl.

## Movement: how current packages map onto the chain
Current `@singularity/router` SingularityAI already implements fast path (route→cache→prompt→provider→stream). Current `@singularity/runtime` already implements the deep path (planner→worker→scheduler→integrator→verify). The consolidation keeps these two as the ChatRuntime+fabric and Mission/Agent/Tool engines, and routes all other planes (Brain/Context/Architecture/outcome) behind them via the relay.
