/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import {
	MAX_GENERICNESS,
	MAX_VISUAL_ITERATIONS,
	MIN_BRAND,
	mergeBriefWithDesignSpec,
	ensureDesignIntelligenceForTurn,
	resetDesignIntelligenceSessions,
	runDesignDirectorForAgent,
	runVisualCriticForAgentStop,
	scanWorkspaceForGenericSlop,
	setFrontendSessionActive,
} from '../../node/designIntelligence';

/** Minimal valid Design Spec v2 payload from a mocked Director LLM. */
function mockV2Spec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		version: 2,
		meta: {
			spec_type: 'frontend_design_directive',
			design_intent: 'Define visual language before generation.',
			design_priority: ['product clarity', 'brand distinctiveness'],
			decision_rule: 'Prefer product clarity over novelty.',
		},
		product: {
			name: 'LaunchPad',
			category: 'AI infrastructure',
			audience: { primary: 'developers', secondary: [], technical_level: 'advanced' },
			product_character: ['precise', 'technical'],
			brand_promise: 'Make model routing feel controllable.',
			brand_personality: {
				should_feel: ['intelligent', 'credible'],
				should_not_feel: ['generic', 'hyped'],
			},
			primary_user_action: 'Start routing',
			conversion_goal: { primary: 'Start building', secondary: 'Explore' },
		},
		design_strategy: {
			concept: 'Signal-path control plane',
			central_idea: {
				statement: 'The interface explains routing.',
				visual_metaphor: 'client → router → inference',
				principle: 'Every element communicates product or brand.',
			},
			design_language: {
				keywords: ['editorial', 'technical', 'restrained'],
				density: 'medium',
				visual_complexity: 'controlled',
				surface_treatment: 'minimal',
				ornamentation: 'low',
			},
			design_differentiator: {
				description: 'Workflow becomes identity.',
				requirement: 'One composition cannot be mistaken for generic SaaS.',
			},
		},
		visual_identity: {
			color: {
				background: '#07090c',
				foreground: '#eef2f5',
				primary: '#07090c',
				accent: '#2dff9a',
				muted: '#8b939c',
				border: '#1c2228',
				usage_rules: {
					background: 'canvas',
					foreground: 'text',
					muted: 'secondary',
					accent: 'signals',
					border: 'structure',
				},
				constraints: ['No blue-purple gradients'],
			},
			contrast: {
				hierarchy: ['primary', 'secondary', 'metadata'],
				rule: 'Hierarchy over intensity',
			},
		},
		typography: {
			display: { family: 'Syne', role: 'headlines', weight_range: '600-800' },
			body: { family: 'Manrope', role: 'body', weight_range: '400-600' },
			technical: { family: 'IBM Plex Mono', role: 'mono', weight_range: '400-500' },
			scale: {
				hero: { desktop: 'clamp(4rem, 8vw, 8rem)', mobile: 'clamp(3rem, 15vw, 5rem)' },
				h2: '2rem',
				h3: '1.4rem',
				body: '1rem',
				small: '0.875rem',
				technical: '0.75rem',
			},
			rules: ['Large type as composition'],
		},
		layout_system: {
			max_width: '1200px',
			grid: {
				desktop: '12 columns',
				tablet: '8 columns',
				mobile: '4 columns',
				gutter_desktop: '24px',
				gutter_mobile: '16px',
			},
			spacing_unit: '8px',
			section_spacing: { desktop: '96px', mobile: '72px' },
			alignment: { primary: 'left-aligned', secondary: 'asymmetry', rule: 'intentional' },
			composition_rules: ['Negative space', 'Clear anchors'],
		},
		navigation: {
			strategy: 'minimal',
			structure: ['brand', 'product', 'cta'],
			behavior: { desktop: 'horizontal', mobile: 'compact', sticky: true },
			visual_style: { height: '64px', background: 'transparent', border: 'minimal' },
			rules: ['Do not compete with hero'],
		},
		hero: {
			strategy: 'brand-first product explanation',
			priority_order: ['brand', 'value', 'visual', 'cta'],
			headline: { treatment: 'dominant', max_lines: 3, preferred_length: '2-8 words', rule: 'memorable' },
			supporting_copy: { max_width: '560px', max_lines: 3, density: 'low' },
			composition: {
				type: 'editorial',
				alignment: 'left',
				visual_anchor: 'routing diagram',
				negative_space: 'high',
				above_fold_requirement: 'story without scroll',
			},
			visual_concept: {
				type: 'custom SVG routing diagram',
				purpose: 'Explain routing rather than decorate',
				required: true,
			},
			cta: {
				primary: 'Start building',
				secondary: 'Explore',
				style: 'restrained',
				avoid: ['glowing buttons'],
			},
		},
		signature_element: {
			type: 'SVG diagram',
			purpose: 'Labeled inference path',
			requirements: ['Product-specific', 'Readable without animation'],
			visual_language: {
				nodes: 'geometric',
				connections: 'thin lines',
				labels: 'IBM Plex Mono',
				active_signal: 'accent',
				inactive_elements: 'muted',
			},
			animation: {
				initial_state: 'quiet',
				sequence: ['structure', 'connections', 'signal'],
				duration: '1.5s',
				easing: 'ease-out',
				repeat: false,
			},
		},
		information_architecture: {
			sections: [
				{ id: 'hero', purpose: 'Identity' },
				{ id: 'product', purpose: 'How it works' },
				{ id: 'cta', purpose: 'Convert' },
			],
			section_rule: 'Distinct purpose each section',
		},
		content_system: {
			voice: { tone: ['direct', 'precise'], avoid: ['revolutionary'] },
			copy_rules: ['Concrete language'],
		},
		component_system: {
			buttons: { style: 'compact', avoid: ['giant pills'] },
			cards: { default: 'avoid' },
			badges: { font: 'IBM Plex Mono' },
			inputs: { height: '44px' },
		},
		product_visualization: {
			priority: 'very_high',
			principle: 'Show product doing something',
			preferred_forms: ['workflow diagrams'],
			avoid: ['fake dashboards'],
		},
		responsive_design: {
			principle: 'Recompose',
			desktop: { width: '>=1024px', composition: 'editorial' },
			tablet: { width: '768-1023', rule: 'reduce complexity' },
			mobile: { width: '<768', rule: 'preserve idea' },
			mobile_rules: ['Preserve hero anchor'],
		},
		motion: {
			philosophy: 'System behavior not decoration',
			allowed: ['diagram draw-in'],
			timing: { micro: '150ms', standard: '300ms', hero: '1200ms' },
			rules: ['Reason required'],
		},
		interaction_design: {
			required_states: ['default', 'hover', 'focus'],
			interaction_principle: 'Useful feedback',
			hover: { intensity: 'subtle', avoid: ['glow'] },
		},
		accessibility: { requirements: ['WCAG contrast', 'keyboard'] },
		imagery: {
			strategy: 'SVG over decorative 3D',
			priority: ['custom SVG'],
			avoid: ['stock'],
		},
		iconography: { style: 'minimal', source: 'custom SVG', rules: ['No Lucide grids'] },
		technical_implementation: {
			preferred: ['CSS variables', 'inline SVG'],
			avoid: ['Three.js unless needed'],
			svg_rules: ['Responsive geometry'],
		},
		performance: {
			requirements: ['fast initial render'],
			priority: 'Quality without runtime bloat',
		},
		design_anti_patterns: {
			explicitly_prohibited: [
				'blue-purple gradients',
				'MeshDistortMaterial',
				'Lucide grids',
				'Inter',
			],
		},
		references: { provided: [], reference_usage: { rule: 'inspire not copy', priority: ['composition'] } },
		design_decisions: {
			locked: ['Syne + Manrope + IBM Plex Mono', 'custom diagram'],
			flexible: ['CTA wording'],
			unresolved: [],
		},
		quality_bar: {
			evaluation_questions: ['Understood in 5 seconds?'],
			failure_conditions: ['Could belong to any AI startup'],
			minimum_quality_threshold: { visual_identity: 8, product_clarity: 9 },
		},
		generation_directive: {
			instruction: 'Treat as contract',
			before_coding: ['Identify visual idea'],
			during_coding: ['Preserve composition'],
			after_coding: ['Compare to quality bar'],
			final_principle: 'Authored not assembled',
		},
		notes: ['llm-generated'],
		...overrides,
	};
}

describe('Design Intelligence (Agent)', () => {
	beforeAll(() => {
		// Prefer vendored agency skills when walking from extension dist fails in tests.
		const candidates = [
			path.resolve(__dirname, '../../../../../../../../packages/design/agency-skills'),
			path.resolve(__dirname, '../../../../../../../packages/design/agency-skills'),
			path.resolve(process.cwd(), 'packages/design/agency-skills'),
			path.resolve(process.cwd(), '../../packages/design/agency-skills'),
		];
		for (const c of candidates) {
			if (fs.existsSync(path.join(c, 'catalog.json'))) {
				process.env.SINGULARITY_AGENCY_SKILLS_DIR = c;
				break;
			}
		}
	});

	afterEach(() => {
		resetDesignIntelligenceSessions();
	});

	test('scanWorkspaceForGenericSlop flags blue→purple + MeshDistort + Lucide grids', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'di-slop-'));
		try {
			const src = path.join(root, 'src');
			fs.mkdirSync(src, { recursive: true });
			fs.writeFileSync(
				path.join(src, 'Hero.tsx'),
				`
import { Rocket, Sparkles, Zap } from 'lucide-react';
import { MeshDistortMaterial } from '@react-three/drei';
export function Hero() {
  return (
    <div className="bg-zinc-950 from-blue-500 to-purple-600 grid grid-cols-3 gap-4">
      <MeshDistortMaterial />
      <p>Everything you need to build</p>
      <span className="font-geist">Launch</span>
    </div>
  );
}
`,
				'utf8',
			);
			const findings = scanWorkspaceForGenericSlop(root);
			const issues = findings.map((f) => f.issue).join(' | ');
			expect(issues).toMatch(/Blue→purple|MeshDistort|Lucide|Geist|Generic AI/i);
			expect(findings.some((f) => f.severity === 'critical')).toBe(true);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('Director uses TokenRouter Flash-0731 with EXAMPLE v2 + user prompt', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'di-dir-'));
		const prevFetch = globalThis.fetch;
		const calls: string[] = [];
		try {
			globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
				const url = String(input);
				calls.push(url);
				const body = JSON.parse(String(init?.body ?? '{}')) as {
					messages?: Array<{ role?: string; content?: string }>;
					model?: string;
				};
				const user = body.messages?.find((m) => m.role === 'user')?.content ?? '';
				expect(user).toContain('EXAMPLE Design Specification v2');
				expect(user).toContain('ACTIVE AGENCY SKILL');
				expect(user).toContain('LaunchPad');
				expect(user).toContain('design_strategy');
				expect(body.model).toMatch(/deepseek-v4-flash/);

				return new Response(JSON.stringify({
					choices: [{
						message: {
							content: JSON.stringify(mockV2Spec()),
						},
					}],
				}), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				});
			}) as typeof fetch;

			const result = await runDesignDirectorForAgent({
				conversationId: 'conv-1',
				prompt: 'Build a LaunchPad landing page for AI model routing infrastructure',
				workspaceRoot: root,
			});
			expect(result.error ?? '').toBe('');
			expect(result.ok).toBe(true);
			expect(result.specPath).toBe(path.join(root, '.singularity', 'design-spec.json'));
			expect(result.skillPath).toBe(path.join(root, '.singularity', 'skill.json'));
			expect(result.skillId).toBeTruthy();
			expect(fs.existsSync(result.specPath!)).toBe(true);
			expect(fs.existsSync(result.skillPath!)).toBe(true);
			const skill = JSON.parse(fs.readFileSync(result.skillPath!, 'utf8'));
			expect(skill.version).toBe(1);
			expect(skill.source).toBe('agency-agents');
			expect(skill.id).toBe(result.skillId);
			expect(String(skill.content)).toContain('---');
			const spec = JSON.parse(fs.readFileSync(result.specPath!, 'utf8'));
			expect(spec.version).toBe(2);
			expect(spec.product.name).toBe('LaunchPad');
			expect(spec.design_strategy.concept).toBe('Signal-path control plane');
			expect(spec.typography.display.family).toBe('Syne');
			expect(spec.notes?.join(' ') ?? '').not.toMatch(/Heuristic/i);
			expect(calls.some((u) => /tokenrouter\.com|llm-proxy|supabase\.co|openrouter\.ai/.test(u))).toBe(true);
			const brief = mergeBriefWithDesignSpec('plan brief', 'conv-1');
			expect(brief).toContain('Design Specification');
			expect(brief).toContain('LaunchPad');
			expect(brief).toContain('AGENCY SKILL');
			expect(brief).toMatch(/react-bits|React Bits|godui|GodUI/i);
		} finally {
			globalThis.fetch = prevFetch;
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('Director ignores heuristic Spec on disk and regenerates', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'di-heur-'));
		const prevFetch = globalThis.fetch;
		try {
			const dir = path.join(root, '.singularity');
			fs.mkdirSync(dir, { recursive: true });
			const specPath = path.join(dir, 'design-spec.json');
			fs.writeFileSync(
				specPath,
				JSON.stringify({
					version: 1,
					product: { name: 'AI', category: 'software product', audience: 'developers', personality: 'deliberate' },
					art_direction: {
						concept: 'Product-first branded experience',
						visual_metaphor: 'clear product story visualized',
						design_language: 'restrained',
					},
					color: { background: '#0a0c0f', foreground: '#e8ecef', primary: '#0a0c0f', accent: '#e8a87c' },
					typography: { display: 'Syne', body: 'Manrope' },
					layout: { philosophy: 'brand-first', max_width: '1200px' },
					hero: { strategy: 'H1', headline_treatment: 'x', visual_concept: 'diagram' },
					signature_element: { type: 'svg', description: 'x', relationship_to_product: 'y' },
					motion: { philosophy: '2', allowed: [], prohibited: [] },
					imagery: { strategy: 'svg' },
					avoid: ['blue-purple'],
					notes: ['Heuristic Design Spec — refine if Director LLM recovers'],
				}, null, 2),
				'utf8',
			);

			globalThis.fetch = (async () => Response.json({
				choices: [{
					message: {
						content: JSON.stringify(mockV2Spec({
							product: {
								name: 'RegenCo',
								category: 'saas',
								audience: { primary: 'devs', secondary: [], technical_level: 'advanced' },
								product_character: ['bold'],
								brand_promise: 'Regen',
								brand_personality: {
									should_feel: ['bold'],
									should_not_feel: ['generic'],
								},
								primary_user_action: 'Start',
								conversion_goal: { primary: 'Start', secondary: 'Explore' },
							},
							design_strategy: {
								concept: 'Fresh LLM art direction',
								central_idea: {
									statement: 'Orbit mesh',
									visual_metaphor: 'orbiting nodes',
									principle: 'Product first',
								},
								design_language: {
									keywords: ['void', 'amber'],
									density: 'medium',
									visual_complexity: 'controlled',
									surface_treatment: 'minimal',
									ornamentation: 'low',
								},
								design_differentiator: {
									description: 'Fresh',
									requirement: 'Unique composition',
								},
							},
							notes: ['regenerated'],
						})),
					},
				}],
			})) as typeof fetch;

			const result = await runDesignDirectorForAgent({
				conversationId: 'conv-heur',
				prompt: 'Build RegenCo landing',
				workspaceRoot: root,
			});
			expect(result.ok).toBe(true);
			expect(result.reused).not.toBe(true);
			const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
			expect(spec.product.name).toBe('RegenCo');
			expect(spec.version).toBe(2);
			expect(spec.notes.join(' ')).not.toMatch(/Heuristic/i);
		} finally {
			globalThis.fetch = prevFetch;
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('Director reuses existing design-spec.json and does not overwrite', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'di-reuse-'));
		try {
			const dir = path.join(root, '.singularity');
			fs.mkdirSync(dir, { recursive: true });
			const specPath = path.join(dir, 'design-spec.json');
			const existing = mockV2Spec({
				product: {
					name: 'ExistingBrand',
					category: 'AI infrastructure',
					audience: { primary: 'developers', secondary: [], technical_level: 'advanced' },
					product_character: ['precise'],
					brand_promise: 'Keep routing clear',
					brand_personality: {
						should_feel: ['precise'],
						should_not_feel: ['generic'],
					},
					primary_user_action: 'Route',
					conversion_goal: { primary: 'Start', secondary: 'Explore' },
				},
				design_strategy: {
					concept: 'Keep me',
					central_idea: {
						statement: 'Keep me',
						visual_metaphor: 'router graph',
						principle: 'Clarity',
					},
					design_language: {
						keywords: ['ink', 'signal'],
						density: 'medium',
						visual_complexity: 'controlled',
						surface_treatment: 'minimal',
						ornamentation: 'low',
					},
					design_differentiator: {
						description: 'Keep',
						requirement: 'Unique',
					},
				},
				notes: ['do-not-replace'],
			});
			fs.writeFileSync(specPath, `${JSON.stringify(existing, null, 2)}\n`, 'utf8');
			const before = fs.readFileSync(specPath, 'utf8');

			const result = await runDesignDirectorForAgent({
				conversationId: 'conv-reuse',
				prompt: 'Completely redesign with a totally different brand and look',
				workspaceRoot: root,
			});

			expect(result.ok).toBe(true);
			expect(result.reused).toBe(true);
			expect(result.specPath).toBe(specPath);
			expect(fs.readFileSync(specPath, 'utf8')).toBe(before);
			const brief = mergeBriefWithDesignSpec('plan brief', 'conv-reuse');
			expect(brief).toContain('ExistingBrand');
			expect(brief).toContain('Keep me');
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('Visual Critic FAIL on slop forces refine; caps at MAX_VISUAL_ITERATIONS', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'di-crit-'));
		const prevFetch = globalThis.fetch;
		try {
			const dir = path.join(root, '.singularity');
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				path.join(dir, 'design-spec.json'),
				JSON.stringify(mockV2Spec({ notes: ['seed'] }), null, 2),
				'utf8',
			);
			await runDesignDirectorForAgent({
				conversationId: 'conv-2',
				prompt: 'LaunchPad AI infra landing',
				workspaceRoot: root,
			});
			const src = path.join(root, 'src');
			fs.mkdirSync(src, { recursive: true });
			fs.writeFileSync(
				path.join(src, 'page.tsx'),
				`export default function Page() {
  return <div className="bg-zinc-950 from-blue-600 to-purple-700"><MeshDistortMaterial/></div>
}`,
				'utf8',
			);

			globalThis.fetch = (async () => new Response('no', { status: 500 })) as typeof fetch;

			const first = await runVisualCriticForAgentStop({ conversationId: 'conv-2' });
			expect(first.shouldContinue).toBe(true);
			expect(first.reasons[0]).toMatch(/VISUAL CRITIC FAILED/i);
			expect(first.reasons[0]).toMatch(/genericness|Brand|Product|MeshDistort|Blue/i);

			for (let i = 1; i < MAX_VISUAL_ITERATIONS; i++) {
				const r = await runVisualCriticForAgentStop({ conversationId: 'conv-2' });
				expect(r.shouldContinue).toBe(true);
			}
			const done = await runVisualCriticForAgentStop({ conversationId: 'conv-2' });
			expect(done.shouldContinue).toBe(false);

			const verdictPath = path.join(root, '.singularity', 'visual-qa', 'iter-1', 'verdict.json');
			expect(fs.existsSync(verdictPath)).toBe(true);
			const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
			expect(verdict.pass).toBe(false);
			expect(verdict.scores.genericness).toBeGreaterThan(MAX_GENERICNESS);
			expect(verdict.scores.brandDistinctiveness).toBeLessThan(MIN_BRAND);
		} finally {
			globalThis.fetch = prevFetch;
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('Critic no-ops when frontend session inactive', async () => {
		setFrontendSessionActive('conv-x', false);
		const r = await runVisualCriticForAgentStop({ conversationId: 'conv-x' });
		expect(r.shouldContinue).toBe(false);
	});

	test('ensureDesignIntelligenceForTurn writes missing design-spec.json from session memory', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'di-ensure-disk-'));
		const prevFetch = globalThis.fetch;
		try {
			globalThis.fetch = (async () => ({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: JSON.stringify(mockV2Spec()) } }],
				}),
			})) as typeof fetch;

			const first = await runDesignDirectorForAgent({
				conversationId: 'conv-ensure-disk',
				prompt: 'Build a landing page for my SaaS',
				workspaceRoot: root,
			});
			expect(first.specPath).toBe(path.join(root, '.singularity', 'design-spec.json'));
			fs.unlinkSync(first.specPath!);

			const second = await ensureDesignIntelligenceForTurn({
				conversationId: 'conv-ensure-disk',
				prompt: 'Polish the hero section',
				workspaceRoot: root,
			});
			expect(second.reused).toBe(true);
			expect(second.specPath).toBe(path.join(root, '.singularity', 'design-spec.json'));
			expect(fs.existsSync(second.specPath!)).toBe(true);
		} finally {
			globalThis.fetch = prevFetch;
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	test('Director failure writes starter Spec with React Bits + GodUI locked', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'di-starter-'));
		const prevFetch = globalThis.fetch;
		try {
			globalThis.fetch = (async () => {
				throw new Error('timeout-20000ms');
			}) as typeof fetch;

			const result = await runDesignDirectorForAgent({
				conversationId: 'conv-starter',
				prompt: 'Build a simple Hello World React page',
				workspaceRoot: root,
			});
			expect(result.ok).toBe(true);
			expect(result.specPath).toBe(path.join(root, '.singularity', 'design-spec.json'));
			expect(fs.existsSync(result.specPath!)).toBe(true);
			const spec = JSON.parse(fs.readFileSync(result.specPath!, 'utf8'));
			expect(spec.version).toBe(2);
			expect(spec.technical_implementation.component_libraries).toEqual(['react-bits', 'godui', 'shadcn']);
			expect(spec.notes?.join(' ') ?? '').toMatch(/Heuristic Design Spec/i);
			const brief = mergeBriefWithDesignSpec('plan', 'conv-starter');
			expect(brief).toMatch(/react-bits/i);
			expect(brief).toMatch(/godui/i);
		} finally {
			globalThis.fetch = prevFetch;
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
