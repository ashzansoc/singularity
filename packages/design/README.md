# @singularity/design

Frontend Design Intelligence + Design DNA for Singularity.

**Design Director:** `nvidia/nemotron-3-ultra-550b-a55b:free` (EXAMPLE Spec + user prompt → unique Design Spec)  
**Frontend Implementer:** `deepseek/deepseek-v4-flash-0731`  
**Visual Critic:** `deepseek/deepseek-v4-pro` (scores + findings; no code edits)

See [DESIGN_INTELLIGENCE.md](./DESIGN_INTELLIGENCE.md) for the full pipeline.

## What this package does

1. **Design Director** — Produces a structured Design Specification (no code).
2. **Split knowledge retrieval** — Design knowledge vs implementation knowledge (libraries ≠ art direction).
3. **Frontend implementer context** — Spec + DNA + references for DeepSeek Flash.
4. **Visual Critic** — Genericness / brand / product scores with hard gates + refine loop (≤ 3).
5. **DAG injection** — `injectFrontendDesignPipeline` adds director → implement → browser → critic → refine.
6. **Design DNA** — Persists successful decisions under `.singularity/design-dna.json`.


## Default frontend stack

Singularity frontend agents default to **React Bits** + **GodUI** (install for real; restyle to Design Spec):

- Knowledge: `knowledge/react-bits.md`, `knowledge/godui.md`
- GodUI MCP: copy `mcp/godui.mcp.json` into the workspace/user MCP config
- Design-source planner enables both with action `use` for UI work

## Install reference repos

```bash
npm run install-design-refs
```

## Usage

```ts
import {
  buildFrontendContext,
  loadDesignDna,
  FRONTEND_OWNER_MODEL_ID,
} from '@singularity/design';

const dna = loadDesignDna(workspaceRoot);
const ctx = buildFrontendContext({
  task: 'Build analytics dashboard UI',
  dna,
});
// ctx.modelId === 'deepseek/deepseek-v4-pro'
// ctx.systemPrompt includes DNA + retrieved knowledge
```
