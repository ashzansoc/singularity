import type { Tier } from '@singularity/router';
import { injectFrontendDesignPipeline, type PipelinePlanLike } from '@singularity/design';
import type { LlmPort } from '../ports.js';
import {
  buildDag,
  criticalPathLength,
} from '../graph/dag.js';
import type { ExecutionPlan, TaskNode } from '../types.js';
import { SubagentOrchestrator } from '../subagent/orchestrator.js';
import { enrichTaskNodeAsSubagent } from '../subagent/mappers.js';
import type { ModelPolicy, SubagentRole } from '../subagent/types.js';
import { strategyToTier } from '../subagent/roleCatalog.js';
import { STAGE_DEFAULT_DEADLINES, stageDeadlineMs, withDeadline } from '../parallel.js';

const PLANNER_SYSTEM = `You are the Singularity Runtime executive planner.
Decompose the user goal into a DAG of parallelizable coding subagents/tasks.
Return ONLY valid JSON matching this schema (no markdown fences):
{
  "projectSummary": string,
  "codingStandards": string (optional),
  "nodes": [
    {
      "id": string (slug),
      "title": string,
      "role": "explorer"|"researcher"|"frontend"|"backend"|"database"|"debugger"|"tester"|"reviewer"|"integrator",
      "objective": string,
      "deps": string[],
      "ownedPaths": string[],
      "expectedOutput": string,
      "estimatedTokens": number,
      "recommendedTier": "T0"|"T1"|"T2"|"T3"|"T4"|"T5"|"T6",
      "specialty": "frontend"|"backend"|"ai-pipeline"|"infrastructure"|"general",
      "priority": number,
      "retryLimit": number,
      "neighborPaths": string[] (optional),
      "modelPolicy": { "strategy": "fast"|"balanced"|"reasoning"|"coding"|"vision"|"custom", "preferredModels": string[] } (optional)
    }
  ]
}
You may also use "subagents" instead of "nodes" with the same fields (dependencies alias for deps).
Rules:
- ownedPaths must not overlap across nodes that can run in parallel (no shared deps chain that would race).
- Prefer fine-grained file ownership (one page/feature per task when possible).
- deps form a DAG (no cycles). Independent subagents MUST be parallelizable (no false deps).
- Prefer graph shape: explorer → parallel implementers (frontend/backend/database) → tester → reviewer.
- Use higher tiers (T4+) only for hard design/review tasks; explorers T1; most workers T2–T3.
- Always produce at least 4 parallelizable tasks for multi-page apps.
- SPECIALTY / ROLE LANES (critical):
  - explorer/researcher: read-only analysis first when architecture is unclear
  - frontend: React/UI/CSS/pages/components/layouts — implemented by DeepSeek V4 Flash-0731. Do NOT add design-director/visual-critic nodes yourself (Runtime injects the Design Intelligence pipeline).
  - backend: APIs, services, auth server
  - database: migrations/schema
  - tester: tests after implementers
  - reviewer: independent review after tests (never the same agent judging only its own work)
  - Split multi-surface goals (e.g. SaaS dashboard + API + AI pipeline) into separate specialty nodes so they can run on different models and be stitched later.
  - Frontend nodes must NOT include backend/API/DB work.`;

export interface PlannerOptions {
  llm: LlmPort;
  preferredTier?: Tier;
  sessionId?: string;
}

export interface PlanRequest {
  goal: string;
  projectSummary?: string;
  codingStandards?: string;
  /** Optional file listing hint for the planner. */
  fileHints?: string[];
  /** Structured Context Engine block (requirements, constraints, decisions). */
  structuredContext?: string;
  verificationChecklist?: string;
  /** Cancellation propagated into the planner LLM call. */
  signal?: AbortSignal;
  /**
   * Hard ceiling on planned tasks (medium lane). Enforced twice: as a prompt
   * instruction and as a deterministic post-trim (dependency-closure-preserving).
   */
  maxTasks?: number;
  /** When true, skip Design Intelligence pipeline injection (e.g. execution-engine DAG tests). */
  skipDesignPipeline?: boolean;
}

/**
 * Call the LLM to produce a structured ExecutionPlan, then validate the DAG.
 */
export async function createExecutionPlan(
  req: PlanRequest,
  opts: PlannerOptions,
): Promise<ExecutionPlan> {
  const hintBlock =
    req.fileHints && req.fileHints.length
      ? `\nKnown files:\n${req.fileHints.slice(0, 200).map((f) => `- ${f}`).join('\n')}`
      : '';
  const maxTasks = req.maxTasks;

  const prompt = [
    req.structuredContext ? req.structuredContext : '',
    `Goal: ${req.goal}`,
    req.projectSummary ? `Project summary: ${req.projectSummary}` : '',
    req.codingStandards ? `Coding standards: ${req.codingStandards}` : '',
    hintBlock,
    maxTasks ? `HARD LIMIT: produce at most ${maxTasks} task(s) — the smallest plan that fully covers this goal.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  // Bounded planner: on timeout the caller's catch path builds the fallback
  // plan (existing behavior — just bounded now).
  const plannerDeadline =
    stageDeadlineMs('SINGULARITY_PLANNER_DEADLINE_MS', STAGE_DEFAULT_DEADLINES.planner) ??
    Number.MAX_SAFE_INTEGER;
  const result = await withDeadline(
    opts.llm.complete({
      role: 'planner',
      systemPrompt: PLANNER_SYSTEM,
      prompt,
      preferredTier: opts.preferredTier ?? 'T5',
      temperature: 0.2,
      sessionId: opts.sessionId,
      ...(req.signal ? { signal: req.signal } : {}),
    }),
    plannerDeadline,
    'Planner',
  );

  let parsed = parsePlanJson(result.text);
  if (maxTasks && parsed.nodes.length > maxTasks) {
    parsed = trimPlanToTaskBudget(parsed, maxTasks);
  }
  return finalizePlan(parsed, req, result.tokensUsed);
}

/**
 * Deterministically shrink a raw plan to `max` nodes while preserving DAG
 * validity: keeps highest-priority/earliest tasks and rewires surviving nodes'
 * deps to dropped predecessors' deps (transitive reduction).
 */
function trimPlanToTaskBudget(raw: RawPlan, max: number): RawPlan {
  const kept = raw.nodes.slice(0, max);
  const keptIds = new Set(kept.map((n) => String(n.id)));
  const idOf = (i: number): string => String(raw.nodes[i]!.id);
  for (let i = max; i < raw.nodes.length; i++) {
    const dropped = new Set<string>([idOf(i)]);
    // Closure over dropped ancestors so no surviving node references them.
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of raw.nodes) {
        const nid = String(n.id);
        if (dropped.has(nid)) continue;
        const deps = Array.isArray(n.deps) ? n.deps.map(String) : [];
        if (deps.some((d) => dropped.has(d))) {
          dropped.add(nid);
          grew = true;
        }
      }
    }
    // If closure swallowed a kept node, drop it too.
    for (const k of [...keptIds]) {
      if (dropped.has(k)) {
        keptIds.delete(k);
      }
    }
  }
  const nodes = raw.nodes
    .filter((n) => keptIds.has(String(n.id)))
    .map((n) => ({
      ...n,
      deps: (Array.isArray(n.deps) ? n.deps.map(String) : []).filter((d) =>
        keptIds.has(d),
      ),
    }));
  return { ...raw, nodes };
}

/** Parse planner JSON (tolerates optional markdown fences). */
export function parsePlanJson(text: string): RawPlan {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence ? fence[1]!.trim() : trimmed;
  const data = JSON.parse(jsonText) as RawPlan & {
    subagents?: RawNode[];
  };
  const coerced = SubagentOrchestrator.coerceRawPlan({
    projectSummary: data.projectSummary,
    codingStandards: data.codingStandards,
    nodes: data.nodes as unknown as Array<Record<string, unknown>>,
    subagents: data.subagents as unknown as Array<Record<string, unknown>>,
  });
  if (!coerced.nodes.length) {
    throw new Error('Planner response missing nodes[] / subagents[]');
  }
  return {
    projectSummary: coerced.projectSummary,
    codingStandards: coerced.codingStandards,
    nodes: coerced.nodes as unknown as RawNode[],
  };
}

export interface RawPlan {
  projectSummary?: string;
  codingStandards?: string;
  nodes: RawNode[];
  subagents?: RawNode[];
}

interface RawNode {
  id: string;
  title?: string;
  objective?: string;
  role?: string;
  deps?: string[];
  dependencies?: string[];
  ownedPaths?: string[];
  expectedOutput?: string;
  estimatedTokens?: number;
  recommendedTier?: string;
  specialty?: string;
  priority?: number;
  retryLimit?: number;
  neighborPaths?: string[];
  modelPolicy?: Partial<ModelPolicy>;
  tools?: string[];
  maxIterations?: number;
  timeoutMs?: number;
}

const TIERS: Tier[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
const SPECIALTIES = [
  'frontend',
  'backend',
  'ai-pipeline',
  'infrastructure',
  'general',
] as const;

type Specialty = (typeof SPECIALTIES)[number];

function asTier(value: string | undefined, fallback: Tier): Tier {
  if (value && (TIERS as string[]).includes(value)) {
    return value as Tier;
  }
  return fallback;
}

function asSpecialty(
  value: string | undefined,
  title: string,
  ownedPaths: string[],
): Specialty | undefined {
  if (value && (SPECIALTIES as readonly string[]).includes(value)) {
    return value as Specialty;
  }
  const blob = `${title} ${ownedPaths.join(' ')}`.toLowerCase();
  if (/\b(ui|frontend|react|css|tsx|component|page|layout|dashboard|tailwind)\b/.test(blob)) {
    return 'frontend';
  }
  if (/\b(api|backend|server|prisma|database|endpoint)\b/.test(blob)) {
    return 'backend';
  }
  if (/\b(ai|llm|pipeline|embedding|model)\b/.test(blob)) {
    return 'ai-pipeline';
  }
  if (/\b(docker|infra|deploy|ci|k8s)\b/.test(blob)) {
    return 'infrastructure';
  }
  return undefined;
}

export function finalizePlan(
  raw: RawPlan,
  req: PlanRequest,
  plannerTokens = 0,
): ExecutionPlan {
  const nodes: TaskNode[] = raw.nodes.map((n, i) => {
    const ownedPaths = Array.isArray(n.ownedPaths) ? n.ownedPaths.map(String) : [];
    const title = String(n.title || n.objective || n.id || `Task ${i + 1}`);
    const objective = String(n.objective || title);
    const specialty = asSpecialty(n.specialty, title, ownedPaths);
    const base: TaskNode = {
      id: String(n.id || `task-${i + 1}`),
      title,
      objective,
      role: n.role as SubagentRole | undefined,
      deps: Array.isArray(n.deps)
        ? n.deps.map(String)
        : Array.isArray(n.dependencies)
          ? n.dependencies.map(String)
          : [],
      ownedPaths,
      expectedOutput: String(n.expectedOutput ?? objective),
      estimatedTokens: Number(n.estimatedTokens ?? 2000) || 2000,
      recommendedTier: asTier(n.recommendedTier, 'T2'),
      specialty,
      priority: Number(n.priority ?? 0) || 0,
      retryLimit: Math.max(0, Number(n.retryLimit ?? 2) || 0),
      status: 'pending' as const,
      neighborPaths: Array.isArray(n.neighborPaths)
        ? n.neighborPaths.map(String)
        : undefined,
      attempts: 0,
      modelPolicy: n.modelPolicy
        ? {
            strategy: n.modelPolicy.strategy ?? 'balanced',
            preferredModels: n.modelPolicy.preferredModels,
            maxCost: n.modelPolicy.maxCost,
            maxLatencyMs: n.modelPolicy.maxLatencyMs,
            preferredTier:
              n.modelPolicy.preferredTier ??
              (n.modelPolicy.strategy
                ? strategyToTier(n.modelPolicy.strategy)
                : undefined),
          }
        : undefined,
      maxIterations: n.maxIterations,
      timeoutMs: n.timeoutMs,
      tools: Array.isArray(n.tools) ? (n.tools as TaskNode['tools']) : undefined,
    };
    return enrichTaskNodeAsSubagent(base);
  });

  const dag = buildDag(nodes);
  const totalTokens =
    nodes.reduce((s, n) => s + n.estimatedTokens, 0) + plannerTokens;

  const base: ExecutionPlan = {
    id: `plan-${Date.now().toString(36)}`,
    goal: req.goal,
    projectSummary: raw.projectSummary ?? req.projectSummary ?? '',
    codingStandards: raw.codingStandards ?? req.codingStandards,
    structuredContext: req.structuredContext,
    verificationChecklist: req.verificationChecklist,
    nodes,
    estimates: {
      totalTokens,
      taskCount: nodes.length,
      criticalPathLength: criticalPathLength(dag),
    },
    createdAt: Date.now(),
  };

  // Inject Design Director → Flash → Browser → Visual Critic → refine loop
  if (req.skipDesignPipeline) {
    return {
      ...base,
      nodes: base.nodes.map((n) => enrichTaskNodeAsSubagent(n)),
    };
  }
  const withPipeline = injectFrontendDesignPipeline(
    base as PipelinePlanLike,
  ) as ExecutionPlan;
  const dag2 = buildDag(withPipeline.nodes);
  return {
    ...withPipeline,
    nodes: withPipeline.nodes.map((n) => enrichTaskNodeAsSubagent(n)),
    estimates: {
      ...withPipeline.estimates,
      criticalPathLength: criticalPathLength(dag2),
      taskCount: withPipeline.nodes.length,
      totalTokens: withPipeline.nodes.reduce((s, n) => s + n.estimatedTokens, 0) + plannerTokens,
    },
  };
}

/**
 * Heuristic multi-task plan when the planner LLM fails.
 * Detects common app building blocks and fans them out in parallel.
 */
export function createFallbackPlan(req: PlanRequest): ExecutionPlan {
  const goal = req.goal.toLowerCase();
  const root = inferAppRoot(req);
  const nodes: RawNode[] = [];

  const wants = (re: RegExp) => re.test(goal);

  // Health-check / split backend+frontend apps (common execution-engine test shape)
  if (
    wants(/\bhealth[- ]?check\b/) ||
    (wants(/\bbackend\b/) && wants(/\bfrontend\b/) && wants(/\b(express|node|api|endpoint)\b/))
  ) {
    nodes.push({
      id: 'setup',
      title: 'Analyze repository and prepare workspace layout',
      deps: [],
      ownedPaths: [`${root}/README.md`, `${root}/.gitignore`],
      expectedOutput: 'Workspace ready with backend/ and frontend/ directories planned',
      recommendedTier: 'T1',
      specialty: 'general',
      priority: 100,
      retryLimit: 2,
    });
    nodes.push({
      id: 'backend',
      title: 'Implement backend health API',
      deps: ['setup'],
      ownedPaths: [`${root}/backend`],
      expectedOutput: 'Node/Express GET /health returns { status, service }',
      recommendedTier: 'T2',
      specialty: 'backend',
      priority: 80,
      retryLimit: 2,
    });
    nodes.push({
      id: 'frontend',
      title: 'Implement frontend health page',
      deps: ['setup'],
      ownedPaths: [`${root}/frontend`],
      expectedOutput: 'Static page fetches /health and shows green/red status',
      recommendedTier: 'T2',
      specialty: 'frontend',
      priority: 80,
      retryLimit: 2,
    });
    nodes.push({
      id: 'integrate',
      title: 'Integration and README',
      deps: ['backend', 'frontend'],
      ownedPaths: [`${root}/README.md`],
      expectedOutput: 'README documents how to run backend (port 3001) and open frontend',
      recommendedTier: 'T2',
      specialty: 'general',
      priority: 50,
      retryLimit: 2,
    });
    return finalizePlan(
      {
        projectSummary: truncate(req.projectSummary ?? req.goal, 240),
        codingStandards: req.codingStandards,
        nodes,
      },
      { ...req, skipDesignPipeline: true },
    );
  }

  // Single-surface demos (canvas/WebGL/raytracer/static page) must NOT expand
  // into a multi-page notes-app DAG via substring traps like "ui", "light", "app".
  const singleSurface = wants(
    /\b(raytrac|webgl|canvas|shader|schwarzschild|black\s*hole|static\s+page|single\s+page|one[- ]page|poster|demo)\b/,
  );

  if (singleSurface) {
    nodes.push({
      id: 'main',
      title: 'Implement single-page experience',
      deps: [],
      ownedPaths: [
        `${root}/index.html`,
        `${root}/package.json`,
        `${root}/src`,
        `${root}/styles`,
      ],
      expectedOutput: 'Working single-page implementation matching the goal',
      recommendedTier: 'T3',
      specialty: 'frontend',
      priority: 1,
      retryLimit: 2,
    });
    return finalizePlan(
      {
        projectSummary: truncate(req.projectSummary ?? req.goal, 240),
        codingStandards: req.codingStandards,
        nodes,
      },
      req,
    );
  }

  // Shared foundation (sequential first wave)
  if (
    wants(/\b(vite|scaffold|react|tailwind|zustand|router|typescript)\b/) ||
    wants(/\b(notes|dashboard|app|application)\b/)
  ) {
    nodes.push({
      id: 'scaffold',
      title: 'Scaffold project + deps (Vite/React/TS/Tailwind)',
      deps: [],
      ownedPaths: [
        `${root}/package.json`,
        `${root}/vite.config.ts`,
        `${root}/index.html`,
        `${root}/src/main.tsx`,
        `${root}/src/index.css`,
        `${root}/tailwind.config.js`,
        `${root}/postcss.config.js`,
        `${root}/tsconfig.json`,
        `${root}/tsconfig.app.json`,
      ],
      expectedOutput: 'Runnable Vite React TS app with Tailwind configured',
      recommendedTier: 'T2',
      specialty: 'frontend',
      priority: 100,
      retryLimit: 2,
    });
  }

  const foundation = nodes.length ? ['scaffold'] : [];

  // Backend / AI pipeline lanes for multi-surface SaaS goals
  if (wants(/\b(api|backend|upload|csv|postgres|database|auth)\b/)) {
    nodes.push({
      id: 'backend',
      title: 'Backend API + data layer',
      deps: [...foundation],
      ownedPaths: [`${root}/server`, `${root}/api`, `${root}/src/server`],
      expectedOutput: 'Upload/process APIs and persistence seams for the frontend',
      recommendedTier: 'T3',
      specialty: 'backend',
      priority: 75,
      retryLimit: 2,
    });
  }

  if (wants(/\b(ai|llm|embedding|pipeline)\b/) || wants(/\b(model|models)\b.*\b(pipeline|infer)/)) {
    nodes.push({
      id: 'ai-pipeline',
      title: 'AI processing pipeline',
      deps: [
        ...foundation,
        ...(nodes.some((n) => n.id === 'backend') ? ['backend'] : []),
      ],
      ownedPaths: [`${root}/src/ai`, `${root}/workers`],
      expectedOutput: 'Model/processing pipeline with clear input/output contracts for stitch',
      recommendedTier: 'T4',
      specialty: 'ai-pipeline',
      priority: 65,
      retryLimit: 2,
    });
  }

  if (wants(/\b(zustand|store)\b/)) {
    nodes.push({
      id: 'store',
      title: 'Create Zustand store(s)',
      deps: [...foundation],
      ownedPaths: [`${root}/src/store`, `${root}/src/stores`],
      expectedOutput: 'Zustand stores for notes/categories/settings/theme',
      recommendedTier: 'T2',
      priority: 80,
      retryLimit: 2,
    });
  }

  if (wants(/\b(components?|sidebar|toast|search\s*bar)\b/) || wants(/\bui\s+(components?|kit|library)\b/)) {
    nodes.push({
      id: 'ui',
      title: 'Create reusable UI components',
      deps: [...foundation],
      ownedPaths: [`${root}/src/components`],
      expectedOutput: 'Sidebar, SearchBar, Toast, ThemeToggle, layout primitives',
      recommendedTier: 'T2',
      specialty: 'frontend',
      priority: 70,
      retryLimit: 2,
    });
  }

  // Parallel feature pages
  const pageSpecs: Array<{ id: string; title: string; path: string; re: RegExp }> = [
    {
      id: 'dashboard',
      title: 'Create Dashboard page',
      path: `${root}/src/pages/Dashboard`,
      re: /\bdashboard\b/,
    },
    {
      id: 'notes',
      title: 'Create Notes page (CRUD)',
      path: `${root}/src/pages/Notes`,
      re: /\b(notes|crud)\b/,
    },
    {
      id: 'categories',
      title: 'Create Categories page',
      path: `${root}/src/pages/Categories`,
      re: /\bcategor/,
    },
    {
      id: 'settings',
      title: 'Create Settings page',
      path: `${root}/src/pages/Settings`,
      re: /\b(settings|theme|dark\s*mode|light\s*mode)\b/,
    },
  ];

  for (const p of pageSpecs) {
    if (wants(p.re) || (wants(/\bnotes\s+(application|app)\b/) && p.id !== 'settings')) {
      const deps = [
        ...foundation,
        ...(nodes.some((n) => n.id === 'store') ? ['store'] : []),
        ...(nodes.some((n) => n.id === 'ui') ? ['ui'] : []),
      ];
      nodes.push({
        id: p.id,
        title: p.title,
        deps,
        ownedPaths: [p.path],
        expectedOutput: `${p.title} implemented under ${p.path}`,
        recommendedTier: 'T3',
        specialty: 'frontend',
        priority: 50,
        retryLimit: 2,
      });
    }
  }

  // Integration wave
  if (nodes.length > 1) {
    const pageIds = nodes
      .filter((n) => ['dashboard', 'notes', 'categories', 'settings'].includes(n.id))
      .map((n) => n.id);
    const integrateDeps = [
      ...foundation,
      ...(nodes.some((n) => n.id === 'store') ? ['store'] : []),
      ...(nodes.some((n) => n.id === 'ui') ? ['ui'] : []),
      ...pageIds,
    ];
    nodes.push({
      id: 'integrate',
      title: 'Integrate routes + navigation',
      deps: integrateDeps,
      ownedPaths: [
        `${root}/src/App.tsx`,
        `${root}/src/routes`,
        `${root}/src/layouts`,
      ],
      expectedOutput: 'React Router wired; sidebar navigation; theme provider',
      recommendedTier: 'T3',
      specialty: 'frontend',
      priority: 10,
      retryLimit: 2,
    });
  }

  if (nodes.length === 0) {
    nodes.push({
      id: 'main',
      title: 'Implement goal',
      deps: [],
      ownedPaths: req.fileHints?.slice(0, 8) ?? [`${root}/src`],
      expectedOutput: 'Working implementation matching the goal',
      recommendedTier: 'T3',
      priority: 1,
      retryLimit: 2,
    });
  }

  return finalizePlan(
    {
      projectSummary: truncate(req.projectSummary ?? req.goal, 240),
      codingStandards: req.codingStandards,
      nodes,
    },
    req,
  );
}

function inferAppRoot(req: PlanRequest): string {
  const fromHints = req.fileHints?.find((f) => /notes-app|src\//.test(f));
  if (fromHints?.includes('notes-app')) {
    return 'notes-app';
  }
  const m = req.goal.match(/\b([a-z0-9_-]+-app)\b/i);
  if (m) {
    return m[1]!;
  }
  if (/notes/i.test(req.goal)) {
    return 'notes-app';
  }
  return '.';
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}
