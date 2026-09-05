import type { RouteFeatures, RouteContext } from './types.js';

/** Multi-model specialty lanes. Frontend is owned by DeepSeek via TokenRouter. */
export type SpecialtyLane =
  | 'frontend'
  | 'backend'
  | 'ai-pipeline'
  | 'infrastructure'
  | 'general';

/** Canonical catalog / TokenRouter id for the frontend owner. */
export const FRONTEND_OWNER_MODEL_ID = 'deepseek/deepseek-v4-flash-0731';

const FRONTEND_BUILD =
  /\b(frontend|ui|ux|react|next\.?js|vue|svelte|tailwind|css|html|tsx|jsx|component|dashboard|landing\s*page|design\s*system|shadcn|hero\b|layout|stylesheet|animation|framer)\b/i;

const FRONTEND_ACTION =
  /\b(build|create|implement|design|style|render|compose|scaffold|polish|redesign|layout|wireframe|prototype)\b/i;

const BACKEND =
  /\b(backend|api\b|rest|graphql|database|prisma|drizzle|sql|postgres|redis|auth\s*server|endpoint|microservice)\b/i;

const AI_PIPELINE =
  /\b(ai\s*pipeline|llm\s*pipeline|model\s*inference|embedding|rag\b|vector\s*db|fine[\s-]?tun|training\s*job)\b/i;

const INFRA =
  /\b(docker|kubernetes|k8s|terraform|ci\/cd|github\s*actions|infra|deploy|helm|aws\s*cdk)\b/i;

/**
 * Detect which specialty lane should own (a portion of) this request.
 * Explicit `ctx.specialty` wins; otherwise heuristics on prompt + features.
 *
 * Multi-lane goals (frontend + backend + AI) return `general` so the planner
 * can split — only pure/dominant frontend requests hard-pin to DeepSeek.
 */
export function detectSpecialty(
  prompt: string,
  features?: RouteFeatures,
  explicit?: SpecialtyLane,
): SpecialtyLane {
  if (explicit) return explicit;

  const text = prompt ?? '';
  const lower = text.toLowerCase();

  const wantsFrontend =
    (features?.keywords.frontend ?? false) ||
    FRONTEND_BUILD.test(lower) ||
    /\.(tsx|jsx|css|scss)\b/.test(lower);
  const wantsBackend = BACKEND.test(lower) || (features?.keywords.backend ?? false);
  const wantsAi = AI_PIPELINE.test(lower);
  const wantsInfra = INFRA.test(lower);
  const frontendAction =
    FRONTEND_ACTION.test(lower) || /\b(page|screen|view|widget)\b/i.test(lower);

  const laneCount =
    Number(wantsFrontend && frontendAction) +
    Number(wantsBackend) +
    Number(wantsAi) +
    Number(wantsInfra);

  // Multi-surface product goals → leave to planner / soft scoring
  if (laneCount >= 2) {
    return 'general';
  }

  if (wantsFrontend && frontendAction) {
    return 'frontend';
  }
  if (wantsFrontend && !wantsBackend && !wantsInfra && !wantsAi) {
    return 'frontend';
  }
  if (wantsAi) return 'ai-pipeline';
  if (wantsInfra) return 'infrastructure';
  if (wantsBackend) return 'backend';
  return 'general';
}

export function specialtyFromContext(ctx: RouteContext, features: RouteFeatures): SpecialtyLane {
  return detectSpecialty(ctx.prompt, features, ctx.specialty);
}

/** Whether this specialty hard-pins to the frontend owner model. */
export function isFrontendSpecialty(specialty: SpecialtyLane): boolean {
  return specialty === 'frontend';
}

export const FRONTEND_SYSTEM_HINT = `You own frontend IMPLEMENTATION only (React/UI/CSS). Follow the Design Specification from the Design Director — do not reinvent art direction. Ban automatic zinc+blue-purple SaaS defaults, Lucide icon-card grids, and decorative MeshDistort blobs unless the Design Spec justifies them. Brand-first hero + product signature visual. Do not implement backend or infra — leave seams for stitch.`;
