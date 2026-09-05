/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Design Spec v2 helpers for Agent / Automode Design Intelligence.
 * Mirrors @singularity/design Design Specification sheet format.
 */

// Bundled by esbuild
// eslint-disable-next-line @typescript-eslint/no-require-imports
const EXAMPLE_SPEC = require('./designSpecExampleV2.json') as DesignSpecification;

/** Compact EXAMPLE — pretty-print wastes tokens and slows Spec generation. */
export const EXAMPLE_DESIGN_SPEC_JSON = JSON.stringify(EXAMPLE_SPEC);

/** Mirrors @singularity/design TYPOGRAPHY SYSTEM (keep in sync — full system, not faces only). */
const FONT_PERSONALITY_CATALOG = `TYPOGRAPHY SYSTEM (pick ONE — lock FULL type system, not just faces):
Default = experimental (Syne + Manrope + IBM Plex Mono + its weights/tracking/leading/scale/mono rules).
Each Spec must feel like a different intentional brand — never the same site with only fonts swapped.
- experimental: Syne/Manrope/IBM Plex Mono — display wt700 tracking-0.035em lh0.98; body lh1.55; hero clamp(4rem…8.5rem); mono balanced (labels/annotations)
- premium: Space Grotesk/Inter/IBM Plex Mono — display wt600 tracking-0.025em; body lh1.6; restrained scale; mono sparse
- developer: Geist/Inter/Geist Mono — product-sized hero; mono prominent at ~body size (code/CLI/paths)
- editorial: Instrument Serif/Inter/IBM Plex Mono — display wt400; measure 42–58ch; mono sparse (citations)
- bold: Archivo Black/DM Sans/JetBrains Mono — crushed display lh0.92; huge hero; binary weights
- minimal: Geist/Inter/Geist Mono — flat weights (500/400); quiet scale; mono rare
- research: IBM Plex Sans×2 + Plex Mono — modest academic scale; mono for data/figures
- enterprise: Plus Jakarta Sans/Inter/Roboto Mono — trustworthy ladder; mono for IDs/logs
- cybernetic: Space Grotesk/Manrope/JetBrains Mono — mono prominent (agent/terminal panels ≈ body size)
Rules: Copy faces AND metrics (default_weight, letter_spacing, line_height, scale, measure, mono_usage, weight_distribution, pairing_rationale). Tag keywords with font:<id>.`;

type FontTrio = {
	id: string;
	display: string;
	body: string;
	technical: string;
	display_weight: string;
	display_tracking: string;
	display_lh: string;
	body_weight: string;
	body_tracking: string;
	body_lh: string;
	tech_weight: string;
	tech_tracking: string;
	hero_desktop: string;
	hero_mobile: string;
	h2: string;
	body_size: string;
	tech_size: string;
	measure: string;
	mono_presence: 'sparse' | 'balanced' | 'prominent';
	mono_used: string[];
	mono_avoid: string[];
	mono_size: string;
	mono_case: string;
	weights: string;
	proportions: string;
	pairing: string;
};

const FONT_TRIOS: FontTrio[] = [
	{
		id: 'experimental',
		display: 'Syne',
		body: 'Manrope',
		technical: 'IBM Plex Mono',
		display_weight: '700',
		display_tracking: '-0.035em',
		display_lh: '0.98',
		body_weight: '400',
		body_tracking: '-0.01em',
		body_lh: '1.55',
		tech_weight: '450',
		tech_tracking: '0.04em',
		hero_desktop: 'clamp(4rem, 9vw, 8.5rem)',
		hero_mobile: 'clamp(3rem, 14vw, 5rem)',
		h2: 'clamp(2.25rem, 4.5vw, 4.25rem)',
		body_size: '1.0625rem',
		tech_size: '0.75rem',
		measure: '48–62ch for body; hero may break measure as a compositional block',
		mono_presence: 'balanced',
		mono_used: ['system metadata', 'model/route labels', 'diagram annotations'],
		mono_avoid: ['marketing headlines', 'long paragraphs'],
		mono_size: '0.7–0.8× body',
		mono_case: 'Uppercase micro-labels with +0.04em tracking',
		weights: 'Heavy display (700–800) vs light-medium body (400–500)',
		proportions: 'Hero ~5–8× body; large type is a shape',
		pairing: 'Syne kinetic display; Manrope readable UI; Plex Mono system labels',
	},
	{
		id: 'premium',
		display: 'Space Grotesk',
		body: 'Inter',
		technical: 'IBM Plex Mono',
		display_weight: '600',
		display_tracking: '-0.025em',
		display_lh: '1.05',
		body_weight: '400',
		body_tracking: '0',
		body_lh: '1.6',
		tech_weight: '400',
		tech_tracking: '0.02em',
		hero_desktop: 'clamp(3.25rem, 6vw, 5.5rem)',
		hero_mobile: 'clamp(2.5rem, 11vw, 3.75rem)',
		h2: 'clamp(1.85rem, 3.5vw, 3rem)',
		body_size: '1rem',
		tech_size: '0.75rem',
		measure: '55–68ch body',
		mono_presence: 'sparse',
		mono_used: ['API paths', 'IDs', 'timestamps'],
		mono_avoid: ['hero', 'section titles'],
		mono_size: '0.75× body',
		mono_case: 'Normal case',
		weights: 'Restrained: display 600, body 400',
		proportions: 'Hero ~3.5–5× body; calm steps',
		pairing: 'Space Grotesk structured display; Inter polished UI',
	},
	{
		id: 'developer',
		display: 'Geist',
		body: 'Inter',
		technical: 'Geist Mono',
		display_weight: '600',
		display_tracking: '-0.02em',
		display_lh: '1.1',
		body_weight: '400',
		body_tracking: '0',
		body_lh: '1.55',
		tech_weight: '400',
		tech_tracking: '0',
		hero_desktop: 'clamp(2.75rem, 5vw, 4.25rem)',
		hero_mobile: 'clamp(2.25rem, 10vw, 3.25rem)',
		h2: 'clamp(1.65rem, 3vw, 2.35rem)',
		body_size: '0.9375rem',
		tech_size: '0.8125rem',
		measure: '60–72ch docs',
		mono_presence: 'prominent',
		mono_used: ['inline code', 'CLI snippets', 'file paths'],
		mono_avoid: ['emotional marketing headlines'],
		mono_size: '0.9–1.0× body',
		mono_case: 'Normal case always',
		weights: 'UI-flat: display 600, body 400',
		proportions: 'Hero ~3–4× body (product, not billboard)',
		pairing: 'Geist + Inter + Geist Mono as IDE-native',
	},
	{
		id: 'editorial',
		display: 'Instrument Serif',
		body: 'Inter',
		technical: 'IBM Plex Mono',
		display_weight: '400',
		display_tracking: '-0.02em',
		display_lh: '1.12',
		body_weight: '400',
		body_tracking: '0',
		body_lh: '1.65',
		tech_weight: '400',
		tech_tracking: '0.01em',
		hero_desktop: 'clamp(3.5rem, 7vw, 6.5rem)',
		hero_mobile: 'clamp(2.75rem, 12vw, 4.25rem)',
		h2: 'clamp(2rem, 4vw, 3.25rem)',
		body_size: '1.125rem',
		tech_size: '0.75rem',
		measure: '42–58ch — literary column',
		mono_presence: 'sparse',
		mono_used: ['figure captions', 'citations'],
		mono_avoid: ['primary headlines', 'nav'],
		mono_size: '0.7× body',
		mono_case: 'Uppercase captions +0.06em',
		weights: 'Editorial book weight display (400)',
		proportions: 'Hero ~4–6× body with open leading',
		pairing: 'Instrument Serif + Inter + Plex Mono citations',
	},
	{
		id: 'bold',
		display: 'Archivo Black',
		body: 'DM Sans',
		technical: 'JetBrains Mono',
		display_weight: '400',
		display_tracking: '-0.01em',
		display_lh: '0.92',
		body_weight: '400',
		body_tracking: '0',
		body_lh: '1.5',
		tech_weight: '500',
		tech_tracking: '0.02em',
		hero_desktop: 'clamp(4.5rem, 10vw, 9rem)',
		hero_mobile: 'clamp(3.25rem, 15vw, 5.5rem)',
		h2: 'clamp(2.5rem, 5vw, 4.5rem)',
		body_size: '1.0625rem',
		tech_size: '0.8rem',
		measure: '40–55ch',
		mono_presence: 'balanced',
		mono_used: ['error codes', 'build tags'],
		mono_avoid: ['long prose'],
		mono_size: '0.8× body',
		mono_case: 'Uppercase labels +0.08em',
		weights: 'Binary: black display vs regular body',
		proportions: 'Hero ~6–9× body, compressed',
		pairing: 'Archivo Black blunt display; DM Sans body',
	},
	{
		id: 'minimal',
		display: 'Geist',
		body: 'Inter',
		technical: 'Geist Mono',
		display_weight: '500',
		display_tracking: '-0.015em',
		display_lh: '1.15',
		body_weight: '400',
		body_tracking: '0',
		body_lh: '1.6',
		tech_weight: '400',
		tech_tracking: '0',
		hero_desktop: 'clamp(2.75rem, 5vw, 4.5rem)',
		hero_mobile: 'clamp(2.25rem, 10vw, 3.25rem)',
		h2: 'clamp(1.75rem, 3vw, 2.5rem)',
		body_size: '1rem',
		tech_size: '0.8125rem',
		measure: '52–64ch',
		mono_presence: 'sparse',
		mono_used: ['rare inline code'],
		mono_avoid: ['hero', 'nav'],
		mono_size: '0.85× body',
		mono_case: 'Normal case',
		weights: 'Flat: display 500, body 400',
		proportions: 'Hero ~3–4× body; soft steps',
		pairing: 'Quiet Geist + Inter',
	},
	{
		id: 'research',
		display: 'IBM Plex Sans',
		body: 'IBM Plex Sans',
		technical: 'IBM Plex Mono',
		display_weight: '600',
		display_tracking: '-0.01em',
		display_lh: '1.15',
		body_weight: '400',
		body_tracking: '0',
		body_lh: '1.6',
		tech_weight: '400',
		tech_tracking: '0',
		hero_desktop: 'clamp(2.5rem, 4.5vw, 3.75rem)',
		hero_mobile: 'clamp(2rem, 9vw, 2.75rem)',
		h2: 'clamp(1.5rem, 2.5vw, 2rem)',
		body_size: '1rem',
		tech_size: '0.8125rem',
		measure: '60–72ch (paper-like)',
		mono_presence: 'balanced',
		mono_used: ['figure axes', 'dataset IDs'],
		mono_avoid: ['emotional marketing'],
		mono_size: '0.85–0.95× body',
		mono_case: 'Normal case; tabular figures',
		weights: 'Semibold titles, Regular body',
		proportions: 'Modest hero ~2.5–3.5× body',
		pairing: 'Single Plex Sans family + Plex Mono data',
	},
	{
		id: 'enterprise',
		display: 'Plus Jakarta Sans',
		body: 'Inter',
		technical: 'Roboto Mono',
		display_weight: '650',
		display_tracking: '-0.02em',
		display_lh: '1.1',
		body_weight: '400',
		body_tracking: '0',
		body_lh: '1.55',
		tech_weight: '400',
		tech_tracking: '0.01em',
		hero_desktop: 'clamp(2.75rem, 5vw, 4rem)',
		hero_mobile: 'clamp(2.25rem, 10vw, 3rem)',
		h2: 'clamp(1.65rem, 3vw, 2.25rem)',
		body_size: '1rem',
		tech_size: '0.75rem',
		measure: '58–70ch',
		mono_presence: 'sparse',
		mono_used: ['account IDs', 'audit logs'],
		mono_avoid: ['headlines'],
		mono_size: '0.75× body',
		mono_case: 'Normal case',
		weights: 'Semibold display, Regular body',
		proportions: 'Hero ~3–4× body; corporate ladder',
		pairing: 'Jakarta + Inter + Roboto Mono ops',
	},
	{
		id: 'cybernetic',
		display: 'Space Grotesk',
		body: 'Manrope',
		technical: 'JetBrains Mono',
		display_weight: '600',
		display_tracking: '-0.03em',
		display_lh: '1.0',
		body_weight: '400',
		body_tracking: '-0.005em',
		body_lh: '1.55',
		tech_weight: '500',
		tech_tracking: '0',
		hero_desktop: 'clamp(3.5rem, 7vw, 6.5rem)',
		hero_mobile: 'clamp(2.75rem, 12vw, 4.25rem)',
		h2: 'clamp(2rem, 4vw, 3.5rem)',
		body_size: '1rem',
		tech_size: '0.875rem',
		measure: '50–64ch; agent panels may be full-bleed mono',
		mono_presence: 'prominent',
		mono_used: ['agent transcripts', 'terminal panels', 'tool call traces'],
		mono_avoid: ['long brand essays'],
		mono_size: '0.9–1.05× body',
		mono_case: 'Normal case for streams',
		weights: 'Display 600 + mono 500 for agent output',
		proportions: 'Hero ~4–6×; mono panels ≈ body size',
		pairing: 'Space Grotesk + Manrope + JetBrains agent surfaces',
	},
];

function resolveFontTrio(prompt: string): FontTrio {
	const blob = prompt.toLowerCase();
	const hit = (re: RegExp) => re.test(blob);
	const pick = (id: string) => FONT_TRIOS.find((t) => t.id === id) ?? FONT_TRIOS[0]!;
	if (hit(/\b(editorial|intellectual|serif|literary|journal|magazine)\b/)) return pick('editorial');
	if (hit(/\b(enterprise|corporate|b2b|trustworthy|compliance|professional)\b/)) return pick('enterprise');
	if (hit(/\b(research|scientific|lab|academic|paper|credibility)\b/)) return pick('research');
	if (hit(/\b(brutal|disrupt|aggressive|loud|bold|archivo)\b/)) return pick('bold');
	if (hit(/\b(cyber|agentic|autonomous|infra|infrastructure|ops|agent)\b/)
		&& hit(/\b(technical|tech|futur|agent)\b/)) {
		return pick('cybernetic');
	}
	if (hit(/\b(developer|ide|engineering|devtools|platform|sdk|cli|vercel|cursor)\b/)) return pick('developer');
	if (hit(/\b(minimal|quiet|restrained|apple|clean\s*modern)\b/)) return pick('minimal');
	if (hit(/\b(premium|sophisticated|luxury|polished|frontier|saas)\b/)) return pick('premium');
	if (hit(/\b(experimental|futuristic|creative|kinetic|whimsy)\b/)) return pick('experimental');
	return pick('experimental');
}

export interface DesignSpecification {
	version: 2;
	meta: {
		spec_type: string;
		design_intent: string;
		design_priority: string[];
		decision_rule: string;
	};
	product: {
		name: string;
		category: string;
		audience: {
			primary: string;
			secondary: string[];
			technical_level: string;
		};
		product_character: string[];
		brand_promise: string;
		brand_personality: {
			should_feel: string[];
			should_not_feel: string[];
		};
		primary_user_action: string;
		conversion_goal: { primary: string; secondary: string };
	};
	design_strategy: {
		concept: string;
		central_idea: {
			statement: string;
			visual_metaphor: string;
			principle: string;
		};
		design_language: {
			keywords: string[];
			density: string;
			visual_complexity: string;
			surface_treatment: string;
			ornamentation: string;
		};
		design_differentiator: { description: string; requirement: string };
	};
	visual_identity: {
		color: {
			background: string;
			foreground: string;
			primary: string;
			accent: string;
			muted: string;
			border: string;
			usage_rules?: Record<string, string>;
			constraints?: string[];
		};
		contrast: { hierarchy: string[]; rule: string };
	};
	typography: {
		personality?: string;
		pairing_rationale?: string;
		weight_distribution?: string;
		measure?: string;
		heading_proportions?: string;
		display: {
			family: string;
			role?: string;
			character?: string;
			weight_range?: string;
			default_weight?: string;
			letter_spacing?: string;
			line_height?: string;
		};
		body: {
			family: string;
			role?: string;
			weight_range?: string;
			default_weight?: string;
			letter_spacing?: string;
			line_height?: string;
		};
		technical: {
			family: string;
			role?: string;
			weight_range?: string;
			default_weight?: string;
			letter_spacing?: string;
			line_height?: string;
		};
		scale?: Record<string, unknown>;
		mono_usage?: {
			used_for?: string[];
			avoid_for?: string[];
			size?: string;
			case_style?: string;
			presence?: string;
		};
		rules?: string[];
	};
	layout_system: {
		max_width: string;
		grid?: Record<string, string>;
		spacing_unit?: string;
		section_spacing?: Record<string, string>;
		alignment?: Record<string, string>;
		composition_rules?: string[];
	};
	navigation?: Record<string, unknown>;
	hero: {
		strategy: string;
		priority_order?: string[];
		headline?: Record<string, unknown>;
		supporting_copy?: Record<string, unknown>;
		composition?: Record<string, unknown>;
		visual_concept: { type: string; purpose: string; required?: boolean };
		cta?: Record<string, unknown>;
	};
	signature_element: {
		type: string;
		purpose: string;
		requirements?: string[];
		visual_language?: Record<string, string>;
		animation?: Record<string, unknown>;
	};
	information_architecture?: Record<string, unknown>;
	content_system?: Record<string, unknown>;
	component_system?: Record<string, unknown>;
	product_visualization?: Record<string, unknown>;
	responsive_design?: Record<string, unknown>;
	motion: {
		philosophy: string;
		allowed: string[];
		timing?: Record<string, string>;
		rules?: string[];
	};
	interaction_design?: Record<string, unknown>;
	accessibility?: Record<string, unknown>;
	imagery: {
		strategy: string;
		priority?: string[];
		avoid?: string[];
	};
	iconography?: Record<string, unknown>;
	technical_implementation?: Record<string, unknown>;
	performance?: Record<string, unknown>;
	design_anti_patterns: { explicitly_prohibited: string[] };
	references?: { provided?: string[]; reference_usage?: Record<string, unknown> };
	design_decisions?: {
		locked?: string[];
		flexible?: string[];
		unresolved?: string[];
	};
	quality_bar?: Record<string, unknown>;
	generation_directive?: Record<string, unknown>;
	notes?: string[];
	createdAt?: number;
}

const DEFAULT_AVOID = [
	'generic AI SaaS landing page',
	'blue-purple gradients',
	'dark zinc + purple defaults',
	'Lucide icon feature grids',
	'Inter/Geist as lazy default (only when Spec font personality lists them)',
	'MeshDistortMaterial / decorative 3D blobs',
	'fade-in on every section',
];

function faceFamily(v: unknown, fallback: string): string {
	if (typeof v === 'string' && v.trim()) {
		return v.trim();
	}
	if (v && typeof v === 'object' && typeof (v as { family?: string }).family === 'string') {
		return (v as { family: string }).family;
	}
	return fallback;
}

/** True when on-disk Spec was the static heuristic fallback — must be regenerated. */
export function isHeuristicDesignSpec(spec: DesignSpecification): boolean {
	const notes = (spec.notes ?? []).join(' ');
	if (/Heuristic Design Spec/i.test(notes)) {
		return true;
	}
	// Legacy v1 heuristic concepts (migrated specs may still carry these)
	const concept = spec.design_strategy?.concept ?? '';
	if (
		(concept === 'Product-first branded experience' || concept === 'Control-plane for model routing')
		&& /Heuristic|fallback|static/i.test(notes)
	) {
		return true;
	}
	return false;
}

/**
 * Accept v2 sheets or migrate legacy v1 flat Specs into v2.
 */
export function validateSpec(raw: Record<string, unknown> | Partial<DesignSpecification>): DesignSpecification {
	if (!raw || typeof raw !== 'object') {
		throw new Error('incomplete-spec');
	}

	const isV2 =
		raw.version === 2
		|| Boolean((raw as DesignSpecification).design_strategy)
		|| Boolean((raw as DesignSpecification).visual_identity)
		|| (typeof (raw as { typography?: { display?: unknown } }).typography?.display === 'object');

	if (isV2) {
		const s = raw as Partial<DesignSpecification>;
		if (!s.design_strategy?.concept || !s.design_strategy.central_idea?.visual_metaphor) {
			throw new Error('incomplete-spec');
		}
		if (!s.visual_identity?.color?.background || !s.visual_identity.color.accent) {
			throw new Error('incomplete-color');
		}
		if (!s.typography?.display || !faceFamily(s.typography.display, '') || !faceFamily(s.typography.body, '')) {
			throw new Error('incomplete-type');
		}
		if (!s.hero?.visual_concept?.type && !s.hero?.visual_concept?.purpose) {
			throw new Error('incomplete-hero');
		}
		if (!s.signature_element?.purpose) {
			throw new Error('incomplete-hero');
		}
		return {
			...EXAMPLE_SPEC,
			...s,
			version: 2,
			product: { ...EXAMPLE_SPEC.product, ...s.product },
			design_strategy: {
				...EXAMPLE_SPEC.design_strategy,
				...s.design_strategy,
				central_idea: {
					...EXAMPLE_SPEC.design_strategy.central_idea,
					...s.design_strategy?.central_idea,
				},
				design_language: {
					...EXAMPLE_SPEC.design_strategy.design_language,
					...s.design_strategy?.design_language,
				},
			},
			visual_identity: {
				...EXAMPLE_SPEC.visual_identity,
				...s.visual_identity,
				color: {
					...EXAMPLE_SPEC.visual_identity.color,
					...s.visual_identity?.color,
				},
			},
			typography: {
				...EXAMPLE_SPEC.typography,
				...s.typography,
				display: {
					...EXAMPLE_SPEC.typography.display,
					...(typeof s.typography?.display === 'object' ? s.typography.display : { family: faceFamily(s.typography?.display, 'Syne') }),
				},
				body: {
					...EXAMPLE_SPEC.typography.body,
					...(typeof s.typography?.body === 'object' ? s.typography.body : { family: faceFamily(s.typography?.body, 'Manrope') }),
				},
				technical: {
					...EXAMPLE_SPEC.typography.technical,
					...(typeof s.typography?.technical === 'object' ? s.typography.technical : { family: faceFamily(s.typography?.technical, 'IBM Plex Mono') }),
				},
			},
			hero: {
				...EXAMPLE_SPEC.hero,
				...s.hero,
				visual_concept: {
					...EXAMPLE_SPEC.hero.visual_concept,
					...s.hero?.visual_concept,
				},
			},
			signature_element: {
				...EXAMPLE_SPEC.signature_element,
				...s.signature_element,
			},
			motion: {
				...EXAMPLE_SPEC.motion,
				...s.motion,
				allowed: s.motion?.allowed ?? EXAMPLE_SPEC.motion.allowed,
			},
			imagery: {
				...EXAMPLE_SPEC.imagery,
				...s.imagery,
			},
			design_anti_patterns: {
				explicitly_prohibited:
					s.design_anti_patterns?.explicitly_prohibited?.length
						? s.design_anti_patterns.explicitly_prohibited
						: [...DEFAULT_AVOID],
			},
			notes: s.notes,
			createdAt: Date.now(),
		};
	}

	// Legacy v1 → v2
	const product = (raw.product ?? {}) as Record<string, unknown>;
	const art = (raw.art_direction ?? {}) as Record<string, unknown>;
	const color = (raw.color ?? {}) as Record<string, unknown>;
	const type = (raw.typography ?? {}) as Record<string, unknown>;
	const layout = (raw.layout ?? {}) as Record<string, unknown>;
	const hero = (raw.hero ?? {}) as Record<string, unknown>;
	const sig = (raw.signature_element ?? {}) as Record<string, unknown>;
	const motion = (raw.motion ?? {}) as Record<string, unknown>;
	const imagery = (raw.imagery ?? {}) as Record<string, unknown>;
	const avoid = Array.isArray(raw.avoid) ? (raw.avoid as string[]) : [...DEFAULT_AVOID];

	if (!art.concept || !art.visual_metaphor) {
		throw new Error('incomplete-spec');
	}
	if (!color.background || !color.accent) {
		throw new Error('incomplete-color');
	}
	if (!faceFamily(type.display, '') || !faceFamily(type.body, '')) {
		throw new Error('incomplete-type');
	}
	const heroVisual = String(hero.visual_concept ?? '');
	const sigDesc = String(sig.description ?? sig.purpose ?? '');
	if (!heroVisual || !sigDesc) {
		throw new Error('incomplete-hero');
	}

	const audienceStr =
		typeof product.audience === 'string'
			? product.audience
			: String((product.audience as { primary?: string } | undefined)?.primary ?? 'users');

	return validateSpec({
		version: 2,
		meta: EXAMPLE_SPEC.meta,
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
				.map((x) => x.trim())
				.filter(Boolean),
			brand_promise: String(art.concept),
			brand_personality: {
				should_feel: ['intentional', 'credible'],
				should_not_feel: ['generic', 'template-generated'],
			},
			primary_user_action: 'Understand the product and start using it.',
			conversion_goal: { primary: 'Get started', secondary: 'Explore' },
		},
		design_strategy: {
			concept: String(art.concept),
			central_idea: {
				statement: String(art.concept),
				visual_metaphor: String(art.visual_metaphor),
				principle: 'Every major visual element should communicate product, hierarchy, or brand.',
			},
			design_language: {
				keywords: String(art.design_language ?? '')
					.split(/[,;]/)
					.map((x) => x.trim())
					.filter(Boolean),
				density: String(layout.density ?? 'medium'),
				visual_complexity: 'controlled',
				surface_treatment: 'minimal',
				ornamentation: 'low',
			},
			design_differentiator: {
				description: 'Avoid generic AI SaaS templates.',
				requirement: 'At least one composition must be unmistakable for this product.',
			},
		},
		visual_identity: {
			color: {
				background: String(color.background),
				foreground: String(color.foreground ?? '#111'),
				primary: String(color.primary ?? color.background),
				accent: String(color.accent),
				muted: String(color.muted ?? ''),
				border: String(color.border ?? color.borders ?? ''),
			},
			contrast: EXAMPLE_SPEC.visual_identity.contrast,
		},
		typography: {
			display: { family: faceFamily(type.display, 'Syne'), role: 'headlines', weight_range: '600-800' },
			body: { family: faceFamily(type.body, 'Manrope'), role: 'body', weight_range: '400-600' },
			technical: { family: faceFamily(type.technical, 'IBM Plex Mono'), role: 'mono', weight_range: '400-500' },
		},
		layout_system: {
			max_width: String(layout.max_width ?? '1200px'),
			composition_rules: [String(layout.philosophy ?? 'brand-first')],
		},
		hero: {
			strategy: String(hero.strategy ?? 'brand-first'),
			visual_concept: {
				type: 'custom SVG / CSS product diagram',
				purpose: heroVisual,
				required: true,
			},
			headline: { treatment: String(hero.headline_treatment ?? 'dominant') },
		},
		signature_element: {
			type: String(sig.type ?? 'custom SVG diagram'),
			purpose: sigDesc,
			requirements: [String(sig.relationship_to_product ?? '')].filter(Boolean),
		},
		motion: {
			philosophy: String(motion.philosophy ?? 'Motion communicates system behavior, not decoration.'),
			allowed: Array.isArray(motion.allowed) ? (motion.allowed as string[]) : [],
			rules: Array.isArray(motion.prohibited)
				? (motion.prohibited as string[]).map((p) => `Do not: ${p}`)
				: [],
		},
		imagery: {
			strategy: String((imagery.strategy as string) ?? 'Prefer product-specific visuals'),
		},
		design_anti_patterns: { explicitly_prohibited: avoid },
		notes: Array.isArray(raw.notes) ? (raw.notes as string[]) : undefined,
	});
}

export function formatSpecPrompt(spec: DesignSpecification): string {
	const avoid = spec.design_anti_patterns?.explicitly_prohibited?.length
		? spec.design_anti_patterns.explicitly_prohibited
		: DEFAULT_AVOID;
	return [
		'DESIGN SPECIFICATION v2 (authoritative — implement this; do not reinvent art direction)',
		'────────────────────────────────────────',
		`Product: ${spec.product.name} · ${spec.product.category}`,
		`Audience: ${spec.product.audience.primary} (${spec.product.audience.technical_level})`,
		`Character: ${spec.product.product_character.join(', ')}`,
		`Brand promise: ${spec.product.brand_promise}`,
		`Feel: ${spec.product.brand_personality.should_feel.join(', ')}`,
		`Not: ${spec.product.brand_personality.should_not_feel.join(', ')}`,
		`CTA: ${spec.product.conversion_goal.primary} / ${spec.product.conversion_goal.secondary}`,
		`Strategy: ${spec.design_strategy.concept}`,
		`Metaphor: ${spec.design_strategy.central_idea.visual_metaphor}`,
		`Language: ${spec.design_strategy.design_language.keywords.join(', ')}`,
		`Color: bg ${spec.visual_identity.color.background} · fg ${spec.visual_identity.color.foreground} · accent ${spec.visual_identity.color.accent}`,
		`Type: display ${spec.typography.display.family} · body ${spec.typography.body.family} · mono ${spec.typography.technical.family}`,
		`Layout: max ${spec.layout_system.max_width}`,
		`Hero: ${spec.hero.strategy}`,
		`Hero visual: ${spec.hero.visual_concept.type} — ${spec.hero.visual_concept.purpose}`,
		`Signature: ${spec.signature_element.type} — ${spec.signature_element.purpose}`,
		`Motion: ${spec.motion.philosophy}; allowed=${spec.motion.allowed.join('; ')}`,
		`Imagery: ${spec.imagery.strategy}`,
		`Component libraries (MUST install & use): ${((spec.technical_implementation?.component_libraries as string[] | undefined) ?? ['react-bits', 'godui', 'shadcn']).join(', ')}`,
		'  React Bits: npx shadcn@latest add @react-bits/<Component>-TS-TW',
		'  GodUI: MCP @godui/mcp OR npx shadcn@latest add "https://godui.design/r/<component>.json"',
		`Locked: ${(spec.design_decisions?.locked ?? []).join('; ')}`,
		'Avoid:',
		...avoid.map((a) => `  - ${a}`),
	].join('\n');
}

export const DIRECTOR_SYSTEM_V2 = `You are Singularity's Design Director (DeepSeek V4 Flash-0731) for Agent mode.
You OWN art direction ONLY. Do NOT write React/CSS implementation.

You will receive an ACTIVE AGENCY SKILL (specialist persona), an EXAMPLE Design Spec v2 (structure + quality), and a USER REQUEST.
Embody the agency skill's expertise and critical rules when inventing art direction.
Design something similar in depth and originality for the USER REQUEST — do NOT copy the example's product name, palette, or metaphor.

Return ONLY a single valid JSON object (no markdown fences, no commentary).
Rules for JSON validity:
- Use double quotes for all keys and string values (never single quotes)
- No trailing commas
- No comments
- Keep string values reasonably short (avoid multi-paragraph essays inside fields)

Include version: 2 and the same top-level keys as the EXAMPLE:
meta, product, design_strategy, visual_identity, typography, layout_system, navigation, hero,
signature_element, information_architecture, content_system, component_system, product_visualization,
responsive_design, motion, interaction_design, accessibility, imagery, iconography,
technical_implementation, performance, design_anti_patterns, references, design_decisions,
quality_bar, generation_directive.

Requirements:
- Spec must change meaningfully when the USER REQUEST changes
- Product-specific visual metaphor and signature element (SVG/diagram/data viz preferred)
- Ban automatic zinc+blue-purple / lazy Inter-Geist (unless Spec personality lists them) / Lucide icon grids / MeshDistort blobs unless justified
- Brand-first hero strategy
- Typography: choose ONE full typography system (faces + weights + tracking + leading + scale + measure + mono usage).
  Default = experimental → Syne + Manrope + IBM Plex Mono (+ its metrics).
  Inter/Geist/Geist Mono allowed ONLY when that personality lists them.
  Never Roboto/Arial/system-ui as the distinctive display face.
  Do NOT only swap font families — each Spec must produce a recognizably different typographic brand.

${FONT_PERSONALITY_CATALOG}

- technical_implementation MUST lock Singularity defaults:
  component_libraries: ["react-bits", "godui", "shadcn"]
  (React Bits for text/backgrounds; GodUI for motion controls/overlays/icons; shadcn for primitives)
- Treat the Spec as a design-system contract, not a loose suggestion`;

/**
 * Starter Spec when Design Director LLM fails — valid v2 sheet with React Bits + GodUI locked.
 * Marked heuristic so a later successful Director run can replace it.
 */
export function buildStarterDesignSpec(userPrompt: string): DesignSpecification {
	const gist = userPrompt.trim().slice(0, 80) || 'Product';
	const nameMatch = gist.match(/\b([A-Z][A-Za-z0-9]+)\b/);
	const productName = nameMatch?.[1] && !/Hello|World|React|Build|Create|Simple|Page/i.test(nameMatch[1])
		? nameMatch[1]
		: 'Studio';
	const trio = resolveFontTrio(userPrompt);
	const fontLock = `${trio.display} + ${trio.body} + ${trio.technical}`;
	return {
		version: 2,
		meta: {
			spec_type: 'frontend_design_directive',
			design_intent: 'Starter art direction so frontend can ship while Director recovers.',
			design_priority: ['product clarity', 'motion craft', 'brand distinctiveness'],
			decision_rule: 'Prefer product clarity; use React Bits + GodUI for craft, not as the brand.',
		},
		product: {
			name: productName,
			category: /dashboard|saas|admin/i.test(gist) ? 'SaaS application' : 'Product website',
			audience: { primary: 'end users', secondary: [], technical_level: 'general' },
			product_character: ['clear', 'polished', 'intentional'],
			brand_promise: gist.slice(0, 120),
			brand_personality: {
				should_feel: ['confident', 'modern', 'crafted'],
				should_not_feel: ['generic', 'template', 'AI-slop'],
			},
			primary_user_action: 'Get started',
			conversion_goal: { primary: 'Engage', secondary: 'Explore' },
		},
		design_strategy: {
			concept: 'Product-first branded experience',
			central_idea: {
				statement: 'The interface announces the product before any chrome.',
				visual_metaphor: 'signature product mark + clear hierarchy',
				principle: 'Every motion and component earns its place.',
			},
			design_language: {
				keywords: ['editorial', 'kinetic', 'restrained', `font:${trio.id}`],
				density: 'medium',
				visual_complexity: 'controlled',
				surface_treatment: 'minimal',
				ornamentation: 'low',
			},
			design_differentiator: {
				description: 'Motion from React Bits + GodUI under a distinctive Spec palette.',
				requirement: 'Cannot be mistaken for zinc+purple SaaS template.',
			},
		},
		visual_identity: {
			color: {
				background: '#0c1210',
				foreground: '#eef3ef',
				primary: '#0c1210',
				accent: '#3dff9a',
				muted: '#8a968c',
				border: '#1c2820',
				usage_rules: {
					background: 'canvas',
					foreground: 'text',
					muted: 'secondary',
					accent: 'signals / CTAs',
					border: 'structure',
				},
				constraints: ['No blue-purple gradients', 'No dark zinc + indigo identity'],
			},
			contrast: {
				hierarchy: ['foreground on background', 'accent for CTAs'],
				rule: 'WCAG AA for body text',
			},
		},
		typography: {
			personality: trio.id,
			pairing_rationale: trio.pairing,
			weight_distribution: trio.weights,
			measure: trio.measure,
			heading_proportions: trio.proportions,
			display: {
				family: trio.display,
				role: 'headlines',
				weight_range: trio.display_weight,
				default_weight: trio.display_weight,
				letter_spacing: trio.display_tracking,
				line_height: trio.display_lh,
			},
			body: {
				family: trio.body,
				role: 'body',
				weight_range: trio.body_weight,
				default_weight: trio.body_weight,
				letter_spacing: trio.body_tracking,
				line_height: trio.body_lh,
			},
			technical: {
				family: trio.technical,
				role: 'code/meta',
				weight_range: trio.tech_weight,
				default_weight: trio.tech_weight,
				letter_spacing: trio.tech_tracking,
				line_height: '1.4',
			},
			scale: {
				hero: { desktop: trio.hero_desktop, mobile: trio.hero_mobile },
				h2: trio.h2,
				h3: 'clamp(1.25rem, 2vw, 1.5rem)',
				body: trio.body_size,
				small: '0.875rem',
				technical: trio.tech_size,
			},
			mono_usage: {
				used_for: trio.mono_used,
				avoid_for: trio.mono_avoid,
				size: trio.mono_size,
				case_style: trio.mono_case,
				presence: trio.mono_presence,
			},
		},
		layout_system: {
			max_width: '1280px',
			grid: { type: 'responsive CSS grid' },
			composition_rules: ['one job per section', 'brand-first hero'],
		},
		navigation: {
			style: 'minimal top nav',
			items: ['Product', 'Docs'],
		},
		hero: {
			strategy: 'brand-first',
			composition: { summary: 'brand + headline + one sentence + CTA + product visual' },
			visual_concept: {
				type: 'custom SVG / product diagram',
				purpose: 'Communicate the product; elevate with React Bits text/background',
				required: true,
			},
		},
		signature_element: {
			type: 'product diagram',
			purpose: 'One custom SVG that communicates the product',
		},
		motion: {
			philosophy: '2–3 intentional motions; transform/opacity only',
			allowed: ['React Bits text/background entrance', 'GodUI CTA / overlay spring', 'reduced-motion fallback'],
			rules: ['No fade-up on every section', 'prefers-reduced-motion required'],
		},
		imagery: {
			strategy: 'product-first',
			priority: ['custom SVG', 'screenshot', 'diagram'],
			avoid: ['generic AI illustrations', 'MeshDistort orbs'],
		},
		technical_implementation: {
			component_libraries: ['react-bits', 'godui', 'shadcn'],
			install: {
				'react-bits': 'npx shadcn@latest add @react-bits/<Component>-TS-TW',
				godui: 'GodUI MCP (@godui/mcp) or npx shadcn@latest add "https://godui.design/r/<component>.json"',
				shadcn: 'primitives under components/ui',
			},
			stack: 'React + TypeScript + Tailwind when possible',
		},
		design_anti_patterns: {
			explicitly_prohibited: [
				...DEFAULT_AVOID,
				'shipping without installing React Bits and GodUI',
				'imitating library look from memory instead of installing components',
			],
		},
		design_decisions: {
			locked: [
				'component_libraries: react-bits + godui + shadcn',
				`display ${trio.display} / body ${trio.body} / mono ${trio.technical}`,
			],
			flexible: ['exact accent hue within Spec constraints'],
			unresolved: ['full Director art direction when LLM recovers'],
		},
		notes: [
			'Heuristic Design Spec — Director LLM unavailable; regenerate on next full Director run.',
			'MUST install React Bits + GodUI for real; restyle to this Spec.',
		],
		createdAt: Date.now(),
	};
}

export function buildDirectorUserPrompt(
	userPrompt: string,
	options?: { agencySkillPrompt?: string },
): string {
	const parts: string[] = [];
	if (options?.agencySkillPrompt?.trim()) {
		parts.push(
			options.agencySkillPrompt.trim(),
			'',
			'Use the ACTIVE AGENCY SKILL above as the specialist lens for art direction.',
			'Then fill the Design Spec template below for the USER REQUEST.',
			'',
		);
	}
	parts.push(
		'EXAMPLE Design Specification v2 (structure + quality reference ONLY — compact JSON).',
		'Design something similar in depth and originality — but for the USER REQUEST below.',
		'Do NOT copy Northline, copper, cream paper, or the freight-map metaphor unless the user request is literally that product.',
		'Typography: choose ONE full typography system (faces + weights + tracking + leading + scale + mono); default experimental.',
		FONT_PERSONALITY_CATALOG,
		'Fill every major section of the v2 sheet with product-specific decisions derived from the USER REQUEST.',
		'Respond with compact valid JSON only (double quotes, no trailing commas).',
		'',
		EXAMPLE_DESIGN_SPEC_JSON,
		'',
		'USER REQUEST (invent a unique Design Spec v2 for this):',
		userPrompt.trim(),
		'',
		'Make choices that would clearly change if the USER REQUEST changed.',
	);
	return parts.join('\n');
}

/** Extract + lightly repair LLM JSON before JSON.parse. */
export function parseDesignSpecLlmJson(text: string): Record<string, unknown> {
	const fence = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/);
	let raw = fence ? fence[1]!.trim() : text.trim();
	const balanced = extractBalancedJsonObject(raw);
	if (balanced) {
		raw = balanced;
	} else {
		const start = raw.indexOf('{');
		const end = raw.lastIndexOf('}');
		if (start < 0 || end <= start) {
			throw new Error('no-json');
		}
		raw = raw.slice(start, end + 1);
	}

	const attempts = [
		raw,
		repairLooseJson(raw),
		truncateAfterFirstJsonValue(raw),
		repairLooseJson(truncateAfterFirstJsonValue(raw)),
	];
	let lastErr: unknown;
	for (const candidate of attempts) {
		if (!candidate.trim()) {
			continue;
		}
		try {
			return JSON.parse(candidate) as Record<string, unknown>;
		} catch (e) {
			lastErr = e;
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error('invalid-json');
}

/** First top-level `{...}` with string-aware brace matching (drops trailing prose / second objects). */
export function extractBalancedJsonObject(text: string): string | undefined {
	let start = -1;
	let depth = 0;
	let inString = false;
	let escape = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (inString) {
			if (escape) {
				escape = false;
				continue;
			}
			if (c === '\\') {
				escape = true;
				continue;
			}
			if (c === '"') {
				inString = false;
			}
			continue;
		}
		if (c === '"') {
			inString = true;
			continue;
		}
		if (c === '{') {
			if (depth === 0) {
				start = i;
			}
			depth += 1;
			continue;
		}
		if (c === '}') {
			if (depth === 0) {
				continue;
			}
			depth -= 1;
			if (depth === 0 && start >= 0) {
				return text.slice(start, i + 1);
			}
		}
	}
	return undefined;
}

/** If parse fails due to trailing junk after a value, keep through the first balanced object. */
function truncateAfterFirstJsonValue(input: string): string {
	const balanced = extractBalancedJsonObject(input);
	return balanced ?? input;
}

function repairLooseJson(input: string): string {
	let s = input;
	// trailing commas before } or ]
	s = s.replace(/,\s*([}\]])/g, '$1');
	// Python/JS single-quoted keys: 'key':
	s = s.replace(/([{,]\s*)'([^'\\]+)'\s*:/g, '$1"$2":');
	// single-quoted simple string values: : 'value'
	s = s.replace(/:\s*'([^'\\]*)'/g, ': "$1"');
	// bare single-quoted keys at line starts
	s = s.replace(/(^|\n)\s*'([^'\\]+)'\s*:/g, '$1"$2":');
	// common LLM trailing commentary after the closing brace
	const balanced = extractBalancedJsonObject(s);
	if (balanced) {
		s = balanced;
	}
	return s;
}
