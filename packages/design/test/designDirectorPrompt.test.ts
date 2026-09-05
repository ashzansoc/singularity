import { describe, expect, it } from 'vitest';
import {
  buildDesignDirectorUserPrompt,
  EXAMPLE_DESIGN_SPEC,
  DESIGN_DIRECTOR_MODEL_ID,
} from '../src/designDirector.js';
import { requireAgencySkill } from '../src/agencySkill.js';

describe('DeepSeek Flash-0731 Design Director prompt (Spec v2)', () => {
  it('uses DeepSeek V4 Flash-0731 model id', () => {
    expect(DESIGN_DIRECTOR_MODEL_ID).toBe('deepseek/deepseek-v4-flash-0731');
  });

  it('embeds EXAMPLE Spec v2 then the user request', () => {
    const user = 'Build a playful kids coding school landing page called PixelNest';
    const prompt = buildDesignDirectorUserPrompt(user);
    expect(prompt).toContain('EXAMPLE Design Specification v2');
    expect(prompt).toContain('USER REQUEST');
    expect(prompt).toContain(user);
    expect(prompt).toContain(EXAMPLE_DESIGN_SPEC.product.name);
    expect(prompt).toMatch(/"version"\s*:\s*2/);
    expect(prompt).toContain('design_strategy');
    expect(prompt).toContain('visual_identity');
    expect(prompt).toContain('Do NOT copy Northline');
    expect(prompt.indexOf('EXAMPLE')).toBeLessThan(prompt.indexOf('USER REQUEST'));
  });

  it('injects agency skill before the EXAMPLE Spec when provided', () => {
    const skill = requireAgencySkill('design-ui-designer');
    const prompt = buildDesignDirectorUserPrompt('Fintech dashboard', { agencySkill: skill });
    expect(prompt).toContain('ACTIVE AGENCY SKILL');
    expect(prompt.indexOf('ACTIVE AGENCY SKILL')).toBeLessThan(
      prompt.indexOf('EXAMPLE Design Specification'),
    );
  });

  it('changes user section when the request changes', () => {
    const a = buildDesignDirectorUserPrompt('Luxury watch brand site for Aurelia');
    const b = buildDesignDirectorUserPrompt('Brutalist architecture portfolio for Studio Kade');
    expect(a).toContain('Aurelia');
    expect(b).toContain('Studio Kade');
    expect(a).not.toContain('Studio Kade');
    expect(b).not.toContain('Aurelia');
  });
});
