import {
  FRONTEND_OWNER_MODEL_ID,
  DESIGN_DIRECTOR_MODEL_ID,
  VISUAL_CRITIC_MODEL_ID,
  buildFrontendContext,
  extractDnaSignalsFromFiles,
  inferSpecialtyFromPaths,
  loadDesignDna,
  mergeDesignDna,
  saveDesignDna,
  designSpecToDnaNotes,
  runDesignDirector,
  saveDesignSpec,
  loadDesignSpec,
  runVisualCritic,
  formatDesignSpecForPrompt,
  StubBrowserPort,
  createBrowserPort,
  inferPreviewUrl,
  DEFAULT_VISUAL_VIEWPORTS,
  type BrowserPort,
  type DesignSpecification,
  type VisualCriticVerdict,
  designDirectorMayWritePath,
  isDesignDirectorSpecialty,
  isDesignConfirmSpecialty,
  isVisualCriticSpecialty,
  isFrontendImplementSpecialty,
  markDesignPreviewStatus,
  loadDesignPreviewGate,
  isDesignCodingUnlocked,
  DEFAULT_PENPOT_URL,
  classifyAgencyAgent,
  requireAgencySkill,
  agencySkillToArtifact,
  saveSkillArtifact,
  loadSkillArtifactAsync,
  formatAgencySkillForPrompt,
} from '@singularity/design';
import type { ContextBus } from '../bus/contextBus.js';
import type { DesignPreviewGatePort, LlmPort, ToolPort, WorkspacePort } from '../ports.js';
import { normalizePath } from '../ports.js';
import { PARALLEL_IO_LIMIT, parallelLimit } from '../parallel.js';
import type {
  BusEvent,
  DiffHunk,
  ExecutionPlan,
  RuntimeEvent,
  TaskNode,
  WorkerResult,
} from '../types.js';
import { runSubagentLoop } from '../subagent/agentLoop.js';
import type { SubagentDependencyRequest } from '../subagent/types.js';
import { resolveModelRouting } from '../subagent/modelPolicy.js';
import { enrichTaskNodeAsSubagent } from '../subagent/mappers.js';

const WORKER_SYSTEM = `You are a Singularity Runtime worker.
Edit ONLY files listed under Owned paths. Return ONLY JSON (no markdown):
{
  "diffs": [
    {
      "path": string,
      "unifiedDiff": string,
      "newContent": string (optional full file body),
      "isNew": boolean (optional)
    }
  ],
  "busEvents": [
    { "kind": "CreatedFile"|"ModifiedInterface"|"ModifiedExport"|"ChangeRequest"|"TaskSummary"|"Custom", "message": string, "path": string (optional) }
  ],
  "changeRequests": string[] (paths outside ownership you need changed)
}
Prefer newContent for full-file writes. Never invent edits outside owned paths.`;

export interface WorkerContext {
  llm: LlmPort;
  workspace: WorkspacePort;
  bus: ContextBus;
  plan: ExecutionPlan;
  modelId?: string;
  sessionId?: string;
  /** Workspace root for Design DNA / Design Spec persistence. */
  workspaceRoot?: string;
  /** Optional browser capture for visual QA. */
  browser?: BrowserPort;
  /** Preview URL override for visual capture. */
  previewUrl?: string;
  /** Human gate: Penpot / Spec board confirmation before coding. */
  designPreviewGate?: DesignPreviewGatePort;
  /** Optional ToolPort for subagent loop / verification. */
  tools?: ToolPort;
  onEvent?: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
  /** Prefer bounded multi-iteration loop when role is set (default true). */
  enableSubagentLoop?: boolean;
  onDependencyRequest?: (
    req: SubagentDependencyRequest,
    parent: TaskNode,
  ) => Promise<boolean>;
  shellExec?: (command: string) => Promise<{ ok: boolean; output: string }>;
  onContextRequest?: (req: {
    requested_files: string[];
    reason: string;
  }) => Promise<string | undefined>;
}

export interface WorkerJsonPayload {
  diffs?: Array<{
    path: string;
    unifiedDiff?: string;
    newContent?: string;
    isNew?: boolean;
  }>;
  busEvents?: Array<{
    kind?: string;
    message?: string;
    path?: string;
    payload?: Record<string, unknown>;
  }>;
  changeRequests?: string[];
}

/**
 * Execute a single task with scoped context and ownership enforcement.
 */
export async function runWorkerTask(
  task: TaskNode,
  ctx: WorkerContext,
): Promise<WorkerResult> {
  const specialty =
    task.specialty ??
    inferSpecialtyFromPaths(task.ownedPaths) ??
    'general';

  if (isDesignDirectorSpecialty(specialty)) {
    return runDesignDirectorTask(task, ctx);
  }
  if (isDesignConfirmSpecialty(specialty)) {
    return runDesignConfirmTask(task, ctx);
  }
  if (specialty === 'visual-capture') {
    return runVisualCaptureTask(task, ctx);
  }
  if (isVisualCriticSpecialty(specialty)) {
    return runVisualCriticTask(task, ctx);
  }
  if (isFrontendImplementSpecialty(specialty)) {
    return runFrontendImplementTask(task, ctx, specialty);
  }

  const enriched = enrichTaskNodeAsSubagent(task);
  // Only use the multi-iteration loop when the caller set an explicit role
  // (orchestrator/planner). Legacy TaskNodes without role stay single-shot.
  const useLoop =
    ctx.enableSubagentLoop !== false &&
    Boolean(task.role) &&
    !isDesignPipelineSpecialty(specialty);

  if (useLoop) {
    const routing = resolveModelRouting(enriched.modelPolicy);
    return runSubagentLoop(enriched, {
      llm: ctx.llm,
      workspace: ctx.workspace,
      tools: ctx.tools,
      bus: ctx.bus,
      plan: ctx.plan,
      modelId: ctx.modelId ?? routing.modelId ?? enriched.preferredModelId,
      sessionId: ctx.sessionId,
      onEvent: ctx.onEvent,
      signal: ctx.signal,
      shellExec: ctx.shellExec,
      onDependencyRequest: ctx.onDependencyRequest,
      onContextRequest: ctx.onContextRequest,
    });
  }

  return runGenericWorkerTask(task, ctx, specialty);
}

function isDesignPipelineSpecialty(specialty: string): boolean {
  return (
    isDesignDirectorSpecialty(specialty) ||
    isDesignConfirmSpecialty(specialty) ||
    specialty === 'visual-capture' ||
    isVisualCriticSpecialty(specialty) ||
    isFrontendImplementSpecialty(specialty)
  );
}

/**
 * Pause between Design Spec and implement — ask for Penpot preview or skip.
 */
async function runDesignConfirmTask(
  task: TaskNode,
  ctx: WorkerContext,
): Promise<WorkerResult> {
  const root = ctx.workspaceRoot ?? process.cwd();
  const existing = loadDesignPreviewGate(root);
  if (existing && isDesignCodingUnlocked(existing.status)) {
    return {
      taskId: task.id,
      diffs: [],
      busEvents: [
        ctx.bus.emitKind(
          'TaskSummary',
          task.id,
          `Design Preview gate already ${existing.status}`,
          { path: '.singularity/design-preview.json', payload: { status: existing.status } },
        ),
      ],
      tokensUsed: 0,
      modelId: 'design-confirm',
      status: 'ok',
    };
  }

  markDesignPreviewStatus(root, 'skipped', {
    specPath: '.singularity/design-spec.json',
    penpotUrl: DEFAULT_PENPOT_URL,
    notes: 'Design Canvas disabled',
  });

  const finalGate = loadDesignPreviewGate(root);
  return {
    taskId: task.id,
    diffs: [
      {
        path: '.singularity/design-preview.json',
        unifiedDiff: '',
        newContent: `${JSON.stringify(finalGate, null, 2)}\n`,
        isNew: true,
      },
    ],
    busEvents: [
      ctx.bus.emitKind(
        'TaskSummary',
        task.id,
        `Design Preview gate skipped — coding unlocked`,
        {
          path: '.singularity/design-preview.json',
          payload: { status: finalGate?.status ?? 'skipped' },
        },
      ),
    ],
    tokensUsed: 0,
    modelId: 'design-confirm',
    status: 'ok',
  };
}

async function runDesignDirectorTask(
  task: TaskNode,
  ctx: WorkerContext,
): Promise<WorkerResult> {
  const root = ctx.workspaceRoot ?? process.cwd();
  try {
    const existing = await loadDesignSpec(root, (p) => ctx.workspace.readFile(p));
    if (existing) {
      const rel =
        task.ownedPaths[0] ?? '.singularity/design-spec.json';
      return {
        taskId: task.id,
        diffs: [],
        busEvents: [
          ctx.bus.emitKind(
            'TaskSummary',
            task.id,
            `Design Spec already present — reusing (no rewrite)`,
            { path: rel, payload: { product: existing.product.name } },
          ),
        ],
        tokensUsed: 0,
        modelId: DESIGN_DIRECTOR_MODEL_ID,
        status: 'ok',
      };
    }

    const goal = `${ctx.plan.goal}\n${task.title}\n${task.expectedOutput}`;
    const classification = await classifyAgencyAgent(goal);
    const skill = requireAgencySkill(classification.skillId);
    const skillPrompt = formatAgencySkillForPrompt(skill);
    const skillArtifact = agencySkillToArtifact(skill, {
      prompt: goal,
      classification: {
        confidence: classification.confidence,
        reason: classification.reason,
        source: classification.source,
      },
    });

    const dna = loadDesignDna(root, root);
    const result = await runDesignDirector(
      {
        goal,
        productDescription: ctx.plan.projectSummary,
        existingDna: dna,
        agencySkill: skill,
        agencySkillPrompt: skillPrompt,
      },
      {
        complete: async (req) => {
          const c = await ctx.llm.complete({
            role: 'design-director',
            systemPrompt: req.systemPrompt,
            prompt: req.prompt,
            modelId: req.modelId ?? DESIGN_DIRECTOR_MODEL_ID,
            preferredTier: 'T0',
            temperature: req.temperature ?? 0.4,
            sessionId: ctx.sessionId ?? `design-director-${task.id}`,
          });
          return {
            text: c.text,
            modelId: c.modelId,
            tokensUsed: c.tokensUsed,
          };
        },
      },
    );

    const write =
      ctx.workspace.writeFile?.bind(ctx.workspace) ??
      (async () => {
        throw new Error('WorkspacePort.writeFile required for Design Director');
      });
    saveSkillArtifact(root, skillArtifact);
    const specPath = await saveDesignSpec(root, result.spec, write);

    // Absorb into DNA memory
    const next = mergeDesignDna(dna, {
      typography: {
        sans: result.spec.typography.display.family,
        mono: result.spec.typography.technical.family,
        bodyPx: dna.typography.bodyPx,
        headingPx: dna.typography.headingPx,
      },
      colors: {
        background: result.spec.visual_identity.color.background,
        foreground: result.spec.visual_identity.color.foreground,
        accent: result.spec.visual_identity.color.accent,
        muted: result.spec.visual_identity.color.muted,
        border: result.spec.visual_identity.color.border,
        notes: result.spec.design_strategy.concept,
      },
      notes: designSpecToDnaNotes(result.spec),
    });
    saveDesignDna(root, next);

    const diffs: DiffHunk[] = [
      {
        path: '.singularity/skill.json',
        unifiedDiff: '',
        newContent: `${JSON.stringify(skillArtifact, null, 2)}\n`,
        isNew: true,
      },
      {
        path:
          task.ownedPaths.find((p) => p.endsWith('design-spec.json')) ??
          '.singularity/design-spec.json',
        unifiedDiff: '',
        newContent: `${JSON.stringify(result.spec, null, 2)}\n`,
        isNew: true,
      },
    ];

    return {
      taskId: task.id,
      diffs,
      busEvents: [
        ctx.bus.emitKind(
          'TaskSummary',
          task.id,
          `Design Director produced skill=${skill.id} + Spec via ${result.modelId}`,
          { path: diffs[1]!.path, payload: { skillId: skill.id, specPath } },
        ),
      ],
      tokensUsed: result.tokensUsed,
      modelId: result.modelId,
      status: 'ok',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      taskId: task.id,
      diffs: [],
      busEvents: [
        ctx.bus.emitKind('TaskSummary', task.id, `Design Director failed: ${message}`),
      ],
      tokensUsed: 0,
      modelId: DESIGN_DIRECTOR_MODEL_ID,
      status: 'error',
      error: message,
    };
  }
}

async function runVisualCaptureTask(
  task: TaskNode,
  ctx: WorkerContext,
): Promise<WorkerResult> {
  const outPath =
    task.ownedPaths[0]?.replace(/\/$/, '') ?? '.singularity/visual-qa/iter-1';
  const screenshotDir = ctx.workspaceRoot
    ? `${ctx.workspaceRoot}/${outPath}`
    : undefined;
  const browser =
    ctx.browser ??
    (await createBrowserPort({ screenshotDir }).catch(() => new StubBrowserPort()));
  try {
    const files = ctx.workspace.listFiles ? await ctx.workspace.listFiles() : [];
    const url =
      ctx.previewUrl ??
      inferPreviewUrl(files) ??
      'http://127.0.0.1:3000';
    const captures = await browser.capture({
      url,
      viewports: DEFAULT_VISUAL_VIEWPORTS,
    });
    const payload = JSON.stringify({ url, captures }, null, 2);
    const captureFile = `${outPath}/captures.json`;

    if (ctx.workspace.writeFile) {
      await ctx.workspace.writeFile(captureFile, `${payload}\n`);
    }

    return {
      taskId: task.id,
      diffs: [
        {
          path: captureFile,
          unifiedDiff: '',
          newContent: `${payload}\n`,
          isNew: true,
        },
      ],
      busEvents: [
        ctx.bus.emitKind(
          'TaskSummary',
          task.id,
          `Captured ${captures.length} viewports @ ${url}`,
        ),
      ],
      tokensUsed: 0,
      modelId: 'browser-port',
      status: 'ok',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      taskId: task.id,
      diffs: [],
      busEvents: [
        ctx.bus.emitKind('TaskSummary', task.id, `Visual capture failed: ${message}`),
      ],
      tokensUsed: 0,
      modelId: 'browser-port',
      status: 'error',
      error: message,
    };
  }
}

async function runVisualCriticTask(
  task: TaskNode,
  ctx: WorkerContext,
): Promise<WorkerResult> {
  const root = ctx.workspaceRoot ?? process.cwd();
  try {
    const spec = await loadDesignSpec(root, (p) => ctx.workspace.readFile(p));
    if (!spec) {
      throw new Error('Design Spec missing — cannot run Visual Critic');
    }

    const iterMatch = task.id.match(/(\d+)$/);
    const iteration = iterMatch ? Number(iterMatch[1]) : 1;
    const capturePath =
      iteration === 1
        ? '.singularity/visual-qa/iter-1/captures.json'
        : `.singularity/visual-qa/iter-${iteration}/captures.json`;
    // Also try owned parent folder
    const alt = task.ownedPaths[0]?.replace(/verdict\.json$/, 'captures.json');
    const captureText =
      (await ctx.workspace.readFile(capturePath)) ??
      (alt ? await ctx.workspace.readFile(alt) : undefined);

    let captures: VisualCriticInputCaptures = [];
    if (captureText) {
      try {
        const parsed = JSON.parse(captureText) as {
          captures?: VisualCriticInputCaptures;
        };
        captures = parsed.captures ?? [];
      } catch {
        captures = [];
      }
    }

    const { verdict, modelId, tokensUsed } = await runVisualCritic(
      {
        goal: ctx.plan.goal,
        spec,
        captures,
        iteration,
      },
      {
        complete: async (req) => {
          const c = await ctx.llm.complete({
            role: 'visual-critic',
            systemPrompt: req.systemPrompt,
            prompt: req.prompt,
            modelId: req.modelId ?? VISUAL_CRITIC_MODEL_ID,
            preferredTier: 'T2',
            temperature: 0.2,
            sessionId: ctx.sessionId ?? `visual-critic-${task.id}`,
          });
          return {
            text: c.text,
            modelId: c.modelId,
            tokensUsed: c.tokensUsed,
          };
        },
      },
    );

    const verdictPath =
      task.ownedPaths[0] ??
      `.singularity/visual-qa/iter-${iteration}/verdict.json`;
    const body = `${JSON.stringify(verdict, null, 2)}\n`;
    if (ctx.workspace.writeFile) {
      await ctx.workspace.writeFile(verdictPath, body);
    }

    return {
      taskId: task.id,
      diffs: [
        {
          path: verdictPath,
          unifiedDiff: '',
          newContent: body,
          isNew: true,
        },
      ],
      busEvents: [
        ctx.bus.emitKind(
          'TaskSummary',
          task.id,
          `Visual Critic ${verdict.pass ? 'PASS' : 'FAIL'} · genericness=${verdict.scores.genericness}`,
          { payload: { verdict: verdict as unknown as Record<string, unknown> } },
        ),
      ],
      tokensUsed,
      modelId,
      // Critic always "ok" as a node — pass/fail is in verdict (refine no-ops on pass)
      status: 'ok',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      taskId: task.id,
      diffs: [],
      busEvents: [
        ctx.bus.emitKind('TaskSummary', task.id, `Visual Critic failed: ${message}`),
      ],
      tokensUsed: 0,
      modelId: VISUAL_CRITIC_MODEL_ID,
      status: 'error',
      error: message,
    };
  }
}

type VisualCriticInputCaptures = Array<{
  url: string;
  viewport: { width: number; height: number };
  screenshotPath?: string;
  screenshotBase64?: string;
  consoleErrors: string[];
  runtimeErrors: string[];
  domSummary?: string;
  title?: string;
}>;

async function runFrontendImplementTask(
  task: TaskNode,
  ctx: WorkerContext,
  specialty: string,
): Promise<WorkerResult> {
  const root = ctx.workspaceRoot ?? process.cwd();
  const dna = loadDesignDna(root, root);
  const designSpec = await loadDesignSpec(root, (p) => ctx.workspace.readFile(p));
  const skillArtifact = await loadSkillArtifactAsync(root, (p) =>
    ctx.workspace.readFile(p),
  );

  let criticFeedback: VisualCriticVerdict | undefined;
  if (specialty === 'frontend-refine') {
    criticFeedback = await loadLatestVerdict(ctx.workspace, task);
    if (criticFeedback?.pass) {
      return {
        taskId: task.id,
        diffs: [],
        busEvents: [
          ctx.bus.emitKind(
            'TaskSummary',
            task.id,
            'Visual Critic passed — refine no-op',
          ),
        ],
        tokensUsed: 0,
        modelId: FRONTEND_OWNER_MODEL_ID,
        status: 'ok',
      };
    }
  }

  const owned = new Set(task.ownedPaths.map(normalizePath));
  const neighborPaths = await resolveNeighbors(task, ctx.workspace);
  const scopedPaths = unique([
    ...task.ownedPaths,
    ...neighborPaths,
    ...(task.neighborPaths ?? []),
  ]);

  const fileBlocks: string[] = [];
  const fileSnapshots: Array<{
    uri: string;
    content: string;
    version: number;
    languageId?: string;
  }> = [];
  const scopedContents = await parallelLimit(scopedPaths, PARALLEL_IO_LIMIT, (p) =>
    ctx.workspace.readFile(p),
  );
  scopedPaths.forEach((p, i) => {
    const content = scopedContents[i];
    if (content !== undefined) {
      fileBlocks.push(`### ${p}\n\`\`\`\n${truncate(content, 4_000)}\n\`\`\``);
      fileSnapshots.push({
        uri: p,
        content: content.slice(0, 80_000),
        version: 1,
        languageId: guessLang(p),
      });
    } else if (owned.has(normalizePath(p))) {
      fileBlocks.push(`### ${p}\n(file does not exist yet)`);
    }
  });

  const existingUi = fileSnapshots
    .filter((f) => /\.(tsx|jsx|css)$/.test(f.uri))
    .map((f) => `${f.uri} (${f.content.length} chars)`)
    .slice(0, 12)
    .join('\n');

  const bundle = buildFrontendContext({
    task: `${task.title}\n${task.expectedOutput}\n${ctx.plan.goal}`,
    dna,
    existingUiSummary: existingUi || undefined,
    specialty: specialty === 'frontend-refine' ? 'frontend-refine' : 'frontend',
    designSpec: designSpec ?? undefined,
    skillArtifact: skillArtifact ?? undefined,
    criticFeedback,
  });

  const systemPrompt = `${bundle.systemPrompt}\n\n${WORKER_SYSTEM}`;
  const prompt = [
    ctx.plan.structuredContext ? ctx.plan.structuredContext : '',
    `Task: ${task.title}`,
    `Specialty: ${specialty} (owner: DeepSeek V4 Flash-0731)`,
    designSpec
      ? `Design Spec present (${designSpec.product.name}) — implement it`
      : 'Design Spec missing — do not ship generic AI SaaS template',
    `Expected output: ${task.expectedOutput}`,
    `Owned paths:\n${task.ownedPaths.map((p) => `- ${p}`).join('\n') || '(none)'}`,
    `Project summary: ${ctx.plan.projectSummary}`,
    ctx.plan.codingStandards
      ? `Coding standards: ${ctx.plan.codingStandards}`
      : '',
    'Scoped files:',
    fileBlocks.join('\n\n') || '(empty)',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const completion = await ctx.llm.complete({
      role: 'worker',
      systemPrompt,
      prompt,
      preferredTier: 'T0',
      modelId: ctx.modelId ?? FRONTEND_OWNER_MODEL_ID,
      temperature: 0.1,
      sessionId: ctx.sessionId ?? `worker-${task.id}`,
      builderUpdate: {
        userPrompt: prompt,
        systemPrompt,
        files: fileSnapshots.slice(0, 12),
        intent: 'AGENT',
        currentFileUri: task.ownedPaths[0],
      },
      cacheable: false,
    });

    const payload = parseWorkerJson(completion.text);
    const { diffs, rejected, changeRequests } = filterOwnedDiffs(
      payload.diffs ?? [],
      owned,
    );

    // Reject design-director paths from implementer
    const safeDiffs = diffs.filter((d) => {
      if (designDirectorMayWritePath(d.path) && specialty !== 'design-director') {
        return false;
      }
      return true;
    });

    if (ctx.workspaceRoot) {
      persistDesignDnaFromDiffs(
        ctx.workspaceRoot,
        safeDiffs,
        bundle.sources.map((s) => s.id),
        designSpec,
      );
    }

    const busEvents: BusEvent[] = [];
    for (const ev of payload.busEvents ?? []) {
      busEvents.push(
        ctx.bus.emit({
          kind: (ev.kind as BusEvent['kind']) || 'Custom',
          taskId: task.id,
          message: ev.message ?? '',
          path: ev.path,
          payload: ev.payload,
        }),
      );
    }

    for (const path of [...(payload.changeRequests ?? []), ...rejected]) {
      changeRequests.add(normalizePath(path));
      busEvents.push(
        ctx.bus.emitKind(
          'ChangeRequest',
          task.id,
          `Worker ${task.id} requests change outside ownership: ${path}`,
          { path },
        ),
      );
    }

    busEvents.push(
      ctx.bus.emitKind(
        'TaskSummary',
        task.id,
        `Frontend ${specialty} via ${FRONTEND_OWNER_MODEL_ID}`,
      ),
    );

    return {
      taskId: task.id,
      diffs: safeDiffs,
      busEvents,
      tokensUsed: completion.tokensUsed,
      modelId: completion.modelId,
      status: 'ok',
      changeRequests: [...changeRequests],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      taskId: task.id,
      diffs: [],
      busEvents: [
        ctx.bus.emitKind('TaskSummary', task.id, `Worker failed: ${message}`),
      ],
      tokensUsed: 0,
      modelId: FRONTEND_OWNER_MODEL_ID,
      status: 'error',
      error: message,
    };
  }
}

async function runGenericWorkerTask(
  task: TaskNode,
  ctx: WorkerContext,
  specialty: string,
): Promise<WorkerResult> {
  const owned = new Set(task.ownedPaths.map(normalizePath));
  const neighborPaths = await resolveNeighbors(task, ctx.workspace);
  const scopedPaths = unique([
    ...task.ownedPaths,
    ...neighborPaths,
    ...(task.neighborPaths ?? []),
  ]);

  const fileBlocks: string[] = [];
  const fileSnapshots: Array<{
    uri: string;
    content: string;
    version: number;
    languageId?: string;
  }> = [];
  const scopedContents = await parallelLimit(scopedPaths, PARALLEL_IO_LIMIT, (p) =>
    ctx.workspace.readFile(p),
  );
  scopedPaths.forEach((p, i) => {
    const content = scopedContents[i];
    if (content !== undefined) {
      fileBlocks.push(`### ${p}\n\`\`\`\n${truncate(content, 4_000)}\n\`\`\``);
      fileSnapshots.push({
        uri: p,
        content: content.slice(0, 80_000),
        version: 1,
        languageId: guessLang(p),
      });
    } else if (owned.has(normalizePath(p))) {
      fileBlocks.push(`### ${p}\n(file does not exist yet)`);
    }
  });

  const prompt = [
    ctx.plan.structuredContext ? ctx.plan.structuredContext : '',
    `Task: ${task.title}`,
    `Specialty: ${specialty}`,
    `Expected output: ${task.expectedOutput}`,
    `Owned paths:\n${task.ownedPaths.map((p) => `- ${p}`).join('\n') || '(none)'}`,
    `Project summary: ${ctx.plan.projectSummary}`,
    ctx.plan.codingStandards
      ? `Coding standards: ${ctx.plan.codingStandards}`
      : '',
    'Scoped files:',
    fileBlocks.join('\n\n') || '(empty)',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const completion = await ctx.llm.complete({
      role: 'worker',
      systemPrompt: WORKER_SYSTEM,
      prompt,
      preferredTier: task.recommendedTier,
      modelId: ctx.modelId,
      temperature: 0.1,
      sessionId: ctx.sessionId ?? `worker-${task.id}`,
      builderUpdate: {
        userPrompt: prompt,
        systemPrompt: WORKER_SYSTEM,
        files: fileSnapshots.slice(0, 12),
        intent: 'AGENT',
        currentFileUri: task.ownedPaths[0],
      },
      cacheable: false,
    });

    const payload = parseWorkerJson(completion.text);
    const { diffs, rejected, changeRequests } = filterOwnedDiffs(
      payload.diffs ?? [],
      owned,
    );

    const busEvents: BusEvent[] = [];
    for (const ev of payload.busEvents ?? []) {
      busEvents.push(
        ctx.bus.emit({
          kind: (ev.kind as BusEvent['kind']) || 'Custom',
          taskId: task.id,
          message: ev.message ?? '',
          path: ev.path,
          payload: ev.payload,
        }),
      );
    }
    for (const path of [...(payload.changeRequests ?? []), ...rejected]) {
      changeRequests.add(normalizePath(path));
      busEvents.push(
        ctx.bus.emitKind(
          'ChangeRequest',
          task.id,
          `Worker ${task.id} requests change outside ownership: ${path}`,
          { path },
        ),
      );
    }

    return {
      taskId: task.id,
      diffs,
      busEvents,
      tokensUsed: completion.tokensUsed,
      modelId: completion.modelId,
      status: 'ok',
      changeRequests: [...changeRequests],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      taskId: task.id,
      diffs: [],
      busEvents: [
        ctx.bus.emitKind('TaskSummary', task.id, `Worker failed: ${message}`),
      ],
      tokensUsed: 0,
      modelId: ctx.modelId ?? 'unknown',
      status: 'error',
      error: message,
    };
  }
}

async function loadLatestVerdict(
  workspace: WorkspacePort,
  task: TaskNode,
): Promise<VisualCriticVerdict | undefined> {
  const candidates = [
    '.singularity/visual-qa/iter-1/verdict.json',
    '.singularity/visual-qa/iter-2/verdict.json',
    '.singularity/visual-qa/iter-3/verdict.json',
  ];
  // Prefer critic dep naming from refine id
  const m = task.id.match(/frontend-refine-(\d+)/);
  if (m) {
    candidates.unshift(`.singularity/visual-qa/iter-${m[1]}/verdict.json`);
  }
  for (const p of candidates) {
    const text = await workspace.readFile(p);
    if (!text) continue;
    try {
      return JSON.parse(text) as VisualCriticVerdict;
    } catch {
      /* continue */
    }
  }
  return undefined;
}

function persistDesignDnaFromDiffs(
  workspaceRoot: string,
  diffs: DiffHunk[],
  sourcesUsed: string[],
  spec?: DesignSpecification | null,
): void {
  try {
    const files = diffs
      .filter((d) => d.newContent)
      .map((d) => ({ path: d.path, content: d.newContent! }));
    if (!files.length && !spec) return;
    const current = loadDesignDna(workspaceRoot, workspaceRoot);
    const patch = files.length
      ? extractDnaSignalsFromFiles(files)
      : { components: [], notes: [] as string[] };
    patch.sourcesUsed = sourcesUsed;
    if (spec) {
      patch.notes = [...(patch.notes ?? []), ...designSpecToDnaNotes(spec)];
    }
    const next = mergeDesignDna(current, patch);
    saveDesignDna(workspaceRoot, next);
  } catch {
    /* non-fatal */
  }
}

export function parseWorkerJson(text: string): WorkerJsonPayload {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fence ? fence[1]!.trim() : trimmed;
  return JSON.parse(jsonText) as WorkerJsonPayload;
}

export function filterOwnedDiffs(
  diffs: WorkerJsonPayload['diffs'],
  owned: Set<string>,
): {
  diffs: DiffHunk[];
  rejected: string[];
  changeRequests: Set<string>;
} {
  const out: DiffHunk[] = [];
  const rejected: string[] = [];
  const changeRequests = new Set<string>();
  for (const d of diffs ?? []) {
    const path = normalizePath(String(d.path ?? ''));
    if (!path) continue;
    if (owned.size) {
      const underOwned = [...owned].some(
        (o) => path === o || path.startsWith(`${o.replace(/\/$/, '')}/`),
      );
      if (!underOwned) {
        rejected.push(path);
        changeRequests.add(path);
        continue;
      }
    }
    out.push({
      path,
      unifiedDiff: d.unifiedDiff ?? '',
      newContent: d.newContent,
      isNew: d.isNew,
    });
  }
  return { diffs: out, rejected, changeRequests };
}

async function resolveNeighbors(
  task: TaskNode,
  workspace: WorkspacePort,
): Promise<string[]> {
  if (!workspace.neighbors) return [];
  const batches = await parallelLimit(
    task.ownedPaths.slice(0, 8),
    PARALLEL_IO_LIMIT,
    async (p) => {
      try {
        return await workspace.neighbors!(p);
      } catch {
        return [] as string[];
      }
    },
  );
  return unique(batches.flat()).slice(0, 16);
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}\n/* …truncated… */`;
}

function guessLang(path: string): string | undefined {
  if (path.endsWith('.tsx')) return 'typescriptreact';
  if (path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.jsx')) return 'javascriptreact';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.json')) return 'json';
  return undefined;
}

/** Re-export for tests — unused import guard */
export { formatDesignSpecForPrompt };
