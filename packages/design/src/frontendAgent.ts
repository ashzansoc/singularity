import { formatDnaForPrompt } from './dna.js';
import { retrieveSplitKnowledge } from './designKnowledgeRetrieval.js';
import {
  formatDesignSpecForPrompt,
  type DesignSpecification,
} from './designSpec.js';
import {
  formatSkillArtifactForPrompt,
  type SkillArtifact,
} from './skillArtifact.js';
import { FRONTEND_TASTE_RULES } from './tasteRules.js';
import {
  FRONTEND_OWNER_DISPLAY_NAME,
  FRONTEND_OWNER_MODEL_ID,
  type DesignContextBundle,
  type DesignDna,
  type TaskSpecialty,
} from './types.js';
import { formatCriticFeedbackForPrompt, type VisualCriticVerdict } from './visualCritic.js';

export const FRONTEND_AGENT_SYSTEM = `You are Singularity's Frontend Implementer — ${FRONTEND_OWNER_DISPLAY_NAME}.
You OWN frontend implementation only (React/UI/CSS).

Scope:
- Translate the Design Specification into production-quality frontend code
- Do NOT reinvent art direction when a Design Spec is present
- Do NOT implement backend APIs, databases, infra, or ML pipelines (emit ChangeRequests instead)
- Prefer Design DNA + Design Spec + Design Knowledge over inventing a new visual language
- Component libraries are IMPLEMENTATION resources — they must not dictate the look
- Match existing project UI when files are provided

${FRONTEND_TASTE_RULES}

Return worker JSON only when running inside Runtime workers.`;

export interface BuildFrontendContextOptions {
  task: string;
  dna: DesignDna;
  existingUiSummary?: string;
  specialty?: TaskSpecialty;
  designSpec?: DesignSpecification;
  /** Selected agency skill artifact from `.singularity/skill.json`. */
  skillArtifact?: SkillArtifact;
  criticFeedback?: VisualCriticVerdict;
  apiContractSummary?: string;
  relevantRoutesSummary?: string;
}

/**
 * Assemble the frontend context bundle for DeepSeek Flash.
 * Stable prefix order for cache: system → skill → Design Spec → design refs → DNA → impl refs → project.
 */
export function buildFrontendContext(
  options: BuildFrontendContextOptions,
): DesignContextBundle {
  const retrieved = retrieveSplitKnowledge({
    rawQuery: options.task,
    spec: options.designSpec,
  });
  const dnaBlock = formatDnaForPrompt(options.dna);
  const existing = options.existingUiSummary
    ? `Existing UI\n──────────────\n${options.existingUiSummary}`
    : 'Existing UI\n──────────────\n(none yet — follow Design Spec carefully)';

  const skillBlock = options.skillArtifact
    ? formatSkillArtifactForPrompt(options.skillArtifact)
    : '';

  const specBlock = options.designSpec
    ? formatDesignSpecForPrompt(options.designSpec)
    : 'DESIGN SPECIFICATION\n──────────────\n(missing — establish art direction before coding; do not default to AI SaaS template)';

  const criticBlock = options.criticFeedback
    ? formatCriticFeedbackForPrompt(options.criticFeedback)
    : '';

  const systemPrompt = [
    FRONTEND_AGENT_SYSTEM,
    '',
    skillBlock,
    skillBlock ? '' : '',
    specBlock,
    '',
    retrieved.designBlock,
    '',
    dnaBlock,
    '',
    retrieved.implementationBlock,
    '',
    existing,
    options.relevantRoutesSummary
      ? `Relevant routes\n──────────────\n${options.relevantRoutesSummary}`
      : '',
    options.apiContractSummary
      ? `Backend API contract\n──────────────\n${options.apiContractSummary}`
      : '',
    criticBlock,
    '',
    'Compose UI from: Agency Skill → Design Specification → Design Knowledge → Project DNA → Implementation Knowledge.',
    'Do not let implementation libraries override the Design Specification.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    specialty: options.specialty ?? 'frontend',
    modelId: FRONTEND_OWNER_MODEL_ID,
    systemPrompt,
    dnaBlock,
    knowledgeBlock: `${retrieved.designBlock}\n\n${retrieved.implementationBlock}`,
    sources: retrieved.sources,
  };
}

export function isFrontendOwnedPath(path: string): boolean {
  return (
    /\.(tsx|jsx|css|scss|sass|less|html|vue|svelte)$/i.test(path) ||
    /(^|\/)(components|pages|app|ui|styles|layouts|views|public)(\/|$)/i.test(path)
  );
}

export function inferSpecialtyFromPaths(paths: string[]): TaskSpecialty {
  if (!paths.length) return 'general';
  if (paths.some((p) => /design-spec\.json$/.test(p) || /skill\.json$/.test(p))) {
    return 'design-director';
  }
  if (paths.some((p) => /visual-qa.*verdict\.json$/.test(p))) return 'visual-critic';
  const frontendHits = paths.filter(isFrontendOwnedPath).length;
  const backendHits = paths.filter((p) =>
    /(^|\/)(api|server|services|backend|db|prisma|drizzle|workers)(\/|$)/i.test(p) ||
    /\.(go|rs|py|java|kt)$/i.test(p),
  ).length;
  const infraHits = paths.filter((p) =>
    /(docker|k8s|terraform|github\/workflows|infra)/i.test(p),
  ).length;
  if (frontendHits >= backendHits && frontendHits >= infraHits && frontendHits > 0) {
    return 'frontend';
  }
  if (infraHits > backendHits && infraHits > 0) return 'infrastructure';
  if (backendHits > 0) return 'backend';
  return 'general';
}
