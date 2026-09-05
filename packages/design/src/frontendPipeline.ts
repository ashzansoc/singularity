/**
 * Frontend Design Intelligence Pipeline — DAG node injection + refinement loop.
 *
 * FRONTEND TASK → Design Director → Spec → Knowledge → DeepSeek Flash →
 * Build/Browser → Visual Critic → PASS | FAIL → Flash refine (≤ MAX iterations)
 */

import {
  DEFAULT_VISUAL_QA_THRESHOLDS,
  type VisualQaThresholds,
} from './designSpec.js';
import { DESIGN_DIRECTOR_MODEL_ID } from './designDirector.js';
import { FRONTEND_OWNER_MODEL_ID } from './types.js';
import { VISUAL_CRITIC_MODEL_ID } from './visualCritic.js';

/** Pipeline specialty roles (extends TaskNode.specialty in runtime). */
export type FrontendPipelineSpecialty =
  | 'design-director'
  | 'design-confirm'
  | 'frontend'
  | 'frontend-refine'
  | 'visual-capture'
  | 'visual-critic'
  | 'backend'
  | 'ai-pipeline'
  | 'infrastructure'
  | 'general';

export interface PipelineTaskNode {
  id: string;
  title: string;
  deps: string[];
  ownedPaths: string[];
  expectedOutput: string;
  estimatedTokens: number;
  recommendedTier: string;
  specialty?: FrontendPipelineSpecialty;
  priority: number;
  retryLimit: number;
  status: 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'cancelled';
  neighborPaths?: string[];
  attempts?: number;
  /** Preferred model pin for scheduler. */
  preferredModelId?: string;
}

export interface PipelinePlanLike {
  id: string;
  goal: string;
  projectSummary: string;
  codingStandards?: string;
  nodes: PipelineTaskNode[];
  estimates: {
    totalTokens: number;
    taskCount: number;
    criticalPathLength: number;
  };
  createdAt: number;
}

export interface InjectPipelineOptions {
  thresholds?: Partial<VisualQaThresholds>;
  /** Root path prefix for owned artifact paths. */
  singularityDir?: string;
  /** Force injection even if no frontend nodes detected. */
  force?: boolean;
}

const FRONTENDISH = /frontend|ui|react|tsx|jsx|css|landing|hero|dashboard|page|component|layout/i;

const PIPELINE_NODE_ID_RE =
  /^(design-director|design-confirm|visual-capture(?:-\d+)?|visual-critic(?:-\d+)?|frontend-refine(?:-\d+)?|frontend-implement)$/;

const PIPELINE_SPECIALTIES = new Set<FrontendPipelineSpecialty>([
  'design-director',
  'design-confirm',
  'visual-capture',
  'visual-critic',
  'frontend-refine',
]);

export function isInjectedPipelineNode(node: {
  id: string;
  specialty?: FrontendPipelineSpecialty;
}): boolean {
  if (PIPELINE_NODE_ID_RE.test(node.id)) {
    return true;
  }
  return node.specialty !== undefined && PIPELINE_SPECIALTIES.has(node.specialty);
}

function isInjectedPipelineDep(dep: string): boolean {
  return PIPELINE_NODE_ID_RE.test(dep);
}

/**
 * Detect whether a plan needs the Design Intelligence pipeline.
 */
export function planNeedsFrontendPipeline(plan: PipelinePlanLike): boolean {
  return plan.nodes.some(
    (n) =>
      n.specialty === 'frontend' ||
      n.specialty === 'frontend-refine' ||
      FRONTENDISH.test(`${n.title} ${n.ownedPaths.join(' ')}`),
  );
}

/**
 * Inject Design Director → (existing frontend nodes) → capture → critic → refine loops
 * into an existing ExecutionPlan. Mutates a shallow copy of nodes.
 */
export function injectFrontendDesignPipeline(
  plan: PipelinePlanLike,
  options: InjectPipelineOptions = {},
): PipelinePlanLike {
  if (!options.force && !planNeedsFrontendPipeline(plan)) {
    return plan;
  }

  const thresholds = {
    ...DEFAULT_VISUAL_QA_THRESHOLDS,
    ...options.thresholds,
  };
  const maxIter = Math.max(1, thresholds.maxVisualIterations);
  const dir = options.singularityDir ?? '.singularity';

  // Drop planner-hallucinated pipeline nodes; injection owns this subgraph.
  const nodes = plan.nodes
    .filter((n) => !isInjectedPipelineNode(n))
    .map((n) => ({
      ...n,
      deps: [...n.deps],
      ownedPaths: [...n.ownedPaths],
    }));

  // Skip if already injected
  if (nodes.some((n) => n.id === 'design-director' || n.specialty === 'design-director')) {
    return { ...plan, nodes };
  }

  const frontendNodes = nodes.filter(
    (n) =>
      n.specialty === 'frontend' ||
      (FRONTENDISH.test(`${n.title} ${n.ownedPaths.join(' ')}`) &&
        n.specialty !== 'backend' &&
        n.specialty !== 'infrastructure' &&
        n.specialty !== 'ai-pipeline'),
  );

  // Ensure specialty + model pin on implementers (blocked on design-confirm).
  // Strip pipeline deps so capture→implementer edges cannot form cycles with refine/critic.
  for (const n of frontendNodes) {
    n.specialty = 'frontend';
    n.preferredModelId = FRONTEND_OWNER_MODEL_ID;
    const withoutPipeline = n.deps.filter(
      (d) => !isInjectedPipelineDep(d) && d !== 'design-director' && d !== 'design-confirm',
    );
    n.deps = ['design-confirm', ...withoutPipeline];
  }

  const director: PipelineTaskNode = {
    id: 'design-director',
    title: 'Design Director — art direction + Design Specification',
    deps: [],
    ownedPaths: [`${dir}/design-spec.json`, `${dir}/skill.json`],
    expectedOutput:
      'Agency skill.json + Design Specification JSON (no React/CSS). Product metaphor, palette, type, signature visual, avoid list.',
    estimatedTokens: 4000,
    recommendedTier: 'T2',
    specialty: 'design-director',
    preferredModelId: DESIGN_DIRECTOR_MODEL_ID,
    priority: 200,
    retryLimit: 2,
    status: 'pending',
    attempts: 0,
  };

  const confirm: PipelineTaskNode = {
    id: 'design-confirm',
    title: 'Design Preview gate — Penpot / Spec board confirmation',
    deps: ['design-director'],
    ownedPaths: [`${dir}/design-preview.json`],
    expectedOutput:
      'User chooses Penpot-style preview or skips; Final Design unlocks coding (approved|skipped).',
    estimatedTokens: 200,
    recommendedTier: 'T0',
    specialty: 'design-confirm',
    priority: 190,
    retryLimit: 1,
    status: 'pending',
    attempts: 0,
  };

  const implementIds = frontendNodes.map((n) => n.id);
  // If no frontend nodes existed, create a single implement node
  if (!implementIds.length) {
    const implement: PipelineTaskNode = {
      id: 'frontend-implement',
      title: 'DeepSeek Flash-0731 — implement Design Specification',
      deps: ['design-confirm'],
      ownedPaths: ['src'],
      expectedOutput:
        'Production UI matching Design Spec: brand-first hero, signature product visual, linked sections',
      estimatedTokens: 8000,
      recommendedTier: 'T0',
      specialty: 'frontend',
      preferredModelId: FRONTEND_OWNER_MODEL_ID,
      priority: 100,
      retryLimit: 2,
      status: 'pending',
      attempts: 0,
    };
    nodes.push(implement);
    implementIds.push(implement.id);
  }

  const pipelineExtras: PipelineTaskNode[] = [director, confirm];

  let prevCriticId: string | undefined;

  for (let i = 1; i <= maxIter; i++) {
    const captureId = i === 1 ? 'visual-capture' : `visual-capture-${i}`;
    const criticId = i === 1 ? 'visual-critic' : `visual-critic-${i}`;
    const refineId = `frontend-refine-${i}`;

    const captureDeps =
      i === 1
        ? [...implementIds]
        : prevCriticId
          ? [`frontend-refine-${i - 1}`]
          : [...implementIds];

    pipelineExtras.push({
      id: captureId,
      title: `Browser capture (viewports) — iteration ${i}`,
      deps: captureDeps,
      ownedPaths: [`${dir}/visual-qa/iter-${i}`],
      expectedOutput:
        'Screenshots at 1440×900, 1024×768, 390×844 + console/runtime errors + DOM summary',
      estimatedTokens: 500,
      recommendedTier: 'T0',
      specialty: 'visual-capture',
      priority: 40,
      retryLimit: 1,
      status: 'pending',
      attempts: 0,
    });

    pipelineExtras.push({
      id: criticId,
      title: `Visual Critic — iteration ${i}`,
      deps: [captureId],
      ownedPaths: [`${dir}/visual-qa/iter-${i}/verdict.json`],
      expectedOutput:
        'VisualCriticVerdict JSON with scores + actionable findings. No file edits to app source.',
      estimatedTokens: 3000,
      recommendedTier: 'T2',
      specialty: 'visual-critic',
      preferredModelId: VISUAL_CRITIC_MODEL_ID,
      priority: 35,
      retryLimit: 1,
      status: 'pending',
      attempts: 0,
    });

    // Refine node depends on critic; no-ops when verdict.pass
    if (i < maxIter) {
      pipelineExtras.push({
        id: refineId,
        title: `DeepSeek Flash-0731 refine — iteration ${i}`,
        deps: [criticId],
        ownedPaths: frontendNodes.flatMap((n) => n.ownedPaths).length
          ? unique(frontendNodes.flatMap((n) => n.ownedPaths))
          : ['src'],
        expectedOutput:
          'Apply Visual Critic findings while preserving Design Specification art direction. No-op if critic passed.',
        estimatedTokens: 6000,
        recommendedTier: 'T0',
        specialty: 'frontend-refine',
        preferredModelId: FRONTEND_OWNER_MODEL_ID,
        priority: 30,
        retryLimit: 1,
        status: 'pending',
        attempts: 0,
      });
    }

    prevCriticId = criticId;
  }

  const nextNodes = [...pipelineExtras, ...nodes];
  const totalTokens = nextNodes.reduce((s, n) => s + n.estimatedTokens, 0);

  return {
    ...plan,
    nodes: nextNodes,
    estimates: {
      ...plan.estimates,
      totalTokens,
      taskCount: nextNodes.length,
      // critical path approx: director + 1 implement + capture + critic (+ refine loops)
      criticalPathLength: Math.max(
        plan.estimates.criticalPathLength + 2 + maxIter * 2,
        4,
      ),
    },
  };
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

/**
 * Refinement-loop termination: stop when pass OR iteration >= max.
 */
export function shouldContinueVisualRefinement(
  iteration: number,
  passed: boolean,
  thresholds: VisualQaThresholds = DEFAULT_VISUAL_QA_THRESHOLDS,
): boolean {
  if (passed) return false;
  return iteration < thresholds.maxVisualIterations;
}

/** Model ownership map for scheduler pins. */
export function modelIdForSpecialty(
  specialty: FrontendPipelineSpecialty | undefined,
): string | undefined {
  switch (specialty) {
    case 'design-director':
    case 'visual-critic':
      return specialty === 'design-director'
        ? DESIGN_DIRECTOR_MODEL_ID
        : VISUAL_CRITIC_MODEL_ID;
    case 'frontend':
    case 'frontend-refine':
      return FRONTEND_OWNER_MODEL_ID;
    case 'visual-capture':
      return undefined; // tools, not LLM (or tiny utility)
    default:
      return undefined;
  }
}

export function isDesignDirectorSpecialty(
  specialty: string | undefined,
): boolean {
  return specialty === 'design-director';
}

export function isDesignConfirmSpecialty(
  specialty: string | undefined,
): boolean {
  return specialty === 'design-confirm';
}

export function isVisualCriticSpecialty(specialty: string | undefined): boolean {
  return specialty === 'visual-critic';
}

export function isFrontendImplementSpecialty(
  specialty: string | undefined,
): boolean {
  return specialty === 'frontend' || specialty === 'frontend-refine';
}
