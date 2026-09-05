/**
 * Persist / load `.singularity/skill.json` — selected agency agent for a workspace.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgencySkill } from './agencySkill.js';

export const SKILL_ARTIFACT_FILENAME = 'skill.json';
export const SKILL_ARTIFACT_VERSION = 1 as const;

export interface SkillArtifact {
  version: typeof SKILL_ARTIFACT_VERSION;
  source: 'agency-agents';
  id: string;
  name: string;
  description: string;
  division: string;
  repoPath: string;
  selectedAt: string;
  promptExcerpt: string;
  content: string;
  classification?: {
    confidence: number;
    reason: string;
    source: string;
  };
}

export function skillArtifactPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.singularity', SKILL_ARTIFACT_FILENAME);
}

export function agencySkillToArtifact(
  skill: AgencySkill,
  options: {
    prompt?: string;
    classification?: SkillArtifact['classification'];
    selectedAt?: string;
  } = {},
): SkillArtifact {
  return {
    version: SKILL_ARTIFACT_VERSION,
    source: 'agency-agents',
    id: skill.id,
    name: skill.name,
    description: skill.description,
    division: skill.division,
    repoPath: skill.repoPath,
    selectedAt: options.selectedAt ?? new Date().toISOString(),
    promptExcerpt: (options.prompt ?? '').slice(0, 500),
    content: skill.content,
    classification: options.classification,
  };
}

export function saveSkillArtifact(
  workspaceRoot: string,
  artifact: SkillArtifact,
): string {
  const path = skillArtifactPath(workspaceRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return path;
}

export function loadSkillArtifact(
  workspaceRoot: string,
  readFile?: (path: string) => Promise<string | undefined> | string | undefined,
): SkillArtifact | undefined {
  const path = skillArtifactPath(workspaceRoot);
  try {
    let raw: string | undefined;
    if (readFile) {
      const result = readFile(path);
      if (result && typeof (result as Promise<string>).then === 'function') {
        throw new Error('loadSkillArtifact sync readFile required; use loadSkillArtifactAsync');
      }
      raw = result as string | undefined;
    } else if (existsSync(path)) {
      raw = readFileSync(path, 'utf8');
    }
    if (!raw) return undefined;
    return parseSkillArtifact(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return undefined;
  }
}

export async function loadSkillArtifactAsync(
  workspaceRoot: string,
  readFile: (path: string) => Promise<string | undefined>,
): Promise<SkillArtifact | undefined> {
  const path = skillArtifactPath(workspaceRoot);
  try {
    const raw = await readFile(path);
    if (!raw) return undefined;
    return parseSkillArtifact(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return undefined;
  }
}

export function parseSkillArtifact(raw: Record<string, unknown>): SkillArtifact {
  const id = String(raw.id ?? '');
  const content = String(raw.content ?? '');
  if (!id || !content) {
    throw new Error('invalid-skill-artifact');
  }
  return {
    version: SKILL_ARTIFACT_VERSION,
    source: 'agency-agents',
    id,
    name: String(raw.name ?? id),
    description: String(raw.description ?? ''),
    division: String(raw.division ?? 'design'),
    repoPath: String(raw.repoPath ?? ''),
    selectedAt: String(raw.selectedAt ?? new Date().toISOString()),
    promptExcerpt: String(raw.promptExcerpt ?? ''),
    content,
    classification:
      raw.classification && typeof raw.classification === 'object'
        ? {
            confidence: Number(
              (raw.classification as Record<string, unknown>).confidence ?? 0,
            ),
            reason: String(
              (raw.classification as Record<string, unknown>).reason ?? '',
            ),
            source: String(
              (raw.classification as Record<string, unknown>).source ?? '',
            ),
          }
        : undefined,
  };
}

/** Compact block for implementer prompts. */
export function formatSkillArtifactForPrompt(
  artifact: SkillArtifact,
  options: { maxChars?: number } = {},
): string {
  const maxChars = options.maxChars ?? 3_000;
  let body = artifact.content;
  const fm = body.match(/^---[\s\S]*?---\r?\n?([\s\S]*)$/);
  if (fm) body = fm[1]!.trimStart();
  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars)}\n…[truncated]`;
  }
  return [
    `AGENCY SKILL (${artifact.id} — ${artifact.name})`,
    '──────────────',
    artifact.description,
    '',
    'Apply this specialist lens while implementing the Design Spec (do not invent a new art direction).',
    '',
    body,
  ].join('\n');
}
