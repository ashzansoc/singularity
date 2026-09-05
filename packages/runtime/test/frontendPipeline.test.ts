import { describe, expect, it } from 'vitest';
import {
  createFallbackPlan,
  finalizePlan,
  parsePlanJson,
} from '../src/planner/planner.js';
import { FRONTEND_OWNER_MODEL_ID } from '@singularity/design';

describe('frontend design intelligence DAG', () => {
  it('injects Design Director and Visual Critic into planner output', () => {
    const plan = finalizePlan(
      {
        projectSummary: 'LaunchPad',
        nodes: [
          {
            id: 'landing',
            title: 'Build landing page UI',
            deps: [],
            ownedPaths: ['src/app/page.tsx', 'src/components'],
            expectedOutput: 'Marketing landing',
            specialty: 'frontend',
            recommendedTier: 'T2',
            estimatedTokens: 3000,
            priority: 1,
            retryLimit: 1,
          },
          {
            id: 'api',
            title: 'Backend waitlist API',
            deps: [],
            ownedPaths: ['src/app/api'],
            expectedOutput: 'API routes',
            specialty: 'backend',
            recommendedTier: 'T3',
            estimatedTokens: 2000,
            priority: 1,
            retryLimit: 1,
          },
        ],
      },
      { goal: 'Build LaunchPad AI infrastructure landing page' },
    );

    expect(plan.nodes.some((n) => n.id === 'design-director')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'design-confirm')).toBe(true);
    expect(plan.nodes.some((n) => n.specialty === 'visual-critic')).toBe(true);
    expect(plan.nodes.some((n) => n.specialty === 'visual-capture')).toBe(true);

    const landing = plan.nodes.find((n) => n.id === 'landing')!;
    expect(landing.deps).toContain('design-confirm');
    expect(landing.specialty).toBe('frontend');

    // Backend remains independent (no design-confirm dep required)
    const api = plan.nodes.find((n) => n.id === 'api')!;
    expect(api.specialty).toBe('backend');
    expect(api.deps.includes('design-confirm')).toBe(false);
  });

  it('fallback plan with frontend also gets the pipeline', () => {
    const plan = createFallbackPlan({
      goal: 'Build a React landing page with Tailwind hero and waitlist',
    });
    expect(plan.nodes.some((n) => n.specialty === 'frontend' || n.id === 'scaffold')).toBe(
      true,
    );
    expect(plan.nodes.some((n) => n.id === 'design-director')).toBe(true);
  });

  it('fallback for single-page raytracer does not invent Settings/UI DAG', () => {
    const plan = createFallbackPlan({
      goal:
        "Build a real-time black hole raytracer called 'GARGANTUA' as a single static page with UI Features, photon-ring highlights, and HUD",
    });
    expect(plan.nodes.some((n) => n.id === 'settings')).toBe(false);
    expect(plan.nodes.some((n) => n.id === 'integrate')).toBe(false);
    expect(plan.nodes.some((n) => n.id === 'main' || n.specialty === 'frontend')).toBe(true);
    expect(plan.nodes.some((n) => n.id === 'design-director')).toBe(true);
  });

  it('frontend implementer model remains Flash (not a generic coding agent id)', () => {
    expect(FRONTEND_OWNER_MODEL_ID).toBe('deepseek/deepseek-v4-flash-0731');
    const raw = parsePlanJson(
      JSON.stringify({
        projectSummary: 'x',
        nodes: [
          {
            id: 'ui',
            title: 'UI',
            ownedPaths: ['src/components/Button.tsx'],
            specialty: 'frontend',
          },
        ],
      }),
    );
    const plan = finalizePlan(raw, { goal: 'polish UI components' });
    const ui = plan.nodes.find((n) => n.id === 'ui');
    expect(ui?.preferredModelId ?? FRONTEND_OWNER_MODEL_ID).toBe(
      'deepseek/deepseek-v4-flash-0731',
    );
  });
});
