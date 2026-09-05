/**
 * Structured Design Specification v2 — output of the Design Director.
 * Art-direction contract that the frontend implementer follows (does not invent).
 */

import {
  defaultFontTrio,
  designSpecTypographyFromSystem,
  resolveFontPersonality,
} from './fontPersonalities.js';

export const DESIGN_SPEC_FILENAME = 'design-spec.json';
export const DESIGN_SPEC_VERSION = 2 as const;

export const DEFAULT_AVOID_LIST = [
  'generic AI SaaS landing page',
  'blue-purple gradients',
  'dark zinc + purple defaults',
  'glassmorphism everywhere',
  'floating gradient blobs',
  'decorative 3D spheres',
  'particle backgrounds',
  'generic dashboard hero',
  'three-column feature card grids',
  'Lucide icon feature grids',
  'Inter/Geist as lazy default (only when Spec font personality lists them)',
  'oversized pill buttons',
  'gradient text',
  'excessive rounded cards',
  'fade-in on every section',
  'stock illustrations',
  'fake statistics',
  'AI buzzword-heavy copy',
  'Everything you need to build...',
] as const;

export interface DesignSpecMeta {
  spec_type: string;
  design_intent: string;
  design_priority: string[];
  decision_rule: string;
}

export interface DesignSpecAudience {
  primary: string;
  secondary: string[];
  technical_level: string;
}

export interface DesignSpecBrandPersonality {
  should_feel: string[];
  should_not_feel: string[];
}

export interface DesignSpecConversionGoal {
  primary: string;
  secondary: string;
}

export interface DesignSpecProduct {
  name: string;
  category: string;
  audience: DesignSpecAudience;
  product_character: string[];
  brand_promise: string;
  brand_personality: DesignSpecBrandPersonality;
  primary_user_action: string;
  conversion_goal: DesignSpecConversionGoal;
}

export interface DesignSpecCentralIdea {
  statement: string;
  visual_metaphor: string;
  principle: string;
}

export interface DesignSpecDesignLanguage {
  keywords: string[];
  density: string;
  visual_complexity: string;
  surface_treatment: string;
  ornamentation: string;
}

export interface DesignSpecDifferentiator {
  description: string;
  requirement: string;
}

export interface DesignSpecStrategy {
  concept: string;
  central_idea: DesignSpecCentralIdea;
  design_language: DesignSpecDesignLanguage;
  design_differentiator: DesignSpecDifferentiator;
}

export interface DesignSpecColorUsageRules {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  border: string;
}

export interface DesignSpecColor {
  background: string;
  foreground: string;
  primary: string;
  accent: string;
  muted: string;
  border: string;
  usage_rules: DesignSpecColorUsageRules;
  constraints: string[];
}

export interface DesignSpecContrast {
  hierarchy: string[];
  rule: string;
}

export interface DesignSpecVisualIdentity {
  color: DesignSpecColor;
  contrast: DesignSpecContrast;
}

export interface DesignSpecTypeFace {
  family: string;
  role: string;
  character?: string;
  weight_range: string;
  default_weight?: string;
  letter_spacing?: string;
  line_height?: string;
}

export interface DesignSpecTypeScale {
  hero: { desktop: string; mobile: string };
  h2: string;
  h3: string;
  body: string;
  small: string;
  technical: string;
}

export interface DesignSpecMonoUsage {
  used_for: string[];
  avoid_for: string[];
  size: string;
  case_style: string;
  presence: 'sparse' | 'balanced' | 'prominent' | string;
}

export interface DesignSpecTypography {
  /** Personality id from the typography system catalog. */
  personality?: string;
  pairing_rationale?: string;
  weight_distribution?: string;
  measure?: string;
  heading_proportions?: string;
  display: DesignSpecTypeFace;
  body: DesignSpecTypeFace;
  technical: DesignSpecTypeFace;
  scale: DesignSpecTypeScale;
  mono_usage?: DesignSpecMonoUsage;
  rules: string[];
}

export interface DesignSpecGrid {
  desktop: string;
  tablet: string;
  mobile: string;
  gutter_desktop: string;
  gutter_mobile: string;
}

export interface DesignSpecLayoutSystem {
  max_width: string;
  grid: DesignSpecGrid;
  spacing_unit: string;
  section_spacing: { desktop: string; mobile: string };
  alignment: { primary: string; secondary: string; rule: string };
  composition_rules: string[];
}

export interface DesignSpecNavigation {
  strategy: string;
  structure: string[];
  behavior: { desktop: string; mobile: string; sticky: boolean };
  visual_style: { height: string; background: string; border: string };
  rules: string[];
}

export interface DesignSpecHero {
  strategy: string;
  priority_order: string[];
  headline: {
    treatment: string;
    max_lines: number;
    preferred_length: string;
    rule: string;
  };
  supporting_copy: { max_width: string; max_lines: number; density: string };
  composition: {
    type: string;
    alignment: string;
    visual_anchor: string;
    negative_space: string;
    above_fold_requirement: string;
  };
  visual_concept: { type: string; purpose: string; required: boolean };
  cta: {
    primary: string;
    secondary: string;
    style: string;
    avoid: string[];
  };
}

export interface DesignSpecSignatureElement {
  type: string;
  purpose: string;
  requirements: string[];
  visual_language: {
    nodes: string;
    connections: string;
    labels: string;
    active_signal: string;
    inactive_elements: string;
  };
  animation: {
    initial_state: string;
    sequence: string[];
    duration: string;
    easing: string;
    repeat: boolean;
  };
}

export interface DesignSpecSection {
  id: string;
  purpose: string;
}

export interface DesignSpecInformationArchitecture {
  sections: DesignSpecSection[];
  section_rule: string;
}

export interface DesignSpecContentSystem {
  voice: { tone: string[]; avoid: string[] };
  copy_rules: string[];
}

export interface DesignSpecComponentSystem {
  buttons: Record<string, unknown>;
  cards: Record<string, unknown>;
  badges: Record<string, unknown>;
  inputs: Record<string, unknown>;
}

export interface DesignSpecProductVisualization {
  priority: string;
  principle: string;
  preferred_forms: string[];
  avoid: string[];
}

export interface DesignSpecResponsive {
  principle: string;
  desktop: { width: string; composition: string };
  tablet: { width: string; rule: string };
  mobile: { width: string; rule: string };
  mobile_rules: string[];
}

export interface DesignSpecMotion {
  philosophy: string;
  allowed: string[];
  timing: { micro: string; standard: string; hero: string };
  rules: string[];
}

export interface DesignSpecInteraction {
  required_states: string[];
  interaction_principle: string;
  hover: { intensity: string; avoid: string[] };
}

export interface DesignSpecAccessibility {
  requirements: string[];
}

export interface DesignSpecImagery {
  strategy: string;
  priority: string[];
  avoid: string[];
}

export interface DesignSpecIconography {
  style: string;
  source: string;
  rules: string[];
}

export interface DesignSpecTechnicalImplementation {
  preferred: string[];
  avoid: string[];
  svg_rules: string[];
}

export interface DesignSpecPerformance {
  requirements: string[];
  priority: string;
}

export interface DesignSpecAntiPatterns {
  explicitly_prohibited: string[];
}

export interface DesignSpecReferences {
  provided: string[];
  reference_usage: { rule: string; priority: string[] };
}

export interface DesignSpecDecisions {
  locked: string[];
  flexible: string[];
  unresolved: string[];
}

export interface DesignSpecQualityBar {
  evaluation_questions: string[];
  failure_conditions: string[];
  minimum_quality_threshold: Record<string, number>;
}

export interface DesignSpecGenerationDirective {
  instruction: string;
  before_coding: string[];
  during_coding: string[];
  after_coding: string[];
  final_principle: string;
}

/** Canonical Design Specification (v2). */
export interface DesignSpecification {
  version: typeof DESIGN_SPEC_VERSION;
  meta: DesignSpecMeta;
  product: DesignSpecProduct;
  design_strategy: DesignSpecStrategy;
  visual_identity: DesignSpecVisualIdentity;
  typography: DesignSpecTypography;
  layout_system: DesignSpecLayoutSystem;
  navigation: DesignSpecNavigation;
  hero: DesignSpecHero;
  signature_element: DesignSpecSignatureElement;
  information_architecture: DesignSpecInformationArchitecture;
  content_system: DesignSpecContentSystem;
  component_system: DesignSpecComponentSystem;
  product_visualization: DesignSpecProductVisualization;
  responsive_design: DesignSpecResponsive;
  motion: DesignSpecMotion;
  interaction_design: DesignSpecInteraction;
  accessibility: DesignSpecAccessibility;
  imagery: DesignSpecImagery;
  iconography: DesignSpecIconography;
  technical_implementation: DesignSpecTechnicalImplementation;
  performance: DesignSpecPerformance;
  design_anti_patterns: DesignSpecAntiPatterns;
  references: DesignSpecReferences;
  design_decisions: DesignSpecDecisions;
  quality_bar: DesignSpecQualityBar;
  generation_directive: DesignSpecGenerationDirective;
  /** Free-form notes (Director / tooling). */
  notes?: string[];
  createdAt?: number;
}

/** Soft thresholds — critic FAIL when exceeded / missed. */
export interface VisualQaThresholds {
  maxGenericness: number;
  minBrandDistinctiveness: number;
  minProductCommunication: number;
  maxVisualIterations: number;
}

export const DEFAULT_VISUAL_QA_THRESHOLDS: VisualQaThresholds = {
  maxGenericness: 35,
  minBrandDistinctiveness: 65,
  minProductCommunication: 65,
  maxVisualIterations: 3,
};

// ── Accessors (stable for DNA / knowledge / prompts) ─────────────────────────

export function specProductName(spec: DesignSpecification): string {
  return spec.product.name;
}

export function specProductCategory(spec: DesignSpecification): string {
  return spec.product.category;
}

export function specAudiencePrimary(spec: DesignSpecification): string {
  return spec.product.audience.primary;
}

export function specPersonality(spec: DesignSpecification): string {
  return (
    spec.product.product_character.join(', ') ||
    spec.product.brand_personality.should_feel.join(', ')
  );
}

export function specConcept(spec: DesignSpecification): string {
  return spec.design_strategy.concept;
}

export function specVisualMetaphor(spec: DesignSpecification): string {
  return spec.design_strategy.central_idea.visual_metaphor;
}

export function specDesignLanguage(spec: DesignSpecification): string {
  return spec.design_strategy.design_language.keywords.join(', ');
}

export function specDisplayFamily(spec: DesignSpecification): string {
  return spec.typography.display.family;
}

export function specBodyFamily(spec: DesignSpecification): string {
  return spec.typography.body.family;
}

export function specTechnicalFamily(spec: DesignSpecification): string {
  return spec.typography.technical.family;
}

export function specColorBackground(spec: DesignSpecification): string {
  return spec.visual_identity.color.background;
}

export function specColorForeground(spec: DesignSpecification): string {
  return spec.visual_identity.color.foreground;
}

export function specColorAccent(spec: DesignSpecification): string {
  return spec.visual_identity.color.accent;
}

export function specColorMuted(spec: DesignSpecification): string {
  return spec.visual_identity.color.muted;
}

export function specColorBorder(spec: DesignSpecification): string {
  return spec.visual_identity.color.border;
}

export function specHeroStrategy(spec: DesignSpecification): string {
  return spec.hero.strategy;
}

export function specHeroVisual(spec: DesignSpecification): string {
  return `${spec.hero.visual_concept.type} — ${spec.hero.visual_concept.purpose}`;
}

export function specSignatureType(spec: DesignSpecification): string {
  return spec.signature_element.type;
}

export function specSignaturePurpose(spec: DesignSpecification): string {
  return spec.signature_element.purpose;
}

export function specAvoidList(spec: DesignSpecification): string[] {
  return spec.design_anti_patterns.explicitly_prohibited.length
    ? spec.design_anti_patterns.explicitly_prohibited
    : [...DEFAULT_AVOID_LIST];
}

export function specMotionPhilosophy(spec: DesignSpecification): string {
  return spec.motion.philosophy;
}

export function specImageryStrategy(spec: DesignSpecification): string {
  return spec.imagery.strategy;
}

export function defaultMeta(): DesignSpecMeta {
  return {
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
  };
}

function defaultTypography(
  trio: ReturnType<typeof defaultFontTrio> = defaultFontTrio(),
): DesignSpecTypography {
  return designSpecTypographyFromSystem(trio);
}

/**
 * Migrate legacy v1 Spec shapes into v2.
 * Accepts both flat string typography and nested family objects.
 */
function isV2Shape(raw: Record<string, unknown>): boolean {
  if (raw.version === 2 || raw.design_strategy || raw.visual_identity || raw.meta) {
    return true;
  }
  const type = raw.typography as { display?: unknown } | undefined;
  if (type?.display && typeof type.display === 'object') {
    return true;
  }
  return false;
}

export function migrateLegacyDesignSpec(raw: Record<string, unknown>): Partial<DesignSpecification> {
  if (isV2Shape(raw)) {
    return raw as Partial<DesignSpecification>;
  }

  const product = (raw.product ?? {}) as Record<string, unknown>;
  const art = (raw.art_direction ?? {}) as Record<string, unknown>;
  const color = (raw.color ?? {}) as Record<string, unknown>;
  const type = (raw.typography ?? {}) as Record<string, unknown>;
  const layout = (raw.layout ?? {}) as Record<string, unknown>;
  const hero = (raw.hero ?? {}) as Record<string, unknown>;
  const sig = (raw.signature_element ?? {}) as Record<string, unknown>;
  const motion = (raw.motion ?? {}) as Record<string, unknown>;
  const imagery = (raw.imagery ?? {}) as Record<string, unknown>;
  const avoid = Array.isArray(raw.avoid) ? (raw.avoid as string[]) : [...DEFAULT_AVOID_LIST];

  const face = (v: unknown, fallback: string): string => {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && typeof (v as { family?: string }).family === 'string') {
      return (v as { family: string }).family;
    }
    return fallback;
  };

  const audienceStr =
    typeof product.audience === 'string'
      ? product.audience
      : ((product.audience as { primary?: string } | undefined)?.primary ?? 'users');

  const personalityHints = String(product.personality ?? art.design_language ?? '')
    .split(/[,;/]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const trio = resolveFontPersonality({
    category: String(product.category ?? ''),
    shouldFeel: personalityHints,
    designKeywords: String(art.design_language ?? '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean),
    density: String(layout.density ?? ''),
    productCharacter: personalityHints,
  });

  return {
    version: 2,
    meta: defaultMeta(),
    product: {
      name: String(product.name ?? 'Product'),
      category: String(product.category ?? 'software product'),
      audience: {
        primary: audienceStr,
        secondary: [],
        technical_level: 'intermediate',
      },
      product_character: String(product.personality ?? 'deliberate')
        .split(/[,/]/)
        .map((s) => s.trim())
        .filter(Boolean),
      brand_promise: String(art.concept ?? ''),
      brand_personality: {
        should_feel: String(product.personality ?? 'deliberate')
          .split(/[,/]/)
          .map((s) => s.trim())
          .filter(Boolean),
        should_not_feel: ['generic', 'template-generated'],
      },
      primary_user_action: 'Understand the product and start using it.',
      conversion_goal: { primary: 'Get started', secondary: 'Explore' },
    },
    design_strategy: {
      concept: String(art.concept ?? ''),
      central_idea: {
        statement: String(art.concept ?? ''),
        visual_metaphor: String(art.visual_metaphor ?? ''),
        principle:
          'Every major visual element should either communicate product functionality, hierarchy, or brand.',
      },
      design_language: {
        keywords: String(art.design_language ?? '')
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean),
        density: String(layout.density ?? 'medium'),
        visual_complexity: 'controlled',
        surface_treatment: 'minimal',
        ornamentation: 'low',
      },
      design_differentiator: {
        description: 'Avoid generic AI SaaS templates; product workflow becomes visual identity.',
        requirement:
          'At least one major composition must be impossible to mistake for a generic SaaS template.',
      },
    },
    visual_identity: {
      color: {
        background: String(color.background ?? ''),
        foreground: String(color.foreground ?? ''),
        primary: String(color.primary ?? color.background ?? ''),
        accent: String(color.accent ?? ''),
        muted: String(color.muted ?? ''),
        border: String(color.border ?? color.borders ?? ''),
        usage_rules: {
          background: 'Use as the dominant canvas.',
          foreground: 'Primary text and high-priority interface elements.',
          muted: 'Secondary information only.',
          accent: 'Use sparingly for actions, active states, and emphasis.',
          border: 'Use to define structure, not decoration.',
        },
        constraints: [
          'Do not introduce additional saturated accent colors without justification.',
          'Do not use blue-purple gradients.',
          'Do not use gradient text.',
        ],
      },
      contrast: {
        hierarchy: ['primary content', 'secondary content', 'metadata', 'structural elements'],
        rule: 'Contrast should establish hierarchy rather than simply maximize visual intensity.',
      },
    },
    typography: {
      ...defaultTypography(trio),
      display: {
        ...defaultTypography(trio).display,
        family: face(type.display, trio.display),
      },
      body: {
        ...defaultTypography(trio).body,
        family: face(type.body, trio.body),
      },
      technical: {
        ...defaultTypography(trio).technical,
        family: face(type.technical, trio.technical),
      },
    },
    layout_system: {
      max_width: String(layout.max_width ?? '1200px'),
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
        String(layout.philosophy ?? 'brand-first hero'),
        'Use intentional negative space.',
        'Establish a clear visual anchor in every major section.',
      ],
    },
    hero: {
      strategy: String(hero.strategy ?? 'brand-first product explanation'),
      priority_order: [
        'brand/product identity',
        'value proposition',
        'product visualization',
        'primary action',
      ],
      headline: {
        treatment: String(hero.headline_treatment ?? 'dominant'),
        max_lines: 3,
        preferred_length: '2-8 words',
        rule: 'The headline should be memorable without requiring a paragraph to understand.',
      },
      supporting_copy: { max_width: '560px', max_lines: 3, density: 'low' },
      composition: {
        type: 'editorial product composition',
        alignment: 'left',
        visual_anchor: String(hero.visual_concept ?? 'custom product diagram'),
        negative_space: 'high',
        above_fold_requirement:
          'headline, value proposition, CTA and core product visual must establish the product story without scrolling',
      },
      visual_concept: {
        type: 'custom SVG / CSS product diagram',
        purpose: String(hero.visual_concept ?? 'Explain the product rather than decorate the page.'),
        required: true,
      },
      cta: {
        primary: 'Get started',
        secondary: 'Explore',
        style: 'strong but restrained',
        avoid: ['oversized pill buttons', 'gradient buttons', 'glowing buttons'],
      },
    },
    signature_element: {
      type: String(sig.type ?? 'custom SVG diagram'),
      purpose: String(sig.description ?? sig.purpose ?? ''),
      requirements: [
        'Must represent an actual product concept.',
        'Must remain understandable without animation.',
        String(sig.relationship_to_product ?? ''),
      ].filter(Boolean),
      visual_language: {
        nodes: 'minimal geometric forms',
        connections: 'thin controlled lines',
        labels: 'IBM Plex Mono',
        active_signal: 'accent color',
        inactive_elements: 'muted foreground/border',
      },
      animation: {
        initial_state: 'quiet',
        sequence: Array.isArray(motion.allowed)
          ? (motion.allowed as string[]).slice(0, 3)
          : ['diagram structure appears'],
        duration: '1.2-2.0s',
        easing: 'ease-out',
        repeat: false,
      },
    },
    imagery: {
      strategy: String(
        (imagery.strategy as string) ??
          'Prefer product-specific visual systems over decorative imagery.',
      ),
      priority: ['custom SVG', 'CSS composition', 'real product UI'],
      avoid: ['stock imagery', 'decorative 3D blobs'],
    },
    motion: {
      philosophy: String(motion.philosophy ?? 'Motion communicates system behavior, not decoration.'),
      allowed: Array.isArray(motion.allowed) ? (motion.allowed as string[]) : [],
      timing: { micro: '120-200ms', standard: '200-400ms', hero: '800-1600ms' },
      rules: Array.isArray(motion.prohibited)
        ? (motion.prohibited as string[]).map((p) => `Do not: ${p}`)
        : ['Motion must have a reason.', 'Respect prefers-reduced-motion.'],
    },
    design_anti_patterns: { explicitly_prohibited: avoid },
    notes: Array.isArray(raw.notes) ? (raw.notes as string[]) : undefined,
  };
}

export function createEmptyDesignSpec(
  partial?: Partial<DesignSpecification> | Record<string, unknown>,
): DesignSpecification {
  const raw = (partial ?? {}) as Record<string, unknown>;
  const rawType = (raw.typography ?? {}) as Record<string, unknown>;
  const faceOf = (v: unknown): string | undefined => {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && typeof (v as { family?: string }).family === 'string') {
      return (v as { family: string }).family;
    }
    return undefined;
  };
  const rawHadExplicitType = Boolean(
    faceOf(rawType.display) || faceOf(rawType.body) || faceOf(rawType.technical),
  );

  const p = migrateLegacyDesignSpec(raw) as Partial<DesignSpecification>;

  const resolvedTrio = resolveFontPersonality({
    category: p.product?.category,
    shouldFeel: p.product?.brand_personality?.should_feel,
    shouldNotFeel: p.product?.brand_personality?.should_not_feel,
    designKeywords: p.design_strategy?.design_language?.keywords,
    density: p.design_strategy?.design_language?.density,
    productCharacter: p.product?.product_character,
  });
  const baseTypo = rawHadExplicitType
    ? defaultTypography()
    : defaultTypography(resolvedTrio);
  let typo: DesignSpecTypography = { ...baseTypo, ...p.typography };
  if (p.typography?.display) {
    typo.display = { ...baseTypo.display, ...p.typography.display };
  }
  if (p.typography?.body) {
    typo.body = { ...baseTypo.body, ...p.typography.body };
  }
  if (p.typography?.technical) {
    typo.technical = {
      ...baseTypo.technical,
      ...p.typography.technical,
    };
  }
  if (p.typography?.scale) {
    typo.scale = {
      ...baseTypo.scale,
      ...p.typography.scale,
      hero: {
        ...baseTypo.scale.hero,
        ...p.typography.scale.hero,
      },
    };
  }
  if (p.typography?.mono_usage) {
    typo.mono_usage = {
      ...baseTypo.mono_usage!,
      ...p.typography.mono_usage,
      used_for: p.typography.mono_usage.used_for ?? baseTypo.mono_usage?.used_for ?? [],
      avoid_for: p.typography.mono_usage.avoid_for ?? baseTypo.mono_usage?.avoid_for ?? [],
    };
  }
  if (!rawHadExplicitType) {
    // Full system — not just faces — so brands diverge in rhythm, not only font names.
    typo = defaultTypography(resolvedTrio);
  }
  const fontLock = `${typo.display.family} + ${typo.body.family} + ${typo.technical.family}`;
  const fontTag = rawHadExplicitType ? undefined : `font:${resolvedTrio.id}`;

  return {
    version: 2,
    meta: { ...defaultMeta(), ...p.meta },
    product: {
      name: p.product?.name ?? 'Product',
      category: p.product?.category ?? 'software product',
      audience: {
        primary: p.product?.audience?.primary ?? 'users',
        secondary: p.product?.audience?.secondary ?? [],
        technical_level: p.product?.audience?.technical_level ?? 'intermediate',
      },
      product_character: p.product?.product_character ?? ['deliberate'],
      brand_promise: p.product?.brand_promise ?? '',
      brand_personality: {
        should_feel: p.product?.brand_personality?.should_feel ?? ['intentional'],
        should_not_feel: p.product?.brand_personality?.should_not_feel ?? [
          'generic',
          'template-generated',
        ],
      },
      primary_user_action:
        p.product?.primary_user_action ?? 'Understand the product and start using it.',
      conversion_goal: {
        primary: p.product?.conversion_goal?.primary ?? 'Get started',
        secondary: p.product?.conversion_goal?.secondary ?? 'Explore',
      },
    },
    design_strategy: {
      concept: p.design_strategy?.concept ?? '',
      central_idea: {
        statement: p.design_strategy?.central_idea?.statement ?? '',
        visual_metaphor: p.design_strategy?.central_idea?.visual_metaphor ?? '',
        principle:
          p.design_strategy?.central_idea?.principle ??
          'Every major visual element should either communicate product functionality, hierarchy, or brand.',
      },
      design_language: {
        keywords: (() => {
          const kw = [...(p.design_strategy?.design_language?.keywords ?? [])];
          if (fontTag && !kw.some((k) => /^font:/.test(k))) {
            kw.push(fontTag);
          }
          return kw;
        })(),
        density: p.design_strategy?.design_language?.density ?? 'medium',
        visual_complexity:
          p.design_strategy?.design_language?.visual_complexity ?? 'controlled',
        surface_treatment:
          p.design_strategy?.design_language?.surface_treatment ?? 'minimal',
        ornamentation: p.design_strategy?.design_language?.ornamentation ?? 'low',
      },
      design_differentiator: {
        description:
          p.design_strategy?.design_differentiator?.description ??
          'Avoid looking like a generic AI SaaS landing page.',
        requirement:
          p.design_strategy?.design_differentiator?.requirement ??
          'At least one major composition must be impossible to mistake for a generic SaaS template.',
      },
    },
    visual_identity: {
      color: {
        background: p.visual_identity?.color?.background ?? '',
        foreground: p.visual_identity?.color?.foreground ?? '',
        primary: p.visual_identity?.color?.primary ?? '',
        accent: p.visual_identity?.color?.accent ?? '',
        muted: p.visual_identity?.color?.muted ?? '',
        border: p.visual_identity?.color?.border ?? '',
        usage_rules: {
          background: 'Use as the dominant canvas.',
          foreground: 'Primary text and high-priority interface elements.',
          muted: 'Secondary information only.',
          accent: 'Use sparingly for actions, active states, and emphasis.',
          border: 'Use to define structure, not decoration.',
          ...p.visual_identity?.color?.usage_rules,
        },
        constraints: p.visual_identity?.color?.constraints ?? [
          'Do not use blue-purple gradients.',
          'Do not use gradient text.',
        ],
      },
      contrast: {
        hierarchy: p.visual_identity?.contrast?.hierarchy ?? [
          'primary content',
          'secondary content',
          'metadata',
          'structural elements',
        ],
        rule:
          p.visual_identity?.contrast?.rule ??
          'Contrast should establish hierarchy rather than simply maximize visual intensity.',
      },
    },
    typography: typo,
    layout_system: {
      max_width: p.layout_system?.max_width ?? '1200px',
      grid: {
        desktop: '12 columns',
        tablet: '8 columns',
        mobile: '4 columns',
        gutter_desktop: '24px',
        gutter_mobile: '16px',
        ...p.layout_system?.grid,
      },
      spacing_unit: p.layout_system?.spacing_unit ?? '8px',
      section_spacing: {
        desktop: 'clamp(96px, 12vw, 180px)',
        mobile: '72px',
        ...p.layout_system?.section_spacing,
      },
      alignment: {
        primary: 'left-aligned',
        secondary: 'intentional asymmetry',
        rule: 'Asymmetry is allowed only when it strengthens hierarchy or product storytelling.',
        ...p.layout_system?.alignment,
      },
      composition_rules: p.layout_system?.composition_rules ?? [
        'Avoid evenly distributing every element.',
        'Use intentional negative space.',
        'Establish a clear visual anchor in every major section.',
      ],
    },
    navigation: {
      strategy: p.navigation?.strategy ?? 'minimal product-oriented navigation',
      structure: p.navigation?.structure ?? [
        'brand',
        'product',
        'documentation',
        'pricing',
        'primary_cta',
      ],
      behavior: {
        desktop: 'horizontal',
        mobile: 'compact navigation with deliberate menu interaction',
        sticky: true,
        ...p.navigation?.behavior,
      },
      visual_style: {
        height: '64-80px',
        background: 'transparent or subtly separated from canvas',
        border: 'minimal',
        ...p.navigation?.visual_style,
      },
      rules: p.navigation?.rules ?? [
        'Navigation must not visually compete with the hero.',
        'Avoid excessive navigation items.',
      ],
    },
    hero: {
      strategy: p.hero?.strategy ?? 'brand-first product explanation',
      priority_order: p.hero?.priority_order ?? [
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
        ...p.hero?.headline,
      },
      supporting_copy: {
        max_width: '560px',
        max_lines: 3,
        density: 'low',
        ...p.hero?.supporting_copy,
      },
      composition: {
        type: 'editorial product composition',
        alignment: 'left',
        visual_anchor: 'custom product diagram',
        negative_space: 'high',
        above_fold_requirement:
          'headline, value proposition, CTA and core product visual must establish the product story without scrolling',
        ...p.hero?.composition,
      },
      visual_concept: {
        type: 'custom SVG / CSS product diagram',
        purpose: 'Explain the product rather than decorate the page.',
        required: true,
        ...p.hero?.visual_concept,
      },
      cta: {
        primary: 'Get started',
        secondary: 'Explore',
        style: 'strong but restrained',
        avoid: ['oversized pill buttons', 'gradient buttons', 'glowing buttons'],
        ...p.hero?.cta,
      },
    },
    signature_element: {
      type: p.signature_element?.type ?? 'custom SVG diagram',
      purpose: p.signature_element?.purpose ?? '',
      requirements: p.signature_element?.requirements ?? [
        'Must represent an actual product concept.',
        'Must remain understandable without animation.',
      ],
      visual_language: {
        nodes: 'minimal geometric forms',
        connections: 'thin controlled lines',
        labels: 'IBM Plex Mono',
        active_signal: 'accent color',
        inactive_elements: 'muted foreground/border',
        ...p.signature_element?.visual_language,
      },
      animation: {
        initial_state: 'quiet',
        sequence: ['diagram structure appears', 'connections draw', 'single signal travels'],
        duration: '1.2-2.0s',
        easing: 'ease-out',
        repeat: false,
        ...p.signature_element?.animation,
      },
    },
    information_architecture: {
      sections: p.information_architecture?.sections ?? [
        { id: 'hero', purpose: 'Immediately establish product identity and value.' },
        { id: 'product', purpose: 'Show how the product actually works.' },
        { id: 'cta', purpose: 'Convert understanding into action.' },
      ],
      section_rule:
        p.information_architecture?.section_rule ??
        'Every section must have a distinct communication purpose.',
    },
    content_system: {
      voice: {
        tone: p.content_system?.voice?.tone ?? ['direct', 'precise', 'confident'],
        avoid: p.content_system?.voice?.avoid ?? [
          'revolutionary',
          'game-changing',
          'AI-powered',
          'everything you need',
        ],
      },
      copy_rules: p.content_system?.copy_rules ?? [
        'Prefer concrete product language.',
        'Do not invent statistics.',
      ],
    },
    component_system: {
      buttons: p.component_system?.buttons ?? {
        style: 'compact and deliberate',
        radius: '4-8px',
        avoid: ['giant pills', 'neon glow', 'gradient fills'],
      },
      cards: p.component_system?.cards ?? {
        default: 'avoid unless information architecture requires grouping',
        rule: 'Cards must represent meaningful conceptual boundaries.',
      },
      badges: p.component_system?.badges ?? {
        font: 'IBM Plex Mono',
        style: 'technical',
      },
      inputs: p.component_system?.inputs ?? {
        height: '44-48px',
        states: ['default', 'hover', 'focus', 'error', 'disabled'],
      },
    },
    product_visualization: {
      priority: p.product_visualization?.priority ?? 'very_high',
      principle:
        p.product_visualization?.principle ??
        'Show the product doing something rather than displaying a generic dashboard screenshot.',
      preferred_forms: p.product_visualization?.preferred_forms ?? [
        'workflow diagrams',
        'system graphs',
        'interactive product simulations',
      ],
      avoid: p.product_visualization?.avoid ?? [
        'fake dashboard statistics',
        'abstract 3D objects',
        'stock photography',
      ],
    },
    responsive_design: {
      principle: p.responsive_design?.principle ?? 'Recompose rather than simply stack.',
      desktop: {
        width: '>= 1024px',
        composition: 'full editorial composition',
        ...p.responsive_design?.desktop,
      },
      tablet: {
        width: '768px-1023px',
        rule: 'Reduce spatial complexity while preserving hierarchy.',
        ...p.responsive_design?.tablet,
      },
      mobile: {
        width: '< 768px',
        rule: 'Preserve the visual idea, not necessarily the desktop geometry.',
        ...p.responsive_design?.mobile,
      },
      mobile_rules: p.responsive_design?.mobile_rules ?? [
        'Preserve the hero visual anchor.',
        'Collapse diagrams intelligently.',
        'Ensure CTA remains immediately accessible.',
      ],
    },
    motion: {
      philosophy:
        p.motion?.philosophy ?? 'Motion communicates system behavior, not decoration.',
      allowed: p.motion?.allowed ?? [
        'diagram draw-in',
        'signal propagation',
        'CTA emphasis',
      ],
      timing: {
        micro: '120-200ms',
        standard: '200-400ms',
        hero: '800-1600ms',
        ...p.motion?.timing,
      },
      rules: p.motion?.rules ?? [
        'Motion must have a reason.',
        'Do not animate every section.',
        'Respect prefers-reduced-motion.',
      ],
    },
    interaction_design: {
      required_states: p.interaction_design?.required_states ?? [
        'default',
        'hover',
        'focus',
        'active',
        'disabled',
        'loading',
        'error',
      ],
      interaction_principle:
        p.interaction_design?.interaction_principle ??
        'Interactions should reveal product behavior or provide useful feedback.',
      hover: {
        intensity: 'subtle',
        avoid: ['large transforms', 'glow effects', 'bouncy animations'],
        ...p.interaction_design?.hover,
      },
    },
    accessibility: {
      requirements: p.accessibility?.requirements ?? [
        'WCAG-conscious contrast',
        'keyboard navigation',
        'visible focus states',
        'semantic HTML',
        'reduced motion support',
      ],
    },
    imagery: {
      strategy:
        p.imagery?.strategy ??
        'Prefer product-specific visual systems over decorative imagery.',
      priority: p.imagery?.priority ?? [
        'custom SVG',
        'CSS composition',
        'real product UI',
      ],
      avoid: p.imagery?.avoid ?? [
        'stock imagery',
        'generic AI artwork',
        'decorative 3D blobs',
      ],
    },
    iconography: {
      style: p.iconography?.style ?? 'minimal technical',
      source: p.iconography?.source ?? 'custom SVG preferred',
      rules: p.iconography?.rules ?? [
        'Icons should communicate meaning.',
        'Avoid generic Lucide icon feature grids.',
      ],
    },
    technical_implementation: {
      preferred: p.technical_implementation?.preferred ?? [
        'semantic HTML',
        'CSS variables',
        'CSS Grid',
        'Flexbox',
        'inline SVG',
      ],
      avoid: p.technical_implementation?.avoid ?? [
        'unnecessary animation libraries',
        'Three.js unless product value clearly requires it',
        'massive dependency additions',
      ],
      svg_rules: p.technical_implementation?.svg_rules ?? [
        'Prefer hand-designed SVG compositions.',
        'Keep SVG geometry responsive.',
      ],
    },
    performance: {
      requirements: p.performance?.requirements ?? [
        'fast initial render',
        'avoid unnecessary JavaScript',
        'lazy-load non-critical assets',
      ],
      priority:
        p.performance?.priority ??
        'Visual quality must not come from excessive runtime complexity.',
    },
    design_anti_patterns: {
      explicitly_prohibited: p.design_anti_patterns?.explicitly_prohibited?.length
        ? p.design_anti_patterns.explicitly_prohibited
        : [...DEFAULT_AVOID_LIST],
    },
    references: {
      provided: p.references?.provided ?? [],
      reference_usage: {
        rule:
          p.references?.reference_usage?.rule ??
          'References should influence composition, typography, interaction or visual language, but must not be copied literally.',
        priority: p.references?.reference_usage?.priority ?? [
          'composition',
          'spacing',
          'typography',
          'interaction',
          'visual metaphor',
        ],
      },
    },
    design_decisions: {
      locked: p.design_decisions?.locked ?? [
        fontLock,
        'custom product diagram',
      ],
      flexible: p.design_decisions?.flexible ?? [
        'exact section ordering',
        'diagram geometry',
        'CTA wording',
      ],
      unresolved: p.design_decisions?.unresolved ?? [],
    },
    quality_bar: {
      evaluation_questions: p.quality_bar?.evaluation_questions ?? [
        'Can the product be understood within five seconds?',
        'Does the page look designed specifically for this product?',
        'Does the page avoid generic AI SaaS patterns?',
      ],
      failure_conditions: p.quality_bar?.failure_conditions ?? [
        'The page could belong to any AI startup.',
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
        ...p.quality_bar?.minimum_quality_threshold,
      },
    },
    generation_directive: {
      instruction:
        p.generation_directive?.instruction ??
        'Treat this document as a design system and art-direction contract, not as a loose suggestion.',
      before_coding: p.generation_directive?.before_coding ?? [
        'Identify the dominant visual idea.',
        'Determine the hero composition.',
        'Define the product visualization.',
      ],
      during_coding: p.generation_directive?.during_coding ?? [
        'Preserve the intended composition.',
        'Do not substitute generic components for custom visual concepts.',
      ],
      after_coding: p.generation_directive?.after_coding ?? [
        'Visually inspect the entire page.',
        'Compare the final result against the quality bar.',
      ],
      final_principle:
        p.generation_directive?.final_principle ??
        'Make the interface feel authored by a strong product designer, not assembled from a component library.',
    },
    notes: p.notes ?? [],
    createdAt: p.createdAt ?? Date.now(),
  };
}

export function parseDesignSpecJson(text: string): DesignSpecification {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json|yaml)?\s*([\s\S]*?)```/);
  const jsonText = fence ? fence[1]!.trim() : trimmed;
  const raw = JSON.parse(jsonText) as Record<string, unknown>;
  return validateDesignSpec(raw);
}

export function validateDesignSpec(
  raw: Partial<DesignSpecification> | Record<string, unknown> | null | undefined,
): DesignSpecification {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Design Specification missing or not an object');
  }
  const migrated = migrateLegacyDesignSpec(raw as Record<string, unknown>);
  const spec = createEmptyDesignSpec(migrated);
  const missing: string[] = [];
  if (!spec.design_strategy.concept.trim()) missing.push('design_strategy.concept');
  if (!spec.design_strategy.central_idea.visual_metaphor.trim()) {
    missing.push('design_strategy.central_idea.visual_metaphor');
  }
  if (!spec.visual_identity.color.background.trim()) {
    missing.push('visual_identity.color.background');
  }
  if (!spec.visual_identity.color.accent.trim()) {
    missing.push('visual_identity.color.accent');
  }
  if (!spec.typography.display.family.trim()) missing.push('typography.display.family');
  if (!spec.typography.body.family.trim()) missing.push('typography.body.family');
  if (!spec.hero.visual_concept.type.trim() && !spec.hero.visual_concept.purpose.trim()) {
    missing.push('hero.visual_concept');
  }
  if (!spec.signature_element.purpose.trim()) {
    missing.push('signature_element.purpose');
  }
  if (missing.length) {
    throw new Error(
      `Design Specification incomplete — missing: ${missing.join(', ')}`,
    );
  }
  if (!spec.design_anti_patterns.explicitly_prohibited.length) {
    spec.design_anti_patterns.explicitly_prohibited = [...DEFAULT_AVOID_LIST];
  }
  return spec;
}

/** Compact prompt block for the frontend implementer. */
export function formatDesignSpecForPrompt(spec: DesignSpecification): string {
  const locked = spec.design_decisions.locked.join('; ');
  const sections = spec.information_architecture.sections
    .map((s) => `${s.id}: ${s.purpose}`)
    .join(' · ');
  return [
    'DESIGN SPECIFICATION v2 (authoritative — implement this; do not reinvent art direction)',
    '────────────────────────────────────────',
    `Product: ${spec.product.name} · ${spec.product.category}`,
    `Audience: ${spec.product.audience.primary} (${spec.product.audience.technical_level})`,
    `Character: ${spec.product.product_character.join(', ')}`,
    `Brand promise: ${spec.product.brand_promise}`,
    `Feel: ${spec.product.brand_personality.should_feel.join(', ')}`,
    `Not: ${spec.product.brand_personality.should_not_feel.join(', ')}`,
    `Primary action: ${spec.product.primary_user_action}`,
    `CTA: ${spec.product.conversion_goal.primary} / ${spec.product.conversion_goal.secondary}`,
    '',
    'Design strategy',
    `  Concept: ${spec.design_strategy.concept}`,
    `  Idea: ${spec.design_strategy.central_idea.statement}`,
    `  Metaphor: ${spec.design_strategy.central_idea.visual_metaphor}`,
    `  Principle: ${spec.design_strategy.central_idea.principle}`,
    `  Language: ${spec.design_strategy.design_language.keywords.join(', ')}`,
    `  Density: ${spec.design_strategy.design_language.density}`,
    `  Differentiator: ${spec.design_strategy.design_differentiator.description}`,
    '',
    'Color',
    `  bg ${spec.visual_identity.color.background} · fg ${spec.visual_identity.color.foreground}`,
    `  primary ${spec.visual_identity.color.primary} · accent ${spec.visual_identity.color.accent}`,
    `  muted ${spec.visual_identity.color.muted} · border ${spec.visual_identity.color.border}`,
    `  Accent rule: ${spec.visual_identity.color.usage_rules.accent}`,
    '',
    'Typography',
    `  system: ${spec.typography.personality ?? 'custom'} — ${spec.typography.pairing_rationale ?? 'follow Spec faces + metrics'}`,
    `  display: ${spec.typography.display.family} wt ${spec.typography.display.default_weight ?? spec.typography.display.weight_range} · tracking ${spec.typography.display.letter_spacing ?? '0'} · lh ${spec.typography.display.line_height ?? 'auto'} — ${spec.typography.display.role}`,
    `  body: ${spec.typography.body.family} wt ${spec.typography.body.default_weight ?? spec.typography.body.weight_range} · tracking ${spec.typography.body.letter_spacing ?? '0'} · lh ${spec.typography.body.line_height ?? 'auto'}`,
    `  technical: ${spec.typography.technical.family} wt ${spec.typography.technical.default_weight ?? spec.typography.technical.weight_range} · tracking ${spec.typography.technical.letter_spacing ?? '0'}`,
    `  weights: ${spec.typography.weight_distribution ?? 'use Spec weight_range per role'}`,
    `  scale hero: ${spec.typography.scale.hero.desktop} · h2 ${spec.typography.scale.h2} · body ${spec.typography.scale.body}`,
    `  measure: ${spec.typography.measure ?? 'comfortable body column'}`,
    `  proportions: ${spec.typography.heading_proportions ?? 'follow Spec scale'}`,
    `  mono (${spec.typography.mono_usage?.presence ?? 'balanced'}): use for ${(spec.typography.mono_usage?.used_for ?? ['code', 'labels']).slice(0, 4).join(', ')}; avoid ${(spec.typography.mono_usage?.avoid_for ?? ['headlines']).slice(0, 2).join(', ')}`,
    `  mono style: ${spec.typography.mono_usage?.case_style ?? 'normal'} · size ${spec.typography.mono_usage?.size ?? '0.75× body'}`,
    ...spec.typography.rules.slice(0, 6).map((r) => `  - ${r}`),
    '',
    'Layout',
    `  max-width ${spec.layout_system.max_width} · spacing ${spec.layout_system.spacing_unit}`,
    `  align: ${spec.layout_system.alignment.primary}`,
    ...spec.layout_system.composition_rules.map((r) => `  - ${r}`),
    '',
    'Navigation',
    `  ${spec.navigation.strategy}`,
    `  structure: ${spec.navigation.structure.join(' → ')}`,
    '',
    'Hero',
    `  Strategy: ${spec.hero.strategy}`,
    `  Headline: ${spec.hero.headline.treatment} (${spec.hero.headline.preferred_length})`,
    `  Composition: ${spec.hero.composition.type} · anchor ${spec.hero.composition.visual_anchor}`,
    `  Visual: ${spec.hero.visual_concept.type} — ${spec.hero.visual_concept.purpose}`,
    `  CTA: ${spec.hero.cta.primary} / ${spec.hero.cta.secondary} (${spec.hero.cta.style})`,
    '',
    'Signature element (REQUIRED)',
    `  Type: ${spec.signature_element.type}`,
    `  Purpose: ${spec.signature_element.purpose}`,
    ...spec.signature_element.requirements.map((r) => `  - ${r}`),
    `  Animation: ${spec.signature_element.animation.sequence.join(' → ')}`,
    '',
    'Information architecture',
    `  ${sections}`,
    `  Rule: ${spec.information_architecture.section_rule}`,
    '',
    'Product visualization',
    `  ${spec.product_visualization.principle}`,
    `  Prefer: ${spec.product_visualization.preferred_forms.join('; ')}`,
    '',
    'Motion',
    `  ${spec.motion.philosophy}`,
    `  Allowed: ${spec.motion.allowed.join('; ')}`,
    ...spec.motion.rules.map((r) => `  - ${r}`),
    '',
    'Imagery',
    `  ${spec.imagery.strategy}`,
    `  Priority: ${spec.imagery.priority.join(' > ')}`,
    '',
    'Locked decisions',
    `  ${locked}`,
    '',
    'Generation directive',
    `  ${spec.generation_directive.instruction}`,
    `  Final: ${spec.generation_directive.final_principle}`,
    '',
    'Avoid (explicitly prohibited)',
    ...specAvoidList(spec).map((a) => `  - ${a}`),
    '',
    'Quality bar — failure if:',
    ...spec.quality_bar.failure_conditions.map((f) => `  - ${f}`),
    spec.notes?.length
      ? `Notes:\n${spec.notes.map((n) => `  - ${n}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Map a finished spec into Design DNA patch fields. */
export function designSpecToDnaNotes(spec: DesignSpecification): string[] {
  return [
    `Metaphor: ${specVisualMetaphor(spec)}`,
    `Palette: bg=${specColorBackground(spec)} accent=${specColorAccent(spec)}`,
    `Type: ${specDisplayFamily(spec)} / ${specBodyFamily(spec)} / ${specTechnicalFamily(spec)}`,
    `Signature: ${specSignatureType(spec)} — ${specSignaturePurpose(spec)}`,
    `Hero: ${specHeroVisual(spec)}`,
    `Concept: ${specConcept(spec)}`,
  ];
}
