/**
 * Design-source planner: for each frontend knowledge tool, decide
 * `use` | `ask` | `skip` so nothing is silently missed.
 *
 * 12 planner tools (React Bits + GodUI defaults; website-cloner on like+URL).
 * At most 9 asks.
 */

import { getDesignSource, DESIGN_SOURCES } from './catalog.js';
import { retrieveDesignKnowledgeForSources } from './knowledge.js';
import {
  FRONTEND_ACCEPTANCE_CHECKS,
  FRONTEND_TASTE_RULES,
} from './tasteRules.js';
import type { DesignSource } from './types.js';

export type DesignSourceAction = 'use' | 'ask' | 'skip';

/** Detect “something like https://…” / clone / inspired-by reference intents. */
export function extractReferenceSiteUrls(prompt: string): string[] {
  const urls = prompt.match(/https?:\/\/[^\s<>"'`)\]]+/gi) ?? [];
  return [...new Set(urls.map((u) => u.replace(/[.,;:!?)]+$/, '')))];
}

export function detectReferenceSiteIntent(prompt: string): {
  active: boolean;
  urls: string[];
  reason: string;
} {
  const urls = extractReferenceSiteUrls(prompt);
  if (!urls.length) {
    return { active: false, urls: [], reason: 'no URL' };
  }
  const p = prompt.toLowerCase();
  const likePhrase =
    /\b(something|site|page|website|landing|app|product|ui|design)\s+like\b/.test(p)
    || /\b(inspired\s+by|similar\s+to|based\s+on|look(?:s|ing)?\s+like|feel(?:s|ing)?\s+like)\b/.test(p)
    || /\btake\s+(?:a\s+)?(?:visual\s+)?reference\s+from\b/.test(p)
    || /\breference\s+(?:from|site|url|page|website)\b/.test(p)
    || /\b(clone|replicate|rebuild|reverse[-\s]?engineer|copy\s+this|pixel[-\s]?perfect)\b/.test(p)
    || /\/clone-website\b/.test(p);
  if (!likePhrase) {
    // Bare URL with make/build still counts when paired with make/create verbs
    const makeWithUrl =
      /\b(make|build|create|design|implement)\b/.test(p)
      && /\b(like|inspired|similar|clone|reference)\b/.test(p);
    if (!makeWithUrl) {
      return { active: false, urls, reason: 'URL present but no like/clone phrasing' };
    }
  }
  return {
    active: true,
    urls,
    reason: `reference site intent → ${urls.join(', ')}`,
  };
}

/** Canonical tools shown to Nemotron / user. React Bits + GodUI default ON. */
export const PLANNER_TOOLS = [
  {
    id: 'react-bits',
    name: 'React Bits',
    bestUsedFor: 'Animated text, backgrounds, interactive UI',
    knowledgeIds: ['react-bits'],
    askQuestion: 'Use React Bits animated components (text, backgrounds, docks)?',
  },
  {
    id: 'godui',
    name: 'GodUI',
    bestUsedFor: 'Motion components, overlays, AI surfaces, animated icons',
    knowledgeIds: ['godui'],
    askQuestion: 'Use GodUI motion components (buttons, dialogs, AI surfaces, icons)?',
  },
  {
    id: 'shadcn',
    name: 'shadcn/ui',
    bestUsedFor: 'Component primitives',
    knowledgeIds: ['shadcn'],
    askQuestion: 'Use shadcn/ui component primitives (Button, Input, Dialog, Form)?',
  },
  {
    id: 'website-cloner',
    name: 'Website Cloner',
    bestUsedFor: 'Reverse-engineer a reference URL then build the user product',
    knowledgeIds: ['website-cloner'],
    askQuestion: 'Clone/analyze the reference URL with the website-cloner workflow before building?',
  },
  {
    id: 'aceternity',
    name: 'Aceternity UI',
    bestUsedFor: 'Premium visual effects',
    knowledgeIds: ['aceternity'],
    askQuestion: 'Add Aceternity-style premium visual effects (spotlight, beams, glow heroes)?',
  },
  {
    id: 'magic-ui',
    name: 'Magic UI',
    bestUsedFor: 'Animated UI',
    knowledgeIds: ['magic-ui'],
    askQuestion: 'Add Magic UI animated elements (marquees, shimmer, bento motion)?',
  },
  {
    id: 'radix',
    name: 'Radix',
    bestUsedFor: 'Accessible primitives',
    knowledgeIds: ['radix'],
    askQuestion: 'Use Radix accessible primitives for overlays/menus (via shadcn where possible)?',
  },
  {
    id: 'mantine',
    name: 'Mantine',
    bestUsedFor: 'Application components',
    knowledgeIds: ['mantine'],
    askQuestion: 'Use Mantine application components (only if you want a Mantine-first stack)?',
  },
  {
    id: 'tremor',
    name: 'Tremor',
    bestUsedFor: 'Analytics dashboards',
    knowledgeIds: ['tremor'],
    askQuestion: 'Use Tremor for analytics / KPI / chart dashboards?',
  },
  {
    id: 'heroui-nextui',
    name: 'NextUI / HeroUI ecosystem',
    bestUsedFor: 'SaaS interfaces',
    knowledgeIds: ['heroui', 'nextui'],
    askQuestion: 'Use HeroUI / NextUI patterns for the SaaS / app shell UI?',
  },
  {
    id: 'tailwind-patterns',
    name: 'Tailwind UI-style references',
    bestUsedFor: 'Layout patterns',
    knowledgeIds: ['tailwind-patterns', 'shadcn-taxonomy'],
    askQuestion: 'Follow Tailwind UI-style layout patterns (max-width sections, marketing rhythm)?',
  },
  {
    id: 'threejs',
    name: 'Three.js examples',
    bestUsedFor: '3D interactions',
    knowledgeIds: ['threejs'],
    askQuestion: 'Include Three.js / React Three Fiber 3D elements?',
  },
] as const;

export type PlannerToolId = (typeof PLANNER_TOOLS)[number]['id'];

export interface DesignSourceDecision {
  id: PlannerToolId;
  name: string;
  bestUsedFor: string;
  action: DesignSourceAction;
  reason: string;
  askQuestion?: string;
}

export interface DesignSourcePlan {
  decisions: DesignSourceDecision[];
  /** Sources auto-enabled or confirmed. */
  activeIds: PlannerToolId[];
  /** Questions to ask the user (≤ 9). */
  questions: Array<{ id: PlannerToolId; question: string }>;
  source: 'llm' | 'rules';
  reason: string;
}

export interface LlmSourceVote {
  id: string;
  action: DesignSourceAction;
  reason?: string;
}

/**
 * Heuristic defaults — React Bits + GodUI always ON for frontend.
 * Website Cloner ON when “something like” + URL (or clone/inspired-by + URL).
 * SaaS → HeroUI/NextUI on; Three.js only when explicitly requested.
 * Aceternity/Magic UI stay opt-in (covered by React Bits + GodUI).
 */
export function planDesignSourcesRules(prompt: string): DesignSourcePlan {
  const p = prompt.toLowerCase();
  const isFrontend =
    /\b(frontend|ui|ux|react|next\.?js|vite|html|css|tsx|jsx|component|page|landing|website|web\s*app|dashboard|design)\b/.test(
      p,
    ) || p.trim().length > 0;
  const isSaas =
    /\b(saas|app\s*shell|dashboard|settings|sidebar|admin|product\s*ui|application\s*ui)\b/.test(p);
  const isMarketing =
    /\b(landing|marketing|hero|waitlist|pricing|launchpad|one[-\s]?page)\b/.test(p);
  const wants3d = /\b(3d|three\.?js|webgl|canvas\s*scene|react-three|r3f)\b/.test(p);
  const wantsCharts = /\b(chart|analytics|kpi|metric|tremor|dashboard)\b/.test(p);
  const wantsAceternity =
    /\b(aceternity|spotlight\s*card|background\s*beams)\b/.test(p);
  const wantsMagicUi = /\b(magic\s*ui|magicui)\b/.test(p);
  const wantsForms = /\b(form|dialog|modal|dropdown|component|button|input)\b/.test(p);
  const explicitMantine = /\bmantine\b/.test(p);
  const referenceIntent = detectReferenceSiteIntent(prompt);

  const decisions: DesignSourceDecision[] = PLANNER_TOOLS.map((tool) => {
    let action: DesignSourceAction = 'ask';
    let reason = 'confirm with user';

    switch (tool.id) {
      case 'react-bits':
        action = isFrontend ? 'use' : 'ask';
        reason =
          action === 'use'
            ? 'Singularity default — React Bits for animated text/backgrounds/UI'
            : reason;
        break;
      case 'godui':
        action = isFrontend ? 'use' : 'ask';
        reason =
          action === 'use'
            ? 'Singularity default — GodUI motion components + animated icons'
            : reason;
        break;
      case 'shadcn':
        action = wantsForms || isSaas || isMarketing || isFrontend ? 'use' : 'ask';
        reason = action === 'use' ? 'default primitives under GodUI / React Bits' : reason;
        break;
      case 'website-cloner':
        action = referenceIntent.active ? 'use' : 'skip';
        reason = referenceIntent.active
          ? referenceIntent.reason
          : 'no like/clone + URL — skip website cloner';
        break;
      case 'radix':
        action = wantsForms || isSaas ? 'use' : isFrontend ? 'use' : 'ask';
        reason = action === 'use' ? 'a11y primitives with shadcn' : reason;
        break;
      case 'heroui-nextui':
        action = isSaas ? 'use' : isMarketing ? 'ask' : 'ask';
        reason = isSaas ? 'SaaS UI → HeroUI/NextUI default ON' : 'confirm SaaS component kit';
        break;
      case 'tailwind-patterns':
        action = 'use';
        reason = 'layout patterns always useful';
        break;
      case 'tremor':
        action = wantsCharts ? 'use' : isSaas ? 'ask' : 'skip';
        reason =
          action === 'use'
            ? 'analytics/dashboard signals'
            : action === 'ask'
              ? 'optional charts for SaaS'
              : 'no analytics signals';
        break;
      case 'aceternity':
        // Prefer React Bits; only enable Aceternity when explicitly named.
        action = wantsAceternity ? 'use' : 'skip';
        reason = wantsAceternity
          ? 'Aceternity explicitly requested'
          : 'covered by React Bits default — skip unless asked';
        break;
      case 'magic-ui':
        action = wantsMagicUi ? 'use' : 'skip';
        reason = wantsMagicUi
          ? 'Magic UI explicitly requested'
          : 'covered by GodUI / React Bits default — skip unless asked';
        break;
      case 'mantine':
        action = explicitMantine ? 'use' : 'skip';
        reason = explicitMantine ? 'explicitly requested' : 'prefer shadcn + GodUI unless asked';
        break;
      case 'threejs':
        action = wants3d ? 'use' : 'skip';
        reason = wants3d
          ? '3D explicitly requested — must be product-specific, not a blob demo'
          : 'skip decorative 3D unless user asked; prefer product SVG/diagram + React Bits';
        break;
    }

    return {
      id: tool.id,
      name: tool.name,
      bestUsedFor: tool.bestUsedFor,
      action,
      reason,
      askQuestion: action === 'ask' ? tool.askQuestion : undefined,
    };
  });

  return finalizePlan(decisions, 'rules', 'heuristic defaults');
}

/** Merge Nemotron votes onto rules baseline (LLM cannot invent unknown ids). */
export function mergeDesignSourceVotes(
  baseline: DesignSourcePlan,
  votes: LlmSourceVote[],
): DesignSourcePlan {
  const byId = new Map(votes.map((v) => [v.id, v]));
  const decisions = baseline.decisions.map((d) => {
    const vote = byId.get(d.id);
    if (!vote) {
      return d;
    }
    let action = normalizeAction(vote.action) ?? d.action;
    // Preserve Singularity defaults when the LLM vote would weaken them.
    if (d.id === 'threejs' && d.action === 'use' && action === 'skip') {
      action = 'use';
    }
    if (d.id === 'heroui-nextui' && d.action === 'use' && action === 'ask') {
      action = 'use';
    }
    if ((d.id === 'react-bits' || d.id === 'godui') && d.action === 'use') {
      action = 'use';
    }
    if (d.id === 'website-cloner' && d.action === 'use' && action === 'skip') {
      action = 'use';
    }
    const tool = PLANNER_TOOLS.find((t) => t.id === d.id)!;
    return {
      ...d,
      action,
      reason: vote.reason?.trim() || d.reason,
      askQuestion: action === 'ask' ? tool.askQuestion : undefined,
    };
  });
  return finalizePlan(decisions, 'llm', 'nemotron design-source plan');
}

export function applyUserAnswers(
  plan: DesignSourcePlan,
  answers: Record<string, { selected?: string[]; freeText?: string | null; skipped?: boolean }>,
): DesignSourcePlan {
  const decisions = plan.decisions.map((d) => {
    if (d.action !== 'ask') {
      return d;
    }
    const ans = answers[d.id] ?? answers[d.name];
    if (!ans || ans.skipped) {
      return { ...d, action: 'skip' as const, reason: 'user skipped', askQuestion: undefined };
    }
    const picked = (ans.selected ?? []).join(' ').toLowerCase();
    const free = (ans.freeText ?? '').toLowerCase();
    const yes = /\b(yes|y|true|use|enable|include|sure|ok)\b/.test(`${picked} ${free}`);
    const no = /\b(no|n|false|skip|disable|without|none)\b/.test(`${picked} ${free}`);
    if (yes && !no) {
      return { ...d, action: 'use' as const, reason: 'user confirmed yes', askQuestion: undefined };
    }
    if (no) {
      return { ...d, action: 'skip' as const, reason: 'user declined', askQuestion: undefined };
    }
    // Default: first option often "Yes"
    if ((ans.selected ?? [])[0]?.toLowerCase().startsWith('y')) {
      return { ...d, action: 'use' as const, reason: 'user selected yes', askQuestion: undefined };
    }
    return { ...d, action: 'skip' as const, reason: 'user did not confirm', askQuestion: undefined };
  });
  return finalizePlan(decisions, plan.source, 'user answers applied');
}

function finalizePlan(
  decisions: DesignSourceDecision[],
  source: DesignSourcePlan['source'],
  reason: string,
): DesignSourcePlan {
  // Cap asks at 9 even if tool count is higher
  let asks = decisions.filter((d) => d.action === 'ask');
  if (asks.length > 9) {
    const drop = asks.length - 9;
    const skipFirst = asks.slice(0, drop).map((d) => d.id);
    for (const d of decisions) {
      if (skipFirst.includes(d.id)) {
        d.action = 'skip';
        d.reason = 'ask budget exceeded';
        d.askQuestion = undefined;
      }
    }
    asks = decisions.filter((d) => d.action === 'ask');
  }

  const activeIds = decisions.filter((d) => d.action === 'use').map((d) => d.id);
  const questions = decisions
    .filter((d) => d.action === 'ask' && d.askQuestion)
    .map((d) => ({ id: d.id, question: d.askQuestion! }));

  return { decisions, activeIds, questions, source, reason };
}

function normalizeAction(raw: string): DesignSourceAction | undefined {
  const a = raw.toLowerCase().trim();
  if (a === 'use' || a === 'yes' || a === 'on' || a === 'enable') {
    return 'use';
  }
  if (a === 'ask' || a === 'confirm' || a === 'question') {
    return 'ask';
  }
  if (a === 'skip' || a === 'no' || a === 'off' || a === 'disable') {
    return 'skip';
  }
  return undefined;
}

/** Expand planner ids → catalog DesignSource rows. */
export function resolveActiveDesignSources(plan: DesignSourcePlan): DesignSource[] {
  const ids = new Set<string>();
  for (const d of plan.decisions) {
    if (d.action !== 'use') {
      continue;
    }
    const tool = PLANNER_TOOLS.find((t) => t.id === d.id);
    for (const kid of tool?.knowledgeIds ?? []) {
      ids.add(kid);
    }
  }
  return [...ids].map((id) => getDesignSource(id)).filter(Boolean) as DesignSource[];
}

/**
 * Prompt block injected into Qwen Agent: must ask unanswered questions first,
 * then execute enabled design tools with concrete install/usage rules.
 */
export function formatDesignPlanForAgent(plan: DesignSourcePlan, knowledgeBlock: string): string {
  const lines: string[] = [
    'Singularity Design Source Plan (mandatory)',
    '────────────────────────────────────────',
    'You own FRONTEND only. Design sources are either USE, ASK, or SKIP — nothing may be ignored.',
    '',
    FRONTEND_TASTE_RULES,
    '',
    'HARD EXECUTION RULES (never violate):',
    '- Framework projects (Next/React/Vite): write real files via tools — never dump a static index.html SPA in chat.',
    '- One todo at a time with file writes before marking complete.',
    '- Before any landing/marketing file writes: put Art Direction (metaphor, palette, type, hero visual) at the top of todo.md.',
    '',
    'PERSISTENT TODO + STEERING (mandatory for multi-step builds — any specialty):',
    '1. Create workspace-root `todo.md` with goal, Art Direction, stack, and `- [ ]` / `- [x]` tasks + details (frontend/backend/infra/tests as needed).',
    '2. Register steering: `.github/instructions/todo.instructions.md` (`applyTo: "**"`) pointing at `todo.md`,',
    '   and a short pointer in root `AGENTS.md`.',
    '3. Keep `manage_todo_list` synced; after each finish flip checkbox in `todo.md` then mark the UI todo done.',
    '4. Always re-read `todo.md` before the next task.',
    '',
    'Status:',
  ];

  for (const d of plan.decisions) {
    lines.push(`- [${d.action.toUpperCase()}] ${d.name} — ${d.bestUsedFor} (${d.reason})`);
  }

  if (plan.questions.length) {
    lines.push(
      '',
      'BEFORE any create_file / edit / install: call #tool:vscode_askQuestions (or vscode_askQuestions) once with ALL of these questions (Yes/No options). Do not write app code until answers are collected.',
      'Questions:',
    );
    for (const q of plan.questions) {
      lines.push(`- id=${q.id}: ${q.question}`);
    }
  } else {
    lines.push('', 'No pending design questions — proceed to implement with the USE sources below.');
  }

  lines.push('', 'When implementing USE sources, you MUST actually apply them (deps + code), not only mention them:');

  for (const d of plan.decisions.filter((x) => x.action === 'use')) {
    lines.push(...usageRulesFor(d.id));
  }

  if (knowledgeBlock.trim()) {
    lines.push('', 'Retrieved Design Knowledge for active sources:', knowledgeBlock);
  }

  lines.push(
    '',
    'Before finishing a branded/landing page, self-check:',
    ...FRONTEND_ACCEPTANCE_CHECKS.map((c) => `- [ ] ${c}`),
  );

  return lines.join('\n');
}

function usageRulesFor(id: PlannerToolId): string[] {
  switch (id) {
    case 'react-bits':
      return [
        '',
        '### React Bits (EXECUTE — Singularity default)',
        '- Install real components via shadcn CLI, prefer TS-TW:',
        '  `npx shadcn@latest add @react-bits/<Component>-TS-TW`',
        '- Docs/repo: https://reactbits.dev · https://github.com/DavidHDev/react-bits',
        '- Use for text animations, backgrounds, docks, cards — actually install, do not restyle from memory',
        '- One atmosphere background max; gate motion with `prefers-reduced-motion`',
        '- Restyle to Design Spec tokens; never copy purple→indigo demo identity',
      ];
    case 'godui':
      return [
        '',
        '### GodUI (EXECUTE — Singularity default)',
        '- Prefer GodUI MCP (`godui` / `@godui/mcp`) to browse + install components and animated icons',
        '- Fallback: `npx shadcn@latest add "https://godui.design/r/<component>.json"`',
        '- Docs: https://godui.design — buttons, overlays, nav, AI surfaces, glass, backgrounds, animated icons',
        '- Install owned source into the project; restyle to Design Spec CSS variables',
        '- Motion budget: transform/opacity only; 2–3 intentional motions per surface',
        '- If GodUI MCP is missing, tell the user to add it to mcp.json (npx -y @godui/mcp@latest) then continue via CLI',
      ];
    case 'threejs':
      return [
        '',
        '### Three.js (EXECUTE — only when USE)',
        '- Install: `three`, `@types/three`, `@react-three/fiber`, `@react-three/drei`',
        '- Scene MUST encode the product metaphor (topology, routing, device, …) — NEVER MeshDistortMaterial / floating orb / bokeh wallpaper',
        '- If a custom SVG/diagram or React Bits background tells the product story better, prefer that',
        '- Lazy-load `<Canvas>`; gate with `prefers-reduced-motion` + 2D fallback; dispose on unmount',
      ];
    case 'heroui-nextui':
      return [
        '',
        '### HeroUI / NextUI (EXECUTE)',
        '- Prefer `@heroui/react` patterns for SaaS shells (nav, buttons, inputs, cards)',
        '- Or map the same patterns onto shadcn / GodUI if HeroUI install is blocked — but keep SaaS shell quality',
        '- App/marketing chrome: clear nav, max-width ~1280px, consistent radius',
      ];
    case 'shadcn':
      return [
        '',
        '### shadcn/ui (EXECUTE)',
        '- Create `components/ui/*` primitives (button, input, card, dialog) with `cn()` helper',
        '- Use CSS variables for theme tokens; GodUI / React Bits compose on top of these primitives',
      ];
    case 'website-cloner':
      return [
        '',
        '### Website Cloner (EXECUTE — like+URL)',
        '- BLOCKING: invoke the `skill` tool with name `clone-website` before coding the UI',
        '- Template/workflow: https://github.com/JCodesMore/ai-website-cloner-template',
        '- Recon the reference URL(s) with screenshot_page / read_page / fetch_webpage',
        '- Write `docs/research/reference-digest.md` (tokens, sections, interaction model)',
        '- Then build the USER product matching craft (not phishing/impersonation) with Design Spec + React Bits + GodUI',
      ];
    case 'radix':
      return [
        '',
        '### Radix (EXECUTE)',
        '- Use `@radix-ui/react-*` under shadcn wrappers for dialogs/dropdowns/tabs',
        '- Keyboard + aria behavior required for overlays',
      ];
    case 'tremor':
      return [
        '',
        '### Tremor (EXECUTE)',
        '- Install Tremor (or `@tremor/react`) for KPI/chart sections when dashboards are in scope',
        '- KPI row → chart → table hierarchy; not in marketing hero',
      ];
    case 'aceternity':
      return [
        '',
        '### Aceternity-style effects (EXECUTE)',
        '- Use at most one atmosphere effect that supports the chosen art direction — not blue→purple glow as the brand',
        '- Prefer React Bits when an equivalent exists',
        '- Respect reduced motion; do not plaster glow on every card',
      ];
    case 'magic-ui':
      return [
        '',
        '### Magic UI motion (EXECUTE)',
        '- Prefer GodUI / React Bits equivalents when available',
        '- Add 2–3 intentional motions only; prefer CSS/Motion over canvas',
      ];
    case 'tailwind-patterns':
      return [
        '',
        '### Tailwind layout patterns (EXECUTE)',
        '- Mobile-first; `max-w-7xl` content; one composition above the fold',
        '- Section rhythm: headline + one sentence + primary content',
      ];
    case 'mantine':
      return [
        '',
        '### Mantine (EXECUTE)',
        '- Only when active: install `@mantine/core` (+ hooks) and use Mantine theme consistently',
        '- Do not mix Mantine + shadcn/GodUI in the same view without a clear split',
      ];
    default:
      return [];
  }
}

/** Nemotron system prompt for design-source selection. */
export const DESIGN_SOURCE_PLANNER_SYSTEM = `You plan which frontend Design Knowledge tools to activate.

You have exactly these ${PLANNER_TOOLS.length} tools:
${PLANNER_TOOLS.map((t) => `- ${t.id}: ${t.name} — ${t.bestUsedFor}`).join('\n')}

For EACH tool return action:
- "use" — enable now without asking
- "ask" — must confirm with the user (Yes/No)
- "skip" — not relevant

Rules:
- Nothing may be omitted from the JSON array (all ${PLANNER_TOOLS.length} ids required).
- react-bits and godui MUST be "use" for any frontend / UI / React / landing / website / dashboard task (Singularity defaults).
- website-cloner MUST be "use" when the user says "something like" / "inspired by" / "similar to" / "take reference from" / "clone" / "rebuild" plus a URL; otherwise "skip".
- SaaS / app-shell / dashboard product UI → heroui-nextui MUST be "use".
- threejs "use" ONLY if user explicitly wants 3D/Three.js/WebGL/R3F; otherwise "skip" (do NOT ask — asking trains decorative MeshDistort heroes).
- aceternity / magic-ui: "skip" unless the user explicitly names them — React Bits + GodUI already cover motion/effects.
- Marketing landings: tailwind-patterns "use"; react-bits + godui "use".
- Prefer shadcn+radix "use" for component/form UIs under GodUI.
- Mantine "use" only if explicitly wanted; else "skip".
- Prefer product-specific SVG/diagram heroes; use React Bits/GodUI to elevate craft — not as art directors.
- Max mindset: ask only when unsure; auto-use strong matches; never enable stack theater.

Reply with JSON only:
{"sources":[{"id":"react-bits","action":"use","reason":"..."}, ... all ${PLANNER_TOOLS.length} ...]}`;

/** Catalog lines for prompts. */
export function formatPlannerCatalog(): string {
  return PLANNER_TOOLS.map((t) => `${t.name}\t${t.bestUsedFor}`).join('\n');
}

// Re-export helper used by formatDesignPlanForAgent callers that already have sources
export function knowledgeBlockForPlan(plan: DesignSourcePlan, query: string): string {
  const sources = resolveActiveDesignSources(plan);
  if (!sources.length) {
    // Still pull curated docs for ask-pending threejs? No — only active.
    // If only asks pending, include minimal catalog.
    return [
      'Design Knowledge catalog (pending user confirms):',
      ...PLANNER_TOOLS.map((t) => `- ${t.name}: ${t.bestUsedFor}`),
    ].join('\n');
  }
  const { block } = retrieveDesignKnowledgeForSources(
    sources.map((s) => s.id),
    { query, maxChars: 12_000 },
  );
  return block;
}

// Ensure DESIGN_SOURCES referenced for tree-shaking friendliness in tests
void DESIGN_SOURCES;
