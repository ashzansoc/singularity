/**
 * Design Intelligence Pipeline — architecture overview.
 *
 * DESIGNER (DeepSeek V4 Pro)     → Design Specification
 * PREVIEW GATE (human)            → Penpot / Spec board OR skip
 * IMPLEMENTER (DeepSeek V4 Flash) → Frontend code
 * BROWSER                         → Screenshots / console / DOM
 * CRITIC (DeepSeek V4 Pro)        → Scores + actionable findings
 * IMPLEMENTER (refine ≤ 3)        → Fixes until PASS or max iterations
 *
 * Libraries are implementation resources — never art directors.
 */

## Default frontend libraries (Singularity)

For any HTML/CSS/JS/React frontend task, Design Intelligence defaults to:

| Library | Role | Install |
|---------|------|---------|
| **[React Bits](https://github.com/DavidHDev/react-bits)** | Animated text, backgrounds, interactive UI | `npx shadcn@latest add @react-bits/<Component>-TS-TW` |
| **[GodUI](https://godui.design)** | Motion components, overlays, AI surfaces, animated icons | MCP `@godui/mcp` or `npx shadcn@latest add "https://godui.design/r/<name>.json"` |
| shadcn / Radix | Primitives underneath | existing shadcn flow |

Knowledge files: `knowledge/react-bits.md`, `knowledge/godui.md`.  
MCP snippet: `mcp/godui.mcp.json`.

Libraries are implementation resources — never art directors. Design Spec owns visual identity.

## Pipeline stages

See `src/frontendPipeline.ts`, `src/designDirector.ts`, `src/visualCritic.ts`,
`src/designSpec.ts`, `src/designPreviewGate.ts`, `src/designBoardHtml.ts`,
`src/designKnowledgeRetrieval.ts`, `src/browserCapture.ts`.

## Ownership

| Role | Model | Writes code? |
|------|-------|--------------|
| Design Director | nvidia/nemotron-3-ultra (example Spec + user prompt) | Design Spec JSON only |
| Design Preview | In-IDE Design Canvas (Spec frames) | Notes / Final Design unlock |
| Frontend Implementer | deepseek/deepseek-v4-flash-0731 | App UI only |
| Visual Critic | deepseek/deepseek-v4-pro | Verdict JSON only |
| Backend / Infra | other lanes | their owned paths |

## Agent / Automode (VS Code)

Same pipeline runs inside Agent chat (not only Runtime DAG):

1. Frontend specialty → Design Director writes `.singularity/design-spec.json` **only if missing** (existing Spec is reused, never overwritten).
2. **Design Canvas opens automatically** beside Agent chat (no login / Penpot).  
   - **Final Design** → coding continues with Spec  
   - **Skip & code** → coding continues without further review  
3. Spec injected into system prompt; Flash implements
4. On Stop → Playwright capture (3 viewports if preview is up) + Visual Critic
5. FAIL forces refine (≤ 3); PASS allows stop

Implementation: `agentDesignCanvas.ts` (Agent-native) + `singularity-ai` Design Canvas panel (DAG / `@dag`).

See `vscode/extensions/singularity-chat/src/platform/endpoint/node/designIntelligence.ts`
and `vscode/extensions/singularity-chat/src/platform/endpoint/node/agentDesignCanvas.ts`.
