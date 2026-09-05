# Singularity Prompt Engine v3

## Philosophy

Prompts are compiled artifacts. Context is a graph. The system learns continuously.

## Pipeline

```
Indexer → Context Graph → Memory → Retrieval
  → Context Intelligence Layer
  → Multi-stage Compiler (collect → rank → deps → knapsack → IR graph)
  → Prompt Simulator (dry-run / repair / risk)
  → Prompt Cache / Snapshots
  → Provider Adapter → LLM
  → Telemetry → Learning Engine ↺
```

## v3 Features

1. Context Quality Scorer (quality / token)
2. Weighted knapsack budget optimizer
3. Learned context ranking
4. Adaptive budgets by task/language/repo size
5. Prompt evolution via fingerprints + outcomes
6. Multi-stage compiler
7. Graph Diff Engine
8. Context Snapshots (embedding similarity)
9. Prompt Fingerprinting (SHA256 + similarity hash + embedding)
10. Learning Engine feedback loop
11. **Prompt Simulation Layer** — validate & dry-run IR before cache/provider

Composition root: `createPromptEngine()` + `recordOutcome()`.
