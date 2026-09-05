import { describe, expect, it } from 'vitest';
import {
  parseDesignSpecJson,
  validateDesignSpec,
  formatDesignSpecForPrompt,
  createEmptyDesignSpec,
  DEFAULT_VISUAL_QA_THRESHOLDS,
  applyVisualGates,
  parseVisualCriticJson,
  finalizeCriticVerdict,
  designDirectorMayWritePath,
  designDirectorOwnsImplementation,
  visualCriticMayEditFiles,
  retrieveSplitKnowledge,
  buildIntentQuery,
  classifySourceKind,
  injectFrontendDesignPipeline,
  planNeedsFrontendPipeline,
  shouldContinueVisualRefinement,
  modelIdForSpecialty,
  FRONTEND_OWNER_MODEL_ID,
  DESIGN_DIRECTOR_MODEL_ID,
  VISUAL_CRITIC_MODEL_ID,
  buildFrontendContext,
  createDefaultDna,
  FRONTEND_TASTE_RULES,
} from '../src/index.js';

describe('Design Specification', () => {
  it('parses and validates a complete v1 spec via migration', () => {
    const spec = parseDesignSpecJson(
      JSON.stringify({
        product: {
          name: 'LaunchPad',
          category: 'AI infrastructure',
          audience: 'developers',
          personality: 'technical / premium',
        },
        art_direction: {
          concept: 'Edge routing control plane',
          visual_metaphor: 'client → router → inference',
          design_language: 'ink + signal, monospace chrome',
        },
        color: {
          background: '#0a0c0f',
          foreground: '#e8ecef',
          primary: '#0a0c0f',
          accent: '#3dff9a',
        },
        typography: {
          display: 'Syne',
          body: 'Manrope',
          technical: 'IBM Plex Mono',
        },
        layout: {
          philosophy: 'brand-first hero',
          max_width: '1200px',
        },
        hero: {
          strategy: 'LaunchPad as H1',
          headline_treatment: 'Brand name dominant',
          visual_concept: 'SVG routing diagram',
        },
        signature_element: {
          type: 'SVG infrastructure diagram',
          description: 'Client to router to model nodes',
          relationship_to_product: 'Shows how LaunchPad routes inference',
        },
        components: { navigation: 'minimal mono links' },
        motion: {
          philosophy: 'restrained',
          allowed: ['diagram draw-in'],
          prohibited: ['fade every section'],
        },
        imagery: { strategy: 'SVG over decorative 3D' },
        avoid: ['blue-purple gradients'],
        references: [],
      }),
    );
    expect(spec.version).toBe(2);
    expect(spec.product.name).toBe('LaunchPad');
    expect(spec.typography.display.family).toBe('Syne');
    expect(spec.design_strategy.concept).toBe('Edge routing control plane');
    expect(formatDesignSpecForPrompt(spec)).toContain('Signature element');
  });

  it('rejects incomplete specs', () => {
    expect(() =>
      validateDesignSpec({
        product: { name: 'X', category: '', audience: '', personality: '' },
        art_direction: { concept: '', visual_metaphor: '', design_language: '' },
      } as never),
    ).toThrow(/incomplete/i);
  });
});

describe('ownership boundaries', () => {
  it('Design Director cannot own implementation', () => {
    expect(designDirectorOwnsImplementation()).toBe(false);
    expect(designDirectorMayWritePath('.singularity/design-spec.json')).toBe(true);
    expect(designDirectorMayWritePath('.singularity/skill.json')).toBe(true);
    expect(designDirectorMayWritePath('src/components/Hero.tsx')).toBe(false);
  });

  it('Visual Critic cannot edit files', () => {
    expect(visualCriticMayEditFiles()).toBe(false);
  });
});

describe('knowledge retrieval', () => {
  it('builds intent query from structured fields (not beautiful React UI)', () => {
    const q = buildIntentQuery({
      productCategory: 'AI infrastructure',
      personality: 'technical',
      artDirection: 'premium dark',
      visualMetaphor: 'network routing',
    });
    expect(q).toContain('AI infrastructure');
    expect(q).toContain('network routing');
    expect(q.toLowerCase()).not.toContain('beautiful react');
  });

  it('splits design vs implementation knowledge', () => {
    const split = retrieveSplitKnowledge({
      productCategory: 'AI infrastructure',
      personality: 'technical premium',
      visualMetaphor: 'network visualization',
      layoutType: 'marketing landing',
    });
    expect(split.queryText.length).toBeGreaterThan(10);
    expect(split.designBlock).toContain('DESIGN KNOWLEDGE');
    expect(split.implementationBlock).toContain('IMPLEMENTATION KNOWLEDGE');
    expect(classifySourceKind('shadcn')).toBe('implementation');
    expect(classifySourceKind('react-bits')).toBe('implementation');
    expect(classifySourceKind('godui')).toBe('implementation');
    expect(classifySourceKind('aceternity')).toBe('design');
  });
});

describe('visual critic gates', () => {
  it('fails when genericness is too high', () => {
    const gate = applyVisualGates({
      genericness: 80,
      brandDistinctiveness: 70,
      productCommunication: 70,
      visualHierarchy: 70,
      typography: 70,
      responsiveQuality: 70,
      overallDesignQuality: 60,
    });
    expect(gate.pass).toBe(false);
  });

  it('parses critic JSON and applies gates', () => {
    const verdict = finalizeCriticVerdict(
      parseVisualCriticJson(
        JSON.stringify({
          version: 1,
          pass: true,
          scores: {
            genericness: 20,
            brandDistinctiveness: 80,
            productCommunication: 75,
            visualHierarchy: 70,
            typography: 72,
            responsiveQuality: 68,
            overallDesignQuality: 74,
          },
          findings: [
            {
              severity: 'high',
              issue: 'Hero visual is decorative',
              evidence: 'blob',
              recommendation: 'Replace with SVG diagram',
              target: 'Hero.tsx',
            },
          ],
          summary: 'ok',
        }),
      ),
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.findings[0]?.target).toBe('Hero.tsx');
  });

  it('terminates refinement loop', () => {
    expect(shouldContinueVisualRefinement(1, false)).toBe(true);
    expect(shouldContinueVisualRefinement(3, false)).toBe(false);
    expect(shouldContinueVisualRefinement(1, true)).toBe(false);
    expect(DEFAULT_VISUAL_QA_THRESHOLDS.maxVisualIterations).toBe(3);
  });
});

describe('frontend DAG pipeline injection', () => {
  it('injects director → capture → critic → refine', () => {
    const plan = injectFrontendDesignPipeline({
      id: 'p1',
      goal: 'Build LaunchPad landing page',
      projectSummary: 'AI infra',
      nodes: [
        {
          id: 'hero',
          title: 'Build hero UI',
          deps: [],
          ownedPaths: ['src/components/Hero.tsx'],
          expectedOutput: 'Hero section',
          estimatedTokens: 2000,
          recommendedTier: 'T2',
          specialty: 'frontend',
          priority: 1,
          retryLimit: 1,
          status: 'pending',
        },
      ],
      estimates: { totalTokens: 2000, taskCount: 1, criticalPathLength: 1 },
      createdAt: Date.now(),
    });

    expect(planNeedsFrontendPipeline(plan)).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'design-director')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'design-confirm')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'visual-critic')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'visual-capture')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'frontend-refine-1')).toBe(true);

    const director = plan.nodes.find((n) => n.id === 'design-director')!;
    expect(director.ownedPaths).toContain('.singularity/design-spec.json');
    expect(director.ownedPaths).toContain('.singularity/skill.json');

    const hero = plan.nodes.find((n) => n.id === 'hero')!;
    expect(hero.deps).toContain('design-confirm');
    expect(plan.nodes.find((n) => n.id === 'design-confirm')!.deps).toContain('design-director');
    expect(modelIdForSpecialty('design-director')).toBe(DESIGN_DIRECTOR_MODEL_ID);
    expect(modelIdForSpecialty('frontend')).toBe(FRONTEND_OWNER_MODEL_ID);
    expect(modelIdForSpecialty('visual-critic')).toBe(VISUAL_CRITIC_MODEL_ID);
    expect(FRONTEND_OWNER_MODEL_ID).toBe('deepseek/deepseek-v4-flash-0731');
  });

  it('does not double-inject', () => {
    const once = injectFrontendDesignPipeline({
      id: 'p',
      goal: 'landing',
      projectSummary: '',
      nodes: [
        {
          id: 'ui',
          title: 'UI',
          deps: [],
          ownedPaths: ['src'],
          expectedOutput: 'ui',
          estimatedTokens: 1,
          recommendedTier: 'T0',
          specialty: 'frontend',
          priority: 1,
          retryLimit: 0,
          status: 'pending',
        },
      ],
      estimates: { totalTokens: 1, taskCount: 1, criticalPathLength: 1 },
      createdAt: 0,
    });
    const twice = injectFrontendDesignPipeline(once);
    expect(twice.nodes.filter((n) => n.id === 'design-director')).toHaveLength(1);
  });

  it('does not cycle when planner hallucinates pipeline nodes and deps', () => {
    const plan = injectFrontendDesignPipeline({
      id: 'p-cycle',
      goal: 'Build health-check frontend',
      projectSummary: 'health app',
      nodes: [
        {
          id: 'frontend-worker',
          title: 'Implement frontend health page',
          deps: ['frontend-refine-1'],
          ownedPaths: ['frontend/'],
          expectedOutput: 'Static health page',
          estimatedTokens: 2000,
          recommendedTier: 'T2',
          specialty: 'frontend',
          priority: 80,
          retryLimit: 2,
          status: 'pending',
        },
        {
          id: 'visual-capture',
          title: 'Hallucinated capture',
          deps: [],
          ownedPaths: ['.singularity/visual-qa/iter-1'],
          expectedOutput: 'screenshots',
          estimatedTokens: 500,
          recommendedTier: 'T0',
          specialty: 'visual-capture',
          priority: 40,
          retryLimit: 1,
          status: 'pending',
        },
        {
          id: 'visual-critic',
          title: 'Hallucinated critic',
          deps: ['visual-capture'],
          ownedPaths: ['.singularity/visual-qa/iter-1/verdict.json'],
          expectedOutput: 'verdict',
          estimatedTokens: 3000,
          recommendedTier: 'T2',
          specialty: 'visual-critic',
          priority: 35,
          retryLimit: 1,
          status: 'pending',
        },
        {
          id: 'frontend-refine-1',
          title: 'Hallucinated refine',
          deps: ['visual-critic'],
          ownedPaths: ['frontend/'],
          expectedOutput: 'refine',
          estimatedTokens: 6000,
          recommendedTier: 'T0',
          specialty: 'frontend-refine',
          priority: 30,
          retryLimit: 1,
          status: 'pending',
        },
      ],
      estimates: { totalTokens: 2000, taskCount: 4, criticalPathLength: 4 },
      createdAt: Date.now(),
    });

    const worker = plan.nodes.find((n) => n.id === 'frontend-worker')!;
    expect(worker.deps).toContain('design-confirm');
    expect(worker.deps).not.toContain('visual-capture');
    expect(worker.deps).not.toContain('frontend-refine-1');
    expect(worker.deps).not.toContain('visual-critic');

    const capture = plan.nodes.find((n) => n.id === 'visual-capture')!;
    expect(capture.deps).toContain('frontend-worker');
    expect(plan.nodes.filter((n) => n.id === 'visual-critic')).toHaveLength(1);
  });
});

describe('frontend context construction', () => {
  it('puts Design Spec and taste rules in the system prompt', () => {
    const spec = createEmptyDesignSpec({
      product: {
        name: 'LaunchPad',
        category: 'AI infrastructure',
        audience: 'devs',
        personality: 'technical',
      },
      art_direction: {
        concept: 'edge control',
        visual_metaphor: 'routing graph',
        design_language: 'ink + signal',
      },
      color: {
        background: '#0a0c0f',
        foreground: '#eee',
        primary: '#0a0c0f',
        accent: '#3dff9a',
      },
      typography: { display: 'Syne', body: 'Manrope' },
      hero: {
        strategy: 'brand H1',
        headline_treatment: 'LaunchPad',
        visual_concept: 'SVG diagram',
      },
      signature_element: {
        type: 'SVG',
        description: 'client→router→inference',
        relationship_to_product: 'shows routing',
      },
    });
    const bundle = buildFrontendContext({
      task: 'Implement LaunchPad landing',
      dna: createDefaultDna('ws'),
      designSpec: spec,
    });
    expect(bundle.modelId).toBe('deepseek/deepseek-v4-flash-0731');
    expect(bundle.systemPrompt).toContain('DESIGN SPECIFICATION');
    expect(bundle.systemPrompt).toContain('LaunchPad');
    expect(bundle.systemPrompt).toContain(FRONTEND_TASTE_RULES.slice(0, 40));
    expect(bundle.systemPrompt).toContain('IMPLEMENTATION KNOWLEDGE');
  });
});
