/**
 * Agency skills catalog — design-lane agents from msitarzewski/agency-agents.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { designPackageRoot } from './knowledge.js';

export const AGENCY_SKILLS_DIRNAME = 'agency-skills';
export const DEFAULT_AGENCY_SKILL_ID = 'design-ui-designer';

export interface AgencySkillMeta {
  name?: string;
  description?: string;
  color?: string;
  emoji?: string;
  vibe?: string;
  [key: string]: string | undefined;
}

export interface AgencySkillCatalogEntry {
  id: string;
  division: string;
  name: string;
  description: string;
  path: string;
  sourceRepo?: string;
  sourceRef?: string;
}

export interface AgencySkillCatalog {
  version: number;
  source: string;
  repo: string;
  ref: string;
  fetchedAt?: string;
  skills: AgencySkillCatalogEntry[];
}

export interface AgencySkill {
  id: string;
  division: string;
  name: string;
  description: string;
  repoPath: string;
  meta: AgencySkillMeta;
  /** Full markdown including frontmatter. */
  content: string;
  /** Body after frontmatter. */
  body: string;
}

export function agencySkillsDir(): string {
  return join(designPackageRoot(), AGENCY_SKILLS_DIRNAME);
}

export function loadAgencySkillCatalog(): AgencySkillCatalog {
  const path = join(agencySkillsDir(), 'catalog.json');
  if (!existsSync(path)) {
    throw new Error(`agency-skills catalog missing: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as AgencySkillCatalog;
  if (!Array.isArray(raw.skills) || raw.skills.length === 0) {
    throw new Error('agency-skills catalog has no skills');
  }
  return raw;
}

export function listAgencySkills(): AgencySkillCatalogEntry[] {
  return loadAgencySkillCatalog().skills;
}

export function getAgencySkill(id: string): AgencySkill | undefined {
  const catalog = loadAgencySkillCatalog();
  const entry = catalog.skills.find((s) => s.id === id);
  if (!entry) return undefined;
  const filePath = join(agencySkillsDir(), entry.path);
  if (!existsSync(filePath)) {
    return undefined;
  }
  const content = readFileSync(filePath, 'utf8');
  return parseAgencySkillMarkdown(content, entry);
}

export function requireAgencySkill(id: string): AgencySkill {
  const skill = getAgencySkill(id) ?? getAgencySkill(DEFAULT_AGENCY_SKILL_ID);
  if (!skill) {
    throw new Error(`agency skill not found: ${id}`);
  }
  return skill;
}

export function parseAgencySkillMarkdown(
  content: string,
  entry?: Partial<AgencySkillCatalogEntry>,
): AgencySkill {
  const { meta, body } = splitFrontmatter(content);
  const repoPath = entry?.path ?? '';
  const fileStem =
    entry?.id ??
    (repoPath.split('/').pop() ?? 'unknown').replace(/\.md$/, '');
  const division =
    entry?.division ?? (repoPath.includes('/') ? repoPath.split('/')[0]! : 'design');
  return {
    id: fileStem,
    division,
    name: entry?.name || meta.name || fileStem,
    description: entry?.description || meta.description || '',
    repoPath: repoPath || `${division}/${fileStem}.md`,
    meta,
    content,
    body,
  };
}

export function splitFrontmatter(raw: string): {
  meta: AgencySkillMeta;
  body: string;
} {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    return { meta: {}, body: raw };
  }
  const meta: AgencySkillMeta = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { meta, body: m[2]!.trimStart() };
}

/**
 * Format skill for LLM prompts. Prefer mission/rules sections; truncate to budget.
 */
export function formatAgencySkillForPrompt(
  skill: AgencySkill,
  options: { maxChars?: number } = {},
): string {
  const maxChars = options.maxChars ?? 6_000;
  const header = [
    `ACTIVE AGENCY SKILL: ${skill.name} (${skill.id})`,
    skill.description ? `Description: ${skill.description}` : '',
    skill.meta.vibe ? `Vibe: ${skill.meta.vibe}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  let body = skill.body;
  // Prefer identity / mission / critical rules when present
  const preferred = extractPreferredSections(body);
  if (preferred) {
    body = preferred;
  }
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars)}\n…[truncated]`;
  }

  return [
    header,
    '',
    'Embody this agent\'s expertise and constraints when producing the Design Specification.',
    'Do NOT copy example CSS/code blocks literally — extract principles and apply them to THIS product.',
    '',
    body,
  ].join('\n');
}

function extractPreferredSections(body: string): string | undefined {
  const sections: string[] = [];
  const patterns = [
    /##[^\n]*Identity[^\n]*\n[\s\S]*?(?=\n##|$)/i,
    /##[^\n]*Core Mission[^\n]*\n[\s\S]*?(?=\n##|$)/i,
    /##[^\n]*Critical Rules[^\n]*\n[\s\S]*?(?=\n##|$)/i,
    /##[^\n]*Deliverables[^\n]*\n[\s\S]*?(?=\n##|$)/i,
  ];
  for (const re of patterns) {
    const m = body.match(re);
    if (m) sections.push(m[0]!.trim());
  }
  if (!sections.length) return undefined;
  return sections.join('\n\n');
}

/** Short catalog summaries for the agent classifier prompt. */
export function formatAgencyCatalogForClassifier(
  entries: AgencySkillCatalogEntry[] = listAgencySkills(),
): string {
  return entries
    .map(
      (s) =>
        `- ${s.id} [${s.division}] ${s.name}: ${s.description.slice(0, 160)}`,
    )
    .join('\n');
}
