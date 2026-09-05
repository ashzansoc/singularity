/**
 * Typography system for Design Spec.
 * Design Director picks ONE personality; the Spec locks the full type system—
 * pairing, weights, tracking, scale, leading, and mono usage—not just faces.
 * Default Singularity identity: Experimental (Syne + Manrope + IBM Plex Mono).
 */

export type FontPersonalityId =
  | 'experimental'
  | 'premium'
  | 'developer'
  | 'research'
  | 'bold'
  | 'minimal'
  | 'editorial'
  | 'enterprise'
  | 'cybernetic';

export interface TypeRoleMetrics {
  /** Allowed weight band for this role. */
  weight_range: string;
  /** Default weight implementers should start from. */
  default_weight: string;
  /** CSS letter-spacing. */
  letter_spacing: string;
  /** Unitless or CSS line-height. */
  line_height: string;
}

export interface TypeScaleTokens {
  hero: { desktop: string; mobile: string };
  h2: string;
  h3: string;
  body: string;
  small: string;
  technical: string;
}

export interface MonoUsageSystem {
  /** Where mono is required / preferred. */
  used_for: string[];
  /** Where mono must not appear. */
  avoid_for: string[];
  /** Relative size vs body (guidance). */
  size: string;
  /** Case / tracking treatment for mono labels. */
  case_style: string;
  /** How present mono is in the overall composition. */
  presence: 'sparse' | 'balanced' | 'prominent';
}

/** Full intentional typography system for one brand personality. */
export interface TypographySystem {
  id: FontPersonalityId;
  style: string;
  feel: string;
  /** Why these faces belong together. */
  pairing_rationale: string;
  display: string;
  body: string;
  technical: string;
  display_metrics: TypeRoleMetrics;
  body_metrics: TypeRoleMetrics;
  technical_metrics: TypeRoleMetrics;
  /** Weight story across the UI (not just ranges). */
  weight_distribution: string;
  scale: TypeScaleTokens;
  /** Ideal body measure / column width. */
  measure: string;
  /** How heading sizes relate to body (ratio story). */
  heading_proportions: string;
  mono: MonoUsageSystem;
  /** Implementer-facing rules unique to this personality. */
  rules: string[];
  notes?: string;
}

/** @deprecated Prefer TypographySystem — kept as alias for face trio access. */
export type FontTrio = TypographySystem;

const sharedScaleQuiet: TypeScaleTokens = {
  hero: {
    desktop: 'clamp(2.75rem, 5vw, 4.5rem)',
    mobile: 'clamp(2.25rem, 10vw, 3.25rem)',
  },
  h2: 'clamp(1.75rem, 3vw, 2.5rem)',
  h3: 'clamp(1.25rem, 2vw, 1.5rem)',
  body: '1rem',
  small: '0.875rem',
  technical: '0.8125rem',
};

/** Curated typography systems — each is a different intentional brand. */
export const FONT_PERSONALITIES: readonly TypographySystem[] = [
  {
    id: 'experimental',
    style: '01 — Futuristic',
    feel: 'Experimental, AI-native — default Singularity identity',
    pairing_rationale:
      'Syne as kinetic display geometry; Manrope softens readable UI; IBM Plex Mono grounds research/system labels.',
    display: 'Syne',
    body: 'Manrope',
    technical: 'IBM Plex Mono',
    display_metrics: {
      weight_range: '600-800',
      default_weight: '700',
      letter_spacing: '-0.035em',
      line_height: '0.98',
    },
    body_metrics: {
      weight_range: '400-600',
      default_weight: '400',
      letter_spacing: '-0.01em',
      line_height: '1.55',
    },
    technical_metrics: {
      weight_range: '400-500',
      default_weight: '450',
      letter_spacing: '0.04em',
      line_height: '1.4',
    },
    weight_distribution:
      'Heavy display (700–800) vs light-medium body (400–500). Nav 500. CTAs 600. Avoid mid-weight display.',
    scale: {
      hero: {
        desktop: 'clamp(4rem, 9vw, 8.5rem)',
        mobile: 'clamp(3rem, 14vw, 5rem)',
      },
      h2: 'clamp(2.25rem, 4.5vw, 4.25rem)',
      h3: 'clamp(1.4rem, 2.2vw, 2rem)',
      body: '1.0625rem',
      small: '0.875rem',
      technical: '0.75rem',
    },
    measure: '48–62ch for body; hero may break measure as a compositional block',
    heading_proportions:
      'Hero ~5–8× body; H2 ~2.5–4×; large type is a shape, not a caption.',
    mono: {
      used_for: [
        'system metadata',
        'model/route labels',
        'diagram annotations',
        'short status chips',
        'keyboard hints',
      ],
      avoid_for: ['marketing headlines', 'long paragraphs', 'nav link text'],
      size: '0.7–0.8× body',
      case_style: 'Uppercase micro-labels with +0.04em tracking; code stays normal case',
      presence: 'balanced',
    },
    rules: [
      'Treat hero type as a compositional element — oversized, tight leading.',
      'Do not use the same weight for display and body.',
      'Mono is for precision signals, not decoration.',
    ],
  },
  {
    id: 'premium',
    style: '02 — Premium AI',
    feel: 'Clean, sophisticated — AI infrastructure × frontier tech × premium SaaS',
    pairing_rationale:
      'Space Grotesk gives structured modern display; Inter carries polished product UI; Plex Mono stays quiet technical.',
    display: 'Space Grotesk',
    body: 'Inter',
    technical: 'IBM Plex Mono',
    display_metrics: {
      weight_range: '500-700',
      default_weight: '600',
      letter_spacing: '-0.025em',
      line_height: '1.05',
    },
    body_metrics: {
      weight_range: '400-500',
      default_weight: '400',
      letter_spacing: '0',
      line_height: '1.6',
    },
    technical_metrics: {
      weight_range: '400-500',
      default_weight: '400',
      letter_spacing: '0.02em',
      line_height: '1.45',
    },
    weight_distribution:
      'Restrained: display 600, body 400, emphasis 500 only. No ultra-black display. CTAs 500–600.',
    scale: {
      hero: {
        desktop: 'clamp(3.25rem, 6vw, 5.5rem)',
        mobile: 'clamp(2.5rem, 11vw, 3.75rem)',
      },
      h2: 'clamp(1.85rem, 3.5vw, 3rem)',
      h3: 'clamp(1.25rem, 2vw, 1.65rem)',
      body: '1rem',
      small: '0.875rem',
      technical: '0.75rem',
    },
    measure: '55–68ch body; generous margins',
    heading_proportions:
      'Hero ~3.5–5× body; calm steps down H2→H3; never shout with size alone.',
    mono: {
      used_for: ['API paths', 'IDs', 'timestamps', 'spec footnotes'],
      avoid_for: ['hero', 'section titles', 'button labels'],
      size: '0.75× body',
      case_style: 'Normal case; slight tracking on uppercase badges only',
      presence: 'sparse',
    },
    rules: [
      'Sophistication comes from restraint — avoid extreme scale jumps.',
      'Inter body must feel airy (1.6 leading); do not tighten into density for drama.',
      'Mono appears rarely; when it does, it should feel precise.',
    ],
  },
  {
    id: 'developer',
    style: '03 — Technical / Developer Native',
    feel: 'Modern developer platform — Vercel × Cursor × IDE',
    pairing_rationale:
      'Geist family reads as product UI + IDE; Inter for longer docs/marketing body; Geist Mono for code-native surfaces.',
    display: 'Geist',
    body: 'Inter',
    technical: 'Geist Mono',
    display_metrics: {
      weight_range: '500-650',
      default_weight: '600',
      letter_spacing: '-0.02em',
      line_height: '1.1',
    },
    body_metrics: {
      weight_range: '400-500',
      default_weight: '400',
      letter_spacing: '0',
      line_height: '1.55',
    },
    technical_metrics: {
      weight_range: '400-500',
      default_weight: '400',
      letter_spacing: '0',
      line_height: '1.5',
    },
    weight_distribution:
      'UI-flat: display 600, body 400, UI labels 500. Mono matches UI weight. Prefer consistency over drama.',
    scale: {
      hero: {
        desktop: 'clamp(2.75rem, 5vw, 4.25rem)',
        mobile: 'clamp(2.25rem, 10vw, 3.25rem)',
      },
      h2: 'clamp(1.65rem, 3vw, 2.35rem)',
      h3: 'clamp(1.2rem, 1.8vw, 1.45rem)',
      body: '0.9375rem',
      small: '0.8125rem',
      technical: '0.8125rem',
    },
    measure: '60–72ch docs; product UI may be denser',
    heading_proportions:
      'Hero ~3–4× body (product, not billboard). H2 ~1.8–2.5×. Prefer clarity over spectacle.',
    mono: {
      used_for: [
        'inline code',
        'CLI snippets',
        'file paths',
        'env vars',
        'status bars',
        'table of tokens',
      ],
      avoid_for: ['emotional marketing headlines'],
      size: '0.9–1.0× body (code-native, nearly equal)',
      case_style: 'Normal case always; never uppercase mono blocks',
      presence: 'prominent',
    },
    rules: [
      'Mono is a first-class citizen — code samples and paths should feel native, not tiny footnotes.',
      'Keep scale product-sized; this is a platform, not a fashion campaign.',
      'Geist display should not use exaggerated tracking.',
    ],
  },
  {
    id: 'editorial',
    style: '04 — Editorial AI',
    feel: 'Premium, intelligent — research institution × premium tech',
    pairing_rationale:
      'Instrument Serif carries intellectual display; Inter (Söhne stand-in) for clean body; Plex Mono for citations/figures.',
    display: 'Instrument Serif',
    body: 'Inter',
    technical: 'IBM Plex Mono',
    display_metrics: {
      weight_range: '400-500',
      default_weight: '400',
      letter_spacing: '-0.02em',
      line_height: '1.12',
    },
    body_metrics: {
      weight_range: '400-500',
      default_weight: '400',
      letter_spacing: '0',
      line_height: '1.65',
    },
    technical_metrics: {
      weight_range: '400-500',
      default_weight: '400',
      letter_spacing: '0.01em',
      line_height: '1.45',
    },
    weight_distribution:
      'Editorial: display at book weight (400). Emphasis via size/italic, not black weights. Body 400; strong 500 rarely.',
    scale: {
      hero: {
        desktop: 'clamp(3.5rem, 7vw, 6.5rem)',
        mobile: 'clamp(2.75rem, 12vw, 4.25rem)',
      },
      h2: 'clamp(2rem, 4vw, 3.25rem)',
      h3: 'clamp(1.35rem, 2vw, 1.75rem)',
      body: '1.125rem',
      small: '0.9rem',
      technical: '0.75rem',
    },
    measure: '42–58ch — literary column feel',
    heading_proportions:
      'Hero ~4–6× body with open leading; serifs need air. H2 quieter than experimental.',
    mono: {
      used_for: ['figure captions', 'citations', 'version stamps', 'pull-quote attributions'],
      avoid_for: ['primary headlines', 'nav', 'CTAs'],
      size: '0.7× body',
      case_style: 'Small caps / uppercase captions with +0.06em tracking when used as labels',
      presence: 'sparse',
    },
    rules: [
      'Serif headlines stay light-weight; never Archivo-Black the serif.',
      'Body measure is narrow and literary; do not stretch full-bleed paragraphs.',
      'Mono is archival — captions and citations, not UI chrome.',
    ],
    notes: 'Söhne → Inter as open substitute',
  },
  {
    id: 'bold',
    style: '05 — Brutalist Tech',
    feel: 'Bold, aggressive, disruptive',
    pairing_rationale:
      'Archivo Black is the blunt instrument; DM Sans keeps body usable; JetBrains Mono adds engineering grit.',
    display: 'Archivo Black',
    body: 'DM Sans',
    technical: 'JetBrains Mono',
    display_metrics: {
      weight_range: '400-400',
      default_weight: '400',
      letter_spacing: '-0.01em',
      line_height: '0.92',
    },
    body_metrics: {
      weight_range: '400-700',
      default_weight: '400',
      letter_spacing: '0',
      line_height: '1.5',
    },
    technical_metrics: {
      weight_range: '500-700',
      default_weight: '500',
      letter_spacing: '0.02em',
      line_height: '1.35',
    },
    weight_distribution:
      'Binary contrast: black display vs regular body. CTAs can go 700. Mid greys of weight are weak — commit.',
    scale: {
      hero: {
        desktop: 'clamp(4.5rem, 10vw, 9rem)',
        mobile: 'clamp(3.25rem, 15vw, 5.5rem)',
      },
      h2: 'clamp(2.5rem, 5vw, 4.5rem)',
      h3: 'clamp(1.5rem, 2.5vw, 2.1rem)',
      body: '1.0625rem',
      small: '0.875rem',
      technical: '0.8rem',
    },
    measure: '40–55ch; short lines amplify punch',
    heading_proportions:
      'Hero huge and compressed (~6–9× body). Stacked lines OK. Prefer impact over elegance.',
    mono: {
      used_for: ['error codes', 'build tags', 'aggressive system labels', 'countdown / metrics'],
      avoid_for: ['long prose'],
      size: '0.8× body',
      case_style: 'Uppercase labels +0.08em; JetBrains for code stays normal',
      presence: 'balanced',
    },
    rules: [
      'Archivo Black is display-only — never body.',
      'Crush leading on headlines; leave body readable.',
      'Mono labels can be loud; paragraphs cannot.',
    ],
  },
  {
    id: 'minimal',
    style: '06 — Minimal',
    feel: 'Apple/Vercel-like minimal modern',
    pairing_rationale:
      'Geist (General Sans stand-in) + Inter for quiet product UI; Geist Mono almost invisible until needed.',
    display: 'Geist',
    body: 'Inter',
    technical: 'Geist Mono',
    display_metrics: {
      weight_range: '400-600',
      default_weight: '500',
      letter_spacing: '-0.015em',
      line_height: '1.15',
    },
    body_metrics: {
      weight_range: '400-400',
      default_weight: '400',
      letter_spacing: '0',
      line_height: '1.6',
    },
    technical_metrics: {
      weight_range: '400-400',
      default_weight: '400',
      letter_spacing: '0',
      line_height: '1.5',
    },
    weight_distribution:
      'Nearly flat: display 500, body 400 only. Hierarchy from size/space, not weight gymnastics.',
    scale: sharedScaleQuiet,
    measure: '52–64ch; lots of negative space around type',
    heading_proportions:
      'Hero ~3–4× body; soft steps. Size changes should feel inevitable, not theatrical.',
    mono: {
      used_for: ['rare inline code', 'tiny version strings'],
      avoid_for: ['labels that could be sans', 'hero', 'nav'],
      size: '0.85× body',
      case_style: 'Normal case; no shouty mono',
      presence: 'sparse',
    },
    rules: [
      'Whitespace is part of the type system — do not fill gaps with weight or color.',
      'Prefer one weight per role.',
      'If type feels loud, reduce weight or size before changing the face.',
    ],
    notes: 'General Sans → Geist as open substitute',
  },
  {
    id: 'research',
    style: '07 — Research Lab',
    feel: 'Scientific, credible',
    pairing_rationale:
      'IBM Plex Sans for display and body (one family = institutional trust); Plex Mono for data, figures, methods.',
    display: 'IBM Plex Sans',
    body: 'IBM Plex Sans',
    technical: 'IBM Plex Mono',
    display_metrics: {
      weight_range: '500-650',
      default_weight: '600',
      letter_spacing: '-0.01em',
      line_height: '1.15',
    },
    body_metrics: {
      weight_range: '400-500',
      default_weight: '400',
      letter_spacing: '0',
      line_height: '1.6',
    },
    technical_metrics: {
      weight_range: '400-500',
      default_weight: '400',
      letter_spacing: '0',
      line_height: '1.45',
    },
    weight_distribution:
      'Scientific hierarchy: Semibold titles (600), Regular body (400), Medium for figure labels (500). Same family throughout.',
    scale: {
      hero: {
        desktop: 'clamp(2.5rem, 4.5vw, 3.75rem)',
        mobile: 'clamp(2rem, 9vw, 2.75rem)',
      },
      h2: 'clamp(1.5rem, 2.5vw, 2rem)',
      h3: 'clamp(1.15rem, 1.5vw, 1.35rem)',
      body: '1rem',
      small: '0.875rem',
      technical: '0.8125rem',
    },
    measure: '60–72ch (paper-like)',
    heading_proportions:
      'Modest hero (~2.5–3.5× body). Credibility over drama. Think paper title, not startup billboard.',
    mono: {
      used_for: [
        'equations / tokens',
        'figure axes',
        'methods notes',
        'dataset IDs',
        'tabular numbers',
      ],
      avoid_for: ['emotional marketing', 'hero slogans'],
      size: '0.85–0.95× body',
      case_style: 'Normal case; tabular figures when available',
      presence: 'balanced',
    },
    rules: [
      'Do not introduce a second display face — Plex Sans is the institution.',
      'Mono accompanies data, not brand voice.',
      'Keep scale academic; oversizing reads as marketing, not research.',
    ],
  },
  {
    id: 'enterprise',
    style: '08 — Enterprise AI',
    feel: 'Professional, trustworthy',
    pairing_rationale:
      'Plus Jakarta Sans for approachable enterprise display; Inter for dense product UI; Roboto Mono for audit/IDs.',
    display: 'Plus Jakarta Sans',
    body: 'Inter',
    technical: 'Roboto Mono',
    display_metrics: {
      weight_range: '600-700',
      default_weight: '650',
      letter_spacing: '-0.02em',
      line_height: '1.1',
    },
    body_metrics: {
      weight_range: '400-500',
      default_weight: '400',
      letter_spacing: '0',
      line_height: '1.55',
    },
    technical_metrics: {
      weight_range: '400-500',
      default_weight: '400',
      letter_spacing: '0.01em',
      line_height: '1.4',
    },
    weight_distribution:
      'Trustworthy: Semibold display (600–650), Regular body, Medium for UI chrome. Avoid fashion-thin or ultra-black.',
    scale: {
      hero: {
        desktop: 'clamp(2.75rem, 5vw, 4rem)',
        mobile: 'clamp(2.25rem, 10vw, 3rem)',
      },
      h2: 'clamp(1.65rem, 3vw, 2.25rem)',
      h3: 'clamp(1.2rem, 1.8vw, 1.4rem)',
      body: '1rem',
      small: '0.875rem',
      technical: '0.75rem',
    },
    measure: '58–70ch',
    heading_proportions:
      'Hero ~3–4× body. Clear corporate ladder H1→H2→H3; no experimental compression.',
    mono: {
      used_for: ['account IDs', 'audit logs', 'SLA metrics', 'compliance codes'],
      avoid_for: ['headlines', 'value props'],
      size: '0.75× body',
      case_style: 'Normal case; monospace for scannable IDs',
      presence: 'sparse',
    },
    rules: [
      'Type must feel deployable in a procurement deck — clarity over novelty.',
      'Mono is operational (IDs, logs), never decorative.',
      'Keep weight distribution predictable across pages.',
    ],
  },
  {
    id: 'cybernetic',
    style: '09 — Cybernetic',
    feel: 'Futuristic + technical — agents × infrastructure × autonomous SWE',
    pairing_rationale:
      'Space Grotesk for machine display; Manrope for human-readable body; JetBrains Mono for agent/terminal surfaces.',
    display: 'Space Grotesk',
    body: 'Manrope',
    technical: 'JetBrains Mono',
    display_metrics: {
      weight_range: '500-700',
      default_weight: '600',
      letter_spacing: '-0.03em',
      line_height: '1.0',
    },
    body_metrics: {
      weight_range: '400-600',
      default_weight: '400',
      letter_spacing: '-0.005em',
      line_height: '1.55',
    },
    technical_metrics: {
      weight_range: '400-600',
      default_weight: '500',
      letter_spacing: '0',
      line_height: '1.45',
    },
    weight_distribution:
      'Machine dual: geometric display 600 + medium mono 500 for agent output. Body stays 400 so logs can dominate.',
    scale: {
      hero: {
        desktop: 'clamp(3.5rem, 7vw, 6.5rem)',
        mobile: 'clamp(2.75rem, 12vw, 4.25rem)',
      },
      h2: 'clamp(2rem, 4vw, 3.5rem)',
      h3: 'clamp(1.3rem, 2vw, 1.75rem)',
      body: '1rem',
      small: '0.875rem',
      technical: '0.875rem',
    },
    measure: '50–64ch body; agent panels may be full-bleed mono',
    heading_proportions:
      'Hero ~4–6× body with tight leading; mono panels sit near body size (agent = peer, not footnote).',
    mono: {
      used_for: [
        'agent transcripts',
        'terminal panels',
        'tool call traces',
        'infra status',
        'streamed tokens',
      ],
      avoid_for: ['long brand essays'],
      size: '0.9–1.05× body (terminal-first)',
      case_style: 'Normal case for streams; uppercase only for short system tags',
      presence: 'prominent',
    },
    rules: [
      'Mono surfaces are product UI — size them like body, not captions.',
      'Display stays geometric and slightly compressed; body stays human.',
      'Do not bury agent output in tiny mono.',
    ],
  },
] as const;

export const DEFAULT_FONT_PERSONALITY_ID: FontPersonalityId = 'experimental';

export function getFontPersonality(id: FontPersonalityId): TypographySystem {
  return FONT_PERSONALITIES.find((p) => p.id === id) ?? FONT_PERSONALITIES[0]!;
}

export function defaultFontTrio(): TypographySystem {
  return getFontPersonality(DEFAULT_FONT_PERSONALITY_ID);
}

/**
 * Resolve typography system from Design Spec / prompt signals.
 * Prefer explicit product personality keywords over category alone.
 */
export function resolveFontPersonality(hints: {
  prompt?: string;
  shouldFeel?: string[];
  shouldNotFeel?: string[];
  category?: string;
  designKeywords?: string[];
  density?: string;
  productCharacter?: string[];
}): TypographySystem {
  const blob = [
    hints.prompt ?? '',
    hints.category ?? '',
    hints.density ?? '',
    ...(hints.shouldFeel ?? []),
    ...(hints.shouldNotFeel ?? []),
    ...(hints.designKeywords ?? []),
    ...(hints.productCharacter ?? []),
  ]
    .join(' ')
    .toLowerCase();

  const hit = (re: RegExp) => re.test(blob);

  if (hit(/\b(editorial|intellectual|serif|literary|journal|magazine)\b/)) {
    return getFontPersonality('editorial');
  }
  if (hit(/\b(enterprise|corporate|b2b|trustworthy|compliance|professional)\b/)) {
    return getFontPersonality('enterprise');
  }
  if (hit(/\b(research|scientific|lab|academic|paper|credibility)\b/)) {
    return getFontPersonality('research');
  }
  if (hit(/\b(brutal|disrupt|aggressive|loud|bold|archivo)\b/)) {
    return getFontPersonality('bold');
  }
  if (
    hit(/\b(cyber|agentic|autonomous|infra|infrastructure|ops|agent)\b/) &&
    hit(/\b(technical|tech|futur|agent)\b/)
  ) {
    return getFontPersonality('cybernetic');
  }
  if (hit(/\b(developer|ide|engineering|devtools|platform|sdk|cli|vercel|cursor)\b/)) {
    return getFontPersonality('developer');
  }
  if (hit(/\b(minimal|quiet|restrained|apple|clean\s*modern)\b/)) {
    return getFontPersonality('minimal');
  }
  if (hit(/\b(premium|sophisticated|luxury|polished|frontier|saas)\b/)) {
    return getFontPersonality('premium');
  }
  if (hit(/\b(experimental|futuristic|creative|kinetic|whimsy|research\s*lab)\b/)) {
    return getFontPersonality('experimental');
  }
  if (hit(/\b(dashboard|devtools|ide|sdk)\b/)) {
    return getFontPersonality('developer');
  }
  if (hit(/\b(saas|b2b|enterprise)\b/)) {
    return getFontPersonality('premium');
  }

  return defaultFontTrio();
}

/** Prompt block for Design Director / agents. */
export function formatFontPersonalityCatalog(): string {
  const lines = [
    'TYPOGRAPHY SYSTEM (pick ONE personality — then lock the FULL type system, not just faces):',
    'Default Singularity identity = experimental (Syne + Manrope + IBM Plex Mono + its scale/weights/tracking/mono rules).',
    'Each personality defines: pairing, weight distribution, letter-spacing, line-height, heading scale, measure, and mono usage.',
    'Generated sites must feel like different intentional brands — never the same layout with only the font swapped.',
    '',
  ];
  for (const p of FONT_PERSONALITIES) {
    lines.push(
      `- ${p.id}: ${p.style} → "${p.display}" / "${p.body}" / "${p.technical}" — ${p.feel}`,
      `    pairing: ${p.pairing_rationale}`,
      `    weights: ${p.weight_distribution}`,
      `    tracking: display ${p.display_metrics.letter_spacing}, body ${p.body_metrics.letter_spacing}, mono ${p.technical_metrics.letter_spacing}`,
      `    leading: display ${p.display_metrics.line_height}, body ${p.body_metrics.line_height}`,
      `    scale hero: ${p.scale.hero.desktop}; measure: ${p.measure}`,
      `    mono (${p.mono.presence}): ${p.mono.used_for.slice(0, 3).join(', ')}… | avoid: ${p.mono.avoid_for[0]}`,
    );
  }
  lines.push(
    '',
    'Rules:',
    '- Copy the chosen personality’s faces AND metrics into typography.* (family, weight_range, default_weight, letter_spacing, line_height, scale, measure, mono_usage, weight_distribution, pairing_rationale, rules).',
    '- Inter / Geist / Geist Mono / Roboto Mono are ALLOWED only when that personality lists them.',
    '- Do NOT invent random Google Fonts or generic “AI SaaS” type recipes.',
    '- Paid faces (Söhne, General Sans, Neue Montreal, ABC Diatype) → open substitutes already mapped.',
    '- Record personality id as design_language.keywords entry "font:<id>".',
    '- Implementers must apply letter-spacing, line-height, and mono presence — not families alone.',
  );
  return lines.join('\n');
}

export function typographyFromPersonality(system: TypographySystem = defaultFontTrio()): {
  display: string;
  body: string;
  technical: string;
  personalityId: FontPersonalityId;
  style: string;
  pairing_rationale: string;
  weight_distribution: string;
  measure: string;
  heading_proportions: string;
  mono: MonoUsageSystem;
  display_metrics: TypeRoleMetrics;
  body_metrics: TypeRoleMetrics;
  technical_metrics: TypeRoleMetrics;
  scale: TypeScaleTokens;
  rules: string[];
} {
  return {
    display: system.display,
    body: system.body,
    technical: system.technical,
    personalityId: system.id,
    style: system.style,
    pairing_rationale: system.pairing_rationale,
    weight_distribution: system.weight_distribution,
    measure: system.measure,
    heading_proportions: system.heading_proportions,
    mono: system.mono,
    display_metrics: system.display_metrics,
    body_metrics: system.body_metrics,
    technical_metrics: system.technical_metrics,
    scale: system.scale,
    rules: system.rules,
  };
}

/** Build Spec-ready typography object from a system. */
export function designSpecTypographyFromSystem(system: TypographySystem) {
  return {
    personality: system.id,
    pairing_rationale: system.pairing_rationale,
    weight_distribution: system.weight_distribution,
    measure: system.measure,
    heading_proportions: system.heading_proportions,
    display: {
      family: system.display,
      role: 'Brand statements, hero headlines, major section headings',
      character: system.feel,
      weight_range: system.display_metrics.weight_range,
      default_weight: system.display_metrics.default_weight,
      letter_spacing: system.display_metrics.letter_spacing,
      line_height: system.display_metrics.line_height,
    },
    body: {
      family: system.body,
      role: 'Descriptions, navigation, supporting content',
      weight_range: system.body_metrics.weight_range,
      default_weight: system.body_metrics.default_weight,
      letter_spacing: system.body_metrics.letter_spacing,
      line_height: system.body_metrics.line_height,
    },
    technical: {
      family: system.technical,
      role: 'Code, labels, system metadata, technical annotations',
      weight_range: system.technical_metrics.weight_range,
      default_weight: system.technical_metrics.default_weight,
      letter_spacing: system.technical_metrics.letter_spacing,
      line_height: system.technical_metrics.line_height,
    },
    scale: { ...system.scale, hero: { ...system.scale.hero } },
    mono_usage: {
      used_for: [...system.mono.used_for],
      avoid_for: [...system.mono.avoid_for],
      size: system.mono.size,
      case_style: system.mono.case_style,
      presence: system.mono.presence,
    },
    rules: [
      ...system.rules,
      `Typography system: ${system.id} (${system.style}).`,
      `Heading proportions: ${system.heading_proportions}`,
      `Mono presence: ${system.mono.presence} — ${system.mono.case_style}`,
    ],
  };
}
