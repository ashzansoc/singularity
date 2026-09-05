import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyAgencyAgent,
  rulesFallbackAgencyAgent,
  parseAgencyAgentContent,
} from '../src/agencyAgentClassifier.js';
import {
  DEFAULT_AGENCY_SKILL_ID,
  formatAgencySkillForPrompt,
  getAgencySkill,
  listAgencySkills,
  loadAgencySkillCatalog,
  requireAgencySkill,
} from '../src/agencySkill.js';
import {
  agencySkillToArtifact,
  formatSkillArtifactForPrompt,
  loadSkillArtifact,
  saveSkillArtifact,
  SKILL_ARTIFACT_FILENAME,
} from '../src/skillArtifact.js';
import { buildDesignDirectorUserPrompt } from '../src/designDirector.js';
import { designDirectorMayWritePath } from '../src/designDirector.js';

describe('agency skills catalog', () => {
  it('loads 11 design-lane skills from catalog.json', () => {
    const catalog = loadAgencySkillCatalog();
    expect(catalog.skills).toHaveLength(11);
    expect(listAgencySkills().map((s) => s.id)).toContain('design-ui-designer');
    expect(listAgencySkills().map((s) => s.id)).toContain(
      'engineering-frontend-developer',
    );
  });

  it('parses frontmatter for every skill', () => {
    for (const entry of listAgencySkills()) {
      const skill = getAgencySkill(entry.id);
      expect(skill, entry.id).toBeDefined();
      expect(skill!.name.length).toBeGreaterThan(0);
      expect(skill!.content).toContain('---');
      expect(skill!.body.length).toBeGreaterThan(50);
    }
  });

  it('formats skill for prompt with ACTIVE AGENCY SKILL header', () => {
    const skill = requireAgencySkill('design-ui-designer');
    const block = formatAgencySkillForPrompt(skill, { maxChars: 2_000 });
    expect(block).toContain('ACTIVE AGENCY SKILL');
    expect(block).toContain('design-ui-designer');
    expect(block.length).toBeLessThanOrEqual(4_000);
  });
});

describe('agency agent classifier rules', () => {
  it('maps UI prompts to design-ui-designer', () => {
    const r = rulesFallbackAgencyAgent('Design a landing page hero with bold typography');
    expect(r.skillId).toBe('design-ui-designer');
  });

  it('maps whimsy prompts to design-whimsy-injector', () => {
    const r = rulesFallbackAgencyAgent('Add playful whimsy and delight micro-interactions');
    expect(r.skillId).toBe('design-whimsy-injector');
  });

  it('maps UX architecture prompts to design-ux-architect', () => {
    const r = rulesFallbackAgencyAgent('Map the information architecture and user flows');
    expect(r.skillId).toBe('design-ux-architect');
  });

  it('maps implement-heavy prompts to engineering-frontend-developer', () => {
    const r = rulesFallbackAgencyAgent('Implement the React TSX components and CSS modules');
    expect(r.skillId).toBe('engineering-frontend-developer');
  });

  it('defaults to design-ui-designer', () => {
    const r = rulesFallbackAgencyAgent('hello world');
    expect(r.skillId).toBe(DEFAULT_AGENCY_SKILL_ID);
  });

  it('parseAgencyAgentContent normalizes ids', () => {
    const valid = new Set(listAgencySkills().map((s) => s.id));
    const parsed = parseAgencyAgentContent(
      '{"skillId":"design-brand-guardian","confidence":0.91,"reason":"brand"}',
      valid,
    );
    expect(parsed.skillId).toBe('design-brand-guardian');
    expect(parsed.confidence).toBeCloseTo(0.91);
  });

  it('classifyAgencyAgent uses rules under vitest', async () => {
    const r = await classifyAgencyAgent('Polish the dashboard UI visual identity');
    expect(r.source).toBe('rules');
    expect(r.skillId).toBe('design-ui-designer');
  });
});

describe('skill artifact', () => {
  it('writes and loads .singularity/skill.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-art-'));
    try {
      const skill = requireAgencySkill('design-ux-architect');
      const artifact = agencySkillToArtifact(skill, {
        prompt: 'Design IA for a logistics app',
        classification: { confidence: 0.8, reason: 'test', source: 'rules' },
      });
      const path = saveSkillArtifact(root, artifact);
      expect(path.endsWith(SKILL_ARTIFACT_FILENAME)).toBe(true);
      expect(existsSync(path)).toBe(true);
      const loaded = loadSkillArtifact(root);
      expect(loaded?.id).toBe('design-ux-architect');
      expect(loaded?.content).toContain('UX Architect');
      const prompt = formatSkillArtifactForPrompt(loaded!);
      expect(prompt).toContain('AGENCY SKILL');
      expect(prompt).toContain('design-ux-architect');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('director prompt + skill mix', () => {
  it('places ACTIVE AGENCY SKILL before EXAMPLE Spec', () => {
    const skill = requireAgencySkill('design-whimsy-injector');
    const prompt = buildDesignDirectorUserPrompt('Playful kids coding school', {
      agencySkill: skill,
    });
    expect(prompt).toContain('ACTIVE AGENCY SKILL');
    expect(prompt).toContain('design-whimsy-injector');
    expect(prompt).toContain('EXAMPLE Design Specification v2');
    expect(prompt.indexOf('ACTIVE AGENCY SKILL')).toBeLessThan(
      prompt.indexOf('EXAMPLE Design Specification'),
    );
    expect(prompt).toContain('Playful kids coding school');
  });

  it('allows Design Director to write skill.json', () => {
    expect(designDirectorMayWritePath('.singularity/skill.json')).toBe(true);
    expect(designDirectorMayWritePath('.singularity/design-spec.json')).toBe(true);
  });
});
