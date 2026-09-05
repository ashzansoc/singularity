import { describe, expect, it } from 'vitest';
import {
  createEmptyDesignSpec,
  defaultFontTrio,
  resolveFontPersonality,
  formatFontPersonalityCatalog,
  designSpecTypographyFromSystem,
} from '../src/index.js';

describe('typography system', () => {
  it('defaults to experimental full system (not faces only)', () => {
    const trio = defaultFontTrio();
    expect(trio.id).toBe('experimental');
    expect(trio.display).toBe('Syne');
    expect(trio.display_metrics.letter_spacing).toBe('-0.035em');
    expect(trio.display_metrics.line_height).toBe('0.98');
    expect(trio.mono.presence).toBe('balanced');
    expect(trio.weight_distribution.length).toBeGreaterThan(20);
  });

  it('developer system has prominent near-body mono', () => {
    const trio = resolveFontPersonality({
      prompt: 'Build a modern developer platform SDK and CLI',
    });
    expect(trio.id).toBe('developer');
    expect(trio.mono.presence).toBe('prominent');
    expect(trio.scale.hero.desktop).toContain('4.25rem');
    expect(trio.technical_metrics.letter_spacing).toBe('0');
  });

  it('editorial system uses light serif + narrow measure', () => {
    const trio = resolveFontPersonality({
      prompt: 'An editorial research journal for AI',
      designKeywords: ['intellectual', 'serif'],
    });
    expect(trio.id).toBe('editorial');
    expect(trio.display_metrics.default_weight).toBe('400');
    expect(trio.measure).toContain('42');
    expect(trio.mono.presence).toBe('sparse');
  });

  it('cybernetic treats mono as product UI', () => {
    const trio = resolveFontPersonality({
      prompt: 'Autonomous AI agents for infrastructure ops',
      shouldFeel: ['technical', 'futuristic'],
    });
    expect(trio.id).toBe('cybernetic');
    expect(trio.mono.presence).toBe('prominent');
    expect(trio.mono.used_for.some((u) => /agent|terminal/i.test(u))).toBe(true);
  });

  it('designSpecTypographyFromSystem embeds metrics', () => {
    const block = designSpecTypographyFromSystem(
      resolveFontPersonality({ shouldFeel: ['premium', 'sophisticated'] }),
    );
    expect(block.personality).toBe('premium');
    expect(block.display.family).toBe('Space Grotesk');
    expect(block.display.letter_spacing).toBe('-0.025em');
    expect(block.body.line_height).toBe('1.6');
    expect(block.mono_usage.presence).toBe('sparse');
    expect(block.weight_distribution).toMatch(/Restrained/i);
  });

  it('createEmptyDesignSpec applies full resolved system', () => {
    const spec = createEmptyDesignSpec({
      product: {
        name: 'Forge',
        category: 'developer tools',
        brand_personality: {
          should_feel: ['developer', 'precise'],
          should_not_feel: ['generic'],
        },
      },
    });
    expect(spec.typography.personality).toBe('developer');
    expect(spec.typography.display.family).toBe('Geist');
    expect(spec.typography.display.letter_spacing).toBe('-0.02em');
    expect(spec.typography.mono_usage?.presence).toBe('prominent');
    expect(spec.typography.scale.technical).toBe('0.8125rem');
    expect(spec.design_strategy.design_language.keywords).toContain('font:developer');
  });

  it('catalog requires full system lock-in', () => {
    const block = formatFontPersonalityCatalog();
    expect(block).toContain('FULL type system');
    expect(block).toContain('letter-spacing');
    expect(block).toContain('mono');
    expect(block).toContain('never the same layout with only the font swapped');
  });
});
