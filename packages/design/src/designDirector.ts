/**
 * Design Director — owns DESIGN DIRECTION only.
 * Must NOT write frontend implementation code.
 *
 * Generation path: DeepSeek V4 Flash-0731 receives an EXAMPLE Design Spec v2
 * (quality/structure reference) plus the user's prompt, then invents a unique Spec.
 */

import { join } from 'node:path';
import {
  formatAgencySkillForPrompt,
  type AgencySkill,
} from './agencySkill.js';
import {
  DESIGN_SPEC_FILENAME,
  DEFAULT_AVOID_LIST,
  formatDesignSpecForPrompt,
  parseDesignSpecJson,
  type DesignSpecification,
  validateDesignSpec,
} from './designSpec.js';
import { FRONTEND_TASTE_RULES } from './tasteRules.js';
import {
  defaultFontTrio,
  designSpecTypographyFromSystem,
  formatFontPersonalityCatalog,
} from './fontPersonalities.js';
import type { DesignDna } from './types.js';
import { formatDnaForPrompt } from './dna.js';
import { SKILL_ARTIFACT_FILENAME } from './skillArtifact.js';

/**
 * Design Director model — DeepSeek V4 Flash-0731 (TokenRouter).
 * Override with SINGULARITY_DESIGN_DIRECTOR_MODEL.
 */
export const DESIGN_DIRECTOR_MODEL_ID =
  'deepseek/deepseek-v4-flash-0731' as const;

export const DESIGN_DIRECTOR_DISPLAY_NAME =
  'Design Director (DeepSeek V4 Flash-0731)' as const;

/**
 * Example Spec shown as a quality + structure reference (v2 sheet).
 * Product/colors are fictional — the model must NOT copy them; invent for the user prompt.
 */
export const EXAMPLE_DESIGN_SPEC: DesignSpecification = {
  version: 2,
  meta: {
    spec_type: 'frontend_design_directive',
    design_intent:
      'Define the visual, structural, interaction, and implementation language before frontend generation.',
    design_priority: [
      'product clarity',
      'visual hierarchy',
      'brand distinctiveness',
      'composition',
      'usability',
      'polish',
      'implementation simplicity',
    ],
    decision_rule:
      'When visual novelty conflicts with product clarity, prefer product clarity.',
  },
  product: {
    name: 'Northline',
    category: 'climate analytics for logistics',
    audience: {
      primary: 'ops leads at freight companies',
      secondary: ['dispatch planners'],
      technical_level: 'intermediate',
    },
    product_character: ['calm', 'precise', 'cartographic', 'confident'],
    brand_promise: 'Make climate delay risk along freight corridors feel controllable.',
    brand_personality: {
      should_feel: ['intelligent', 'intentional', 'credible', 'technical without being sterile'],
      should_not_feel: [
        'hyped',
        'generic',
        'corporate',
        'playful SaaS',
        'crypto',
        'template-generated',
      ],
    },
    primary_user_action: 'Understand corridor risk and start a route brief.',
    conversion_goal: {
      primary: 'Start a corridor brief',
      secondary: 'Explore the map',
    },
  },
  design_strategy: {
    concept: 'Weather-aware freight map as brand identity',
    central_idea: {
      statement: 'The interface itself should explain climate-aware routing.',
      visual_metaphor: 'contour lines over a shipping corridor',
      principle:
        'Every major visual element should either communicate product functionality, hierarchy, or brand.',
    },
    design_language: {
      keywords: ['editorial', 'cartographic', 'restrained', 'precise', 'high-contrast'],
      density: 'medium',
      visual_complexity: 'controlled',
      surface_treatment: 'paper field',
      ornamentation: 'low',
    },
    design_differentiator: {
      description:
        'Avoid looking like a generic AI SaaS landing page. The corridor map becomes the visual identity.',
      requirement:
        'At least one major composition must be impossible to mistake for a generic SaaS template.',
    },
  },
  visual_identity: {
    color: {
      background: '#f4f1ea',
      foreground: '#1a1f24',
      primary: '#1a1f24',
      accent: '#b87333',
      muted: '#6b7280',
      border: '#d6d0c4',
      usage_rules: {
        background: 'Use as the dominant canvas.',
        foreground: 'Primary text and high-priority interface elements.',
        muted: 'Secondary information only.',
        accent: 'Use sparingly for actions, active states, diagram signals, and emphasis.',
        border: 'Use to define structure, not decoration.',
      },
      constraints: [
        'Do not introduce additional saturated accent colors without justification.',
        'Do not use blue-purple gradients.',
        'Do not use gradient text.',
        'Do not use accent color as a general-purpose fill.',
      ],
    },
    contrast: {
      hierarchy: [
        'primary content',
        'secondary content',
        'metadata',
        'structural elements',
      ],
      rule: 'Contrast should establish hierarchy rather than simply maximize visual intensity.',
    },
  },
  typography: designSpecTypographyFromSystem(defaultFontTrio()),
  layout_system: {
    max_width: '1180px',
    grid: {
      desktop: '12 columns',
      tablet: '8 columns',
      mobile: '4 columns',
      gutter_desktop: '24px',
      gutter_mobile: '16px',
    },
    spacing_unit: '8px',
    section_spacing: {
      desktop: 'clamp(96px, 12vw, 180px)',
      mobile: '72px',
    },
    alignment: {
      primary: 'left-aligned',
      secondary: 'intentional asymmetry',
      rule: 'Asymmetry is allowed only when it strengthens hierarchy or product storytelling.',
    },
    composition_rules: [
      'Avoid evenly distributing every element.',
      'Use intentional negative space.',
      'Establish a clear visual anchor in every major section.',
      'Do not create card grids merely to fill space.',
      'Use full-width compositions when they strengthen the product story.',
    ],
  },
  navigation: {
    strategy: 'minimal product-oriented navigation',
    structure: ['brand', 'product', 'documentation', 'pricing', 'primary_cta'],
    behavior: {
      desktop: 'horizontal',
      mobile: 'compact navigation with deliberate menu interaction',
      sticky: true,
    },
    visual_style: {
      height: '64-80px',
      background: 'transparent or subtly separated from canvas',
      border: 'minimal',
    },
    rules: [
      'Navigation must not visually compete with the hero.',
      'CTA should be obvious without looking like a generic SaaS pill.',
      'Avoid excessive navigation items.',
    ],
  },
  hero: {
    strategy: 'brand-first product explanation',
    priority_order: [
      'brand/product identity',
      'value proposition',
      'product visualization',
      'primary action',
    ],
    headline: {
      treatment: 'dominant',
      max_lines: 3,
      preferred_length: '2-8 words',
      rule: 'The headline should be memorable without requiring a paragraph to understand.',
    },
    supporting_copy: {
      max_width: '560px',
      max_lines: 3,
      density: 'low',
    },
    composition: {
      type: 'editorial product composition',
      alignment: 'left',
      visual_anchor: 'custom corridor map',
      negative_space: 'high',
      above_fold_requirement:
        'headline, value proposition, CTA and core product visual must establish the product story without scrolling',
    },
    visual_concept: {
      type: 'custom SVG contour map',
      purpose: 'Explain climate-aware routing rather than decorate the page.',
      required: true,
    },
    cta: {
      primary: 'Start a corridor brief',
      secondary: 'Explore the map',
      style: 'strong but restrained',
      avoid: ['oversized pill buttons', 'gradient buttons', 'glowing buttons'],
    },
  },
  signature_element: {
    type: 'custom SVG corridor map',
    purpose: 'Communicate delay risk along a freight corridor at a glance.',
    requirements: [
      'Must represent an actual product concept.',
      'Must have meaningful hierarchy.',
      'Must remain understandable without animation.',
      'Must work at desktop and mobile sizes.',
      'Must not resemble generic network-node artwork.',
    ],
    visual_language: {
      nodes: 'minimal geometric forms',
      connections: 'thin controlled lines',
      labels: 'IBM Plex Mono',
      active_signal: 'accent color',
      inactive_elements: 'muted foreground/border',
    },
    animation: {
      initial_state: 'quiet',
      sequence: [
        'diagram structure appears',
        'connections draw',
        'single copper signal travels through the corridor',
      ],
      duration: '1.2-2.0s',
      easing: 'ease-out',
      repeat: false,
    },
  },
  information_architecture: {
    sections: [
      { id: 'hero', purpose: 'Immediately establish product identity and value.' },
      { id: 'problem', purpose: 'Explain freight delay pain.' },
      { id: 'product', purpose: 'Show how Northline maps corridor risk.' },
      { id: 'workflow', purpose: 'Visualize the brief workflow.' },
      { id: 'proof', purpose: 'Provide credibility through measurable evidence.' },
      { id: 'cta', purpose: 'Convert understanding into action.' },
    ],
    section_rule:
      'Every section must have a distinct communication purpose. Remove sections that only exist because landing pages traditionally contain them.',
  },
  content_system: {
    voice: {
      tone: ['direct', 'precise', 'confident', 'technical', 'human'],
      avoid: [
        'revolutionary',
        'game-changing',
        'next-generation',
        'AI-powered',
        'unlock your potential',
        'everything you need',
      ],
    },
    copy_rules: [
      'Prefer concrete product language.',
      'Describe outcomes rather than vague capabilities.',
      'Avoid unnecessary marketing adjectives.',
      'Do not invent statistics.',
      'Do not use filler copy merely to balance layouts.',
    ],
  },
  component_system: {
    buttons: {
      style: 'compact and deliberate',
      radius: '4-8px',
      height: '44-48px',
      primary: 'solid high-contrast',
      secondary: 'text or outlined',
      hover: 'subtle movement or contrast shift',
      avoid: ['giant pills', 'neon glow', 'gradient fills'],
    },
    cards: {
      default: 'avoid unless information architecture requires grouping',
      radius: '8-12px',
      border: 'subtle',
      shadow: 'minimal',
      rule: 'Cards must represent meaningful conceptual boundaries.',
    },
    badges: {
      font: 'IBM Plex Mono',
      style: 'technical',
      radius: '4px',
    },
    inputs: {
      height: '44-48px',
      focus: 'accent-derived focus treatment',
      states: ['default', 'hover', 'focus', 'error', 'disabled'],
    },
  },
  product_visualization: {
    priority: 'very_high',
    principle:
      'Show the product doing something rather than displaying a generic dashboard screenshot.',
    preferred_forms: [
      'workflow diagrams',
      'system graphs',
      'structured data views',
      'interactive product simulations',
    ],
    avoid: [
      'fake dashboard statistics',
      'generic analytics charts',
      'floating glass cards',
      'abstract 3D objects',
      'stock photography',
    ],
  },
  responsive_design: {
    principle: 'Recompose rather than simply stack.',
    desktop: {
      width: '>= 1024px',
      composition: 'full editorial composition',
    },
    tablet: {
      width: '768px-1023px',
      rule: 'Reduce spatial complexity while preserving hierarchy.',
    },
    mobile: {
      width: '< 768px',
      rule: 'Preserve the visual idea, not necessarily the desktop geometry.',
    },
    mobile_rules: [
      'Do not simply shrink desktop typography.',
      'Preserve the hero visual anchor.',
      'Collapse diagrams intelligently.',
      'Remove non-essential decoration.',
      'Maintain strong typography hierarchy.',
      'Ensure CTA remains immediately accessible.',
    ],
  },
  motion: {
    philosophy: 'Motion communicates system behavior, not decoration.',
    allowed: [
      'diagram draw-in',
      'signal propagation',
      'CTA emphasis',
      'subtle product-state transitions',
      'navigation state transitions',
    ],
    timing: {
      micro: '120-200ms',
      standard: '200-400ms',
      hero: '800-1600ms',
    },
    rules: [
      'Motion must have a reason.',
      'Do not animate every section.',
      'Do not use scroll-triggered fade-ins everywhere.',
      'Do not use decorative particle fields.',
      'Respect prefers-reduced-motion.',
    ],
  },
  interaction_design: {
    required_states: [
      'default',
      'hover',
      'focus',
      'active',
      'disabled',
      'loading',
      'success',
      'error',
      'empty',
    ],
    interaction_principle:
      'Interactions should reveal product behavior or provide useful feedback.',
    hover: {
      intensity: 'subtle',
      avoid: ['large transforms', 'glow effects', 'bouncy animations'],
    },
  },
  accessibility: {
    requirements: [
      'WCAG-conscious contrast',
      'keyboard navigation',
      'visible focus states',
      'semantic HTML',
      'reduced motion support',
      'meaningful aria labels',
      'touch targets of appropriate size',
    ],
  },
  imagery: {
    strategy: 'Prefer product-specific visual systems over decorative imagery.',
    priority: [
      'custom SVG',
      'CSS composition',
      'real product UI',
      'purpose-built illustration',
      'photography only when conceptually justified',
    ],
    avoid: [
      'stock imagery',
      'generic AI artwork',
      'decorative 3D blobs',
      'AI-generated human imagery',
      'unrelated photography',
    ],
  },
  iconography: {
    style: 'minimal technical',
    source: 'custom SVG preferred',
    rules: [
      'Icons should communicate meaning.',
      'Do not create icon grids simply because they are visually convenient.',
      'Avoid generic Lucide icon feature grids.',
      'Icons should share stroke weight and visual geometry.',
    ],
  },
  technical_implementation: {
    preferred: [
      'semantic HTML',
      'CSS variables',
      'CSS Grid',
      'Flexbox',
      'inline SVG',
      'CSS animations',
    ],
    avoid: [
      'unnecessary animation libraries',
      'Three.js unless product value clearly requires it',
      'massive dependency additions',
      'hardcoded repeated styles',
      'canvas for simple diagrams',
    ],
    svg_rules: [
      'Prefer hand-designed SVG compositions.',
      'Use reusable SVG components.',
      'Keep SVG geometry responsive.',
      'Do not embed raster images into SVG when vector geometry is sufficient.',
    ],
  },
  performance: {
    requirements: [
      'fast initial render',
      'avoid unnecessary JavaScript',
      'lazy-load non-critical assets',
      'avoid expensive continuous animations',
      'avoid large decorative assets',
    ],
    priority: 'Visual quality must not come from excessive runtime complexity.',
  },
  design_anti_patterns: {
    explicitly_prohibited: [...DEFAULT_AVOID_LIST],
  },
  references: {
    provided: ['cartographic UI', 'instrument panel density below fold'],
    reference_usage: {
      rule: 'References should influence composition, typography, interaction or visual language, but must not be copied literally.',
      priority: [
        'composition',
        'spacing',
        'typography',
        'interaction',
        'visual metaphor',
      ],
    },
  },
  design_decisions: {
    locked: [
      'paper editorial canvas',
      'Syne + Manrope + IBM Plex Mono',
      'restrained copper accent',
      'custom corridor map',
      'minimal motion',
    ],
    flexible: [
      'exact section ordering',
      'diagram geometry',
      'CTA wording',
      'secondary component treatment',
    ],
    unresolved: [],
  },
  quality_bar: {
    evaluation_questions: [
      'Can the product be understood within five seconds?',
      'Does the page look designed specifically for this product?',
      'Is there a memorable visual idea?',
      'Does the hero communicate both brand and functionality?',
      'Is the visual hierarchy obvious?',
      'Does the page avoid generic AI SaaS patterns?',
      'Does the product visualization explain something real?',
      'Does typography contribute to the identity?',
      'Is negative space intentional?',
      'Does mobile preserve the design concept?',
      'Are interactions purposeful?',
      'Does the design feel credible to its target audience?',
    ],
    failure_conditions: [
      'The page could belong to any AI startup.',
      'The hero is primarily decorative.',
      'The design relies on gradients to create visual interest.',
      'Every section uses the same card pattern.',
      'The product is explained primarily through marketing copy.',
      'The visual system has no recognizable signature element.',
      'The page feels like a generated template.',
    ],
    minimum_quality_threshold: {
      visual_identity: 8,
      product_clarity: 9,
      composition: 8,
      typography: 8,
      interaction: 7,
      responsive_design: 8,
      technical_quality: 8,
    },
  },
  generation_directive: {
    instruction:
      'Treat this document as a design system and art-direction contract, not as a loose suggestion.',
    before_coding: [
      'Identify the dominant visual idea.',
      'Establish the hierarchy.',
      'Determine the hero composition.',
      'Define the product visualization.',
      'Determine section rhythm.',
      'Resolve responsive behavior.',
      'Identify reusable visual primitives.',
    ],
    during_coding: [
      'Preserve the intended composition.',
      'Do not substitute generic components for custom visual concepts.',
      'Do not introduce visual patterns prohibited by this specification.',
      'Prefer fewer stronger elements over many weaker elements.',
    ],
    after_coding: [
      'Visually inspect the entire page.',
      'Check hierarchy at first glance.',
      'Check mobile composition.',
      'Remove redundant decoration.',
      'Check typography consistency.',
      'Check all interaction states.',
      'Compare the final result against the quality bar.',
    ],
    final_principle:
      'Make the interface feel authored by a strong product designer, not assembled from a component library.',
  },
  notes: [
    'EXAMPLE ONLY — invent a different metaphor/palette/product for the real USER REQUEST',
  ],
};

export const DESIGN_DIRECTOR_SYSTEM = `You are Singularity's Design Director (DeepSeek V4 Flash-0731).
You OWN visual identity and art direction ONLY.

You MUST NOT:
- Write React/HTML/CSS/Tailwind implementation code
- Choose npm packages or scaffold projects
- Emit file diffs or component source
- Copy the EXAMPLE product name, colors, fonts, or metaphor — invent for THIS user request

You MUST:
- Read the ACTIVE AGENCY SKILL (when provided) and apply that specialist's expertise, mission, and critical rules
- Read the EXAMPLE Design Spec for structure and quality depth (version 2 sheet)
- Produce a NEW Design Specification JSON tailored to the USER REQUEST
- Match the EXAMPLE's key structure and depth (meta, product, design_strategy, visual_identity, typography, layout_system, navigation, hero, signature_element, information_architecture, content_system, component_system, product_visualization, responsive_design, motion, interaction_design, accessibility, imagery, iconography, technical_implementation, performance, design_anti_patterns, references, design_decisions, quality_bar, generation_directive)
- Change art direction every time the user request changes (unique metaphor, palette, signature)
- Ban generic AI/SaaS defaults unless the product metaphor explicitly justifies them
- Require at least one signature visual that communicates what THIS product does
- Prefer custom SVG / diagrams / data viz / CSS compositions over decorative 3D
- Typography: choose ONE typography system from the catalog below, then lock the FULL system into the Spec:
  faces + weight_distribution + letter_spacing + line_height + scale + measure + heading_proportions + mono_usage + rules.
  Default Singularity identity = experimental → Syne + Manrope + IBM Plex Mono (+ its metrics).
  Inter / Geist / Geist Mono are allowed ONLY when that personality lists them.
  Never Roboto / Arial / system-ui as the distinctive display face.
  Do NOT only swap font families — each Spec must produce a recognizably different typographic brand.

${formatFontPersonalityCatalog()}

${FRONTEND_TASTE_RULES}

Return ONLY valid JSON matching the Design Specification v2 schema (no markdown fences unless necessary).`;

export interface DesignDirectorInput {
  goal: string;
  productDescription?: string;
  frontendRequirements?: string;
  existingDna?: DesignDna;
  existingUiSummary?: string;
  brandAssetsSummary?: string;
  designReferenceHints?: string;
  screenshotNotes?: string;
  /** Selected agency-agents skill to mix with the Spec template. */
  agencySkill?: AgencySkill;
  /** Pre-formatted skill block (Agent path may pass this instead of AgencySkill). */
  agencySkillPrompt?: string;
}

export interface DesignDirectorLlm {
  complete(req: {
    systemPrompt: string;
    prompt: string;
    modelId?: string;
    temperature?: number;
    preferredTier?: string;
  }): Promise<{ text: string; modelId: string; tokensUsed: number }>;
}

export interface DesignDirectorResult {
  spec: DesignSpecification;
  modelId: string;
  tokensUsed: number;
  promptBlock: string;
}

/**
 * User message: EXAMPLE Spec v2 + USER REQUEST (DeepSeek Flash-0731).
 * Specs must vary with the user prompt; example is structure/quality only.
 */
export function buildDesignDirectorUserPrompt(
  userRequest: string,
  extra?: Omit<DesignDirectorInput, 'goal'>,
): string {
  const skillBlock =
    extra?.agencySkillPrompt ??
    (extra?.agencySkill
      ? formatAgencySkillForPrompt(extra.agencySkill)
      : undefined);

  const blocks: string[] = [];

  if (skillBlock) {
    blocks.push(
      skillBlock,
      '',
      'Use the ACTIVE AGENCY SKILL above as the specialist lens for art direction.',
      'Then fill the Design Spec template below for the USER REQUEST.',
      '',
    );
  }

  blocks.push(
    'EXAMPLE Design Specification v2 (structure + quality reference ONLY).',
    'Design something similar in depth and originality — but for the USER REQUEST below.',
    'Do NOT copy Northline, copper, cream paper, or the freight-map metaphor unless the user request is literally that product.',
    'Typography: choose ONE full typography system (faces + weights + tracking + leading + scale + mono usage); default experimental.',
    'Fill every major section of the v2 sheet with product-specific decisions derived from the USER REQUEST.',
    '',
    '```json',
    JSON.stringify(EXAMPLE_DESIGN_SPEC, null, 2),
    '```',
    '',
    'USER REQUEST (invent a unique Design Spec v2 for this):',
    userRequest.trim(),
  );

  if (extra?.productDescription) {
    blocks.push('', `Product description:\n${extra.productDescription}`);
  }
  if (extra?.frontendRequirements) {
    blocks.push('', `Frontend requirements:\n${extra.frontendRequirements}`);
  }
  if (extra?.existingDna) {
    blocks.push('', `Existing Design DNA:\n${formatDnaForPrompt(extra.existingDna)}`);
  }
  if (extra?.existingUiSummary) {
    blocks.push('', `Existing UI / screens:\n${extra.existingUiSummary}`);
  }
  if (extra?.brandAssetsSummary) {
    blocks.push('', `Brand assets:\n${extra.brandAssetsSummary}`);
  }
  if (extra?.screenshotNotes) {
    blocks.push('', `Screenshot / visual notes:\n${extra.screenshotNotes}`);
  }
  if (extra?.designReferenceHints) {
    blocks.push(
      '',
      `Retrieved design reference hints (inspiration only):\n${extra.designReferenceHints}`,
    );
  }

  blocks.push(
    '',
    'Emit Design Specification JSON with version: 2 and the same top-level keys as the EXAMPLE.',
    'signature_element MUST be product-specific — not a decorative blob.',
    'Make choices that would clearly change if the USER REQUEST changed.',
  );

  return blocks.join('\n');
}

/** @deprecated Use buildDesignDirectorUserPrompt */
export const buildNemotronDesignDirectorUserPrompt = buildDesignDirectorUserPrompt;

/**
 * Run the Design Director LLM and validate the Design Specification.
 */
export async function runDesignDirector(
  input: DesignDirectorInput,
  llm: DesignDirectorLlm,
): Promise<DesignDirectorResult> {
  const prompt = buildDesignDirectorPrompt(input);
  const completion = await llm.complete({
    systemPrompt: DESIGN_DIRECTOR_SYSTEM,
    prompt,
    modelId: DESIGN_DIRECTOR_MODEL_ID,
    temperature: 0.75,
    preferredTier: 'T0',
  });
  const spec = parseDesignSpecJson(completion.text);
  return {
    spec,
    modelId: completion.modelId,
    tokensUsed: completion.tokensUsed,
    promptBlock: formatDesignSpecForPrompt(spec),
  };
}

export function buildDesignDirectorPrompt(input: DesignDirectorInput): string {
  const { goal, ...extra } = input;
  return buildDesignDirectorUserPrompt(goal, extra);
}

export function designSpecPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.singularity', DESIGN_SPEC_FILENAME);
}

/** Workspace-relative path for WorkspacePort read/write (never absolute). */
export const DESIGN_SPEC_RELATIVE_PATH = `.singularity/${DESIGN_SPEC_FILENAME}`;

/** Persist Design Spec JSON under .singularity/ */
export async function saveDesignSpec(
  workspaceRoot: string,
  spec: DesignSpecification,
  writeFile: (path: string, content: string) => Promise<void> | void,
): Promise<string> {
  const rel = DESIGN_SPEC_RELATIVE_PATH;
  const body = `${JSON.stringify({ ...spec, version: 2, createdAt: Date.now() }, null, 2)}\n`;
  await writeFile(rel, body);
  return designSpecPath(workspaceRoot);
}

/**
 * Persist only when no Spec exists yet. Returns `{ path, wrote }`.
 */
export async function saveDesignSpecIfAbsent(
  workspaceRoot: string,
  spec: DesignSpecification,
  readFile: (path: string) => Promise<string | undefined>,
  writeFile: (path: string, content: string) => Promise<void> | void,
): Promise<{ path: string; wrote: boolean }> {
  const existing = await loadDesignSpec(workspaceRoot, readFile);
  const path = designSpecPath(workspaceRoot);
  if (existing) {
    return { path, wrote: false };
  }
  await saveDesignSpec(workspaceRoot, spec, writeFile);
  return { path, wrote: true };
}

export async function loadDesignSpec(
  workspaceRoot: string,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<DesignSpecification | undefined> {
  // Prefer relative path — VS Code WorkspacePort joins against the folder root.
  // Absolute paths were previously double-joined and silently missed existing specs.
  const candidates = [DESIGN_SPEC_RELATIVE_PATH, designSpecPath(workspaceRoot)];
  for (const path of candidates) {
    const text = await readFile(path);
    if (!text) {
      continue;
    }
    try {
      return validateDesignSpec(JSON.parse(text) as Record<string, unknown>);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Ownership boundary helper for tests / routing. */
export function designDirectorMayWritePath(path: string): boolean {
  return (
    path.endsWith(DESIGN_SPEC_FILENAME) ||
    path.includes('/.singularity/design-spec') ||
    path.endsWith('design-spec.json') ||
    path.endsWith(SKILL_ARTIFACT_FILENAME) ||
    path.includes('/.singularity/skill')
  );
}

export function designDirectorOwnsImplementation(): boolean {
  return false;
}
