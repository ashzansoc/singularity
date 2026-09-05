import { describe, expect, it } from 'vitest';
import {
  planDesignSourcesRules,
  mergeDesignSourceVotes,
  applyUserAnswers,
  PLANNER_TOOLS,
} from '../src/sourcePlanner.js';

describe('design source planner', () => {
  it('exposes React Bits + GodUI among planner tools', () => {
    expect(PLANNER_TOOLS.length).toBe(12);
    expect(PLANNER_TOOLS.map((t) => t.id)).toContain('react-bits');
    expect(PLANNER_TOOLS.map((t) => t.id)).toContain('godui');
    expect(PLANNER_TOOLS.map((t) => t.id)).toContain('website-cloner');
  });

  it('defaults frontend work to React Bits + GodUI use', () => {
    const plan = planDesignSourcesRules('Build a marketing landing page in React');
    expect(plan.decisions.find((d) => d.id === 'react-bits')?.action).toBe('use');
    expect(plan.decisions.find((d) => d.id === 'godui')?.action).toBe('use');
    expect(plan.activeIds).toContain('react-bits');
    expect(plan.activeIds).toContain('godui');
    expect(plan.decisions.find((d) => d.id === 'website-cloner')?.action).toBe('skip');
  });

  it('enables website-cloner on something like + URL', () => {
    const plan = planDesignSourcesRules(
      'Make something like https://linear.app for a project tracker called Orbit Desk',
    );
    expect(plan.decisions.find((d) => d.id === 'website-cloner')?.action).toBe('use');
    expect(plan.activeIds).toContain('website-cloner');
    expect(plan.activeIds).toContain('react-bits');
    expect(plan.activeIds).toContain('godui');
  });

  it('enables website-cloner on inspired by + URL', () => {
    const plan = planDesignSourcesRules(
      'Build a landing page inspired by https://stripe.com/payments',
    );
    expect(plan.decisions.find((d) => d.id === 'website-cloner')?.action).toBe('use');
  });

  it('enables website-cloner on take reference from + URL', () => {
    const plan = planDesignSourcesRules(
      'Build Orbit Desk — take reference from https://linear.app for layout and motion',
    );
    expect(plan.decisions.find((d) => d.id === 'website-cloner')?.action).toBe('use');
  });

  it('defaults SaaS UI to HeroUI/NextUI use and skips decorative Three.js', () => {
    const plan = planDesignSourcesRules(
      'Build a SaaS dashboard application UI with settings sidebar and charts',
    );
    const heroui = plan.decisions.find((d) => d.id === 'heroui-nextui');
    const three = plan.decisions.find((d) => d.id === 'threejs');
    expect(heroui?.action).toBe('use');
    expect(three?.action).toBe('skip');
    expect(plan.decisions.find((d) => d.id === 'react-bits')?.action).toBe('use');
    expect(plan.decisions.find((d) => d.id === 'godui')?.action).toBe('use');
    expect(plan.questions.length).toBeLessThanOrEqual(9);
  });

  it('skips Aceternity/Magic UI unless explicitly named', () => {
    const plan = planDesignSourcesRules('Build a polished product website with animations');
    expect(plan.decisions.find((d) => d.id === 'aceternity')?.action).toBe('skip');
    expect(plan.decisions.find((d) => d.id === 'magic-ui')?.action).toBe('skip');
  });

  it('enables Three.js when 3D is explicit', () => {
    const plan = planDesignSourcesRules('Add a Three.js WebGL hero with react-three-fiber');
    expect(plan.decisions.find((d) => d.id === 'threejs')?.action).toBe('use');
    expect(plan.activeIds).toContain('threejs');
  });

  it('merges Nemotron votes', () => {
    const baseline = planDesignSourcesRules('marketing landing page');
    const merged = mergeDesignSourceVotes(baseline, [
      { id: 'threejs', action: 'skip', reason: 'no 3d needed' },
      { id: 'aceternity', action: 'use', reason: 'premium landing' },
    ]);
    expect(merged.decisions.find((d) => d.id === 'aceternity')?.action).toBe('use');
    expect(merged.decisions.find((d) => d.id === 'threejs')?.action).toBe('skip');
  });

  it('applies user yes/no answers', () => {
    const baseline = planDesignSourcesRules('landing page waitlist');
    const withAsk = mergeDesignSourceVotes(baseline, [
      { id: 'aceternity', action: 'ask' },
    ]);
    const answered = applyUserAnswers(withAsk, {
      aceternity: { selected: ['Yes'], freeText: null, skipped: false },
    });
    expect(answered.decisions.find((d) => d.id === 'aceternity')?.action).toBe('use');
  });
});
