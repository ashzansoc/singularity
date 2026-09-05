#!/usr/bin/env node
/**
 * Fetch design-lane agency agents from msitarzewski/agency-agents
 * into packages/design/agency-skills/ and write catalog.json.
 *
 * Usage: node scripts/fetch-agency-skills.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const OUT_DIR = join(PACKAGE_ROOT, 'agency-skills');
const REPO = 'msitarzewski/agency-agents';
const REF = 'main';

/** Design-lane agents only (v1). */
export const AGENCY_SKILL_PATHS = [
  'design/design-brand-guardian.md',
  'design/design-image-prompt-engineer.md',
  'design/design-inclusive-visuals-specialist.md',
  'design/design-persona-walkthrough.md',
  'design/design-ui-designer.md',
  'design/design-ui-finish-gate-reviewer.md',
  'design/design-ux-architect.md',
  'design/design-ux-researcher.md',
  'design/design-visual-storyteller.md',
  'design/design-whimsy-injector.md',
  'engineering/engineering-frontend-developer.md',
];

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { name: '', description: '' };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
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
  return {
    name: String(meta.name ?? ''),
    description: String(meta.description ?? ''),
  };
}

async function fetchRaw(repoPath) {
  const url = `https://raw.githubusercontent.com/${REPO}/${REF}/${repoPath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${url}`);
  }
  return res.text();
}

async function main() {
  const entries = [];
  for (const repoPath of AGENCY_SKILL_PATHS) {
    const outPath = join(OUT_DIR, repoPath);
    mkdirSync(dirname(outPath), { recursive: true });
    console.log(`Fetching ${repoPath}`);
    const content = await fetchRaw(repoPath);
    writeFileSync(outPath, content, 'utf8');
    const { name, description } = parseFrontmatter(content);
    const id = basename(repoPath, '.md');
    const division = repoPath.split('/')[0] ?? 'design';
    entries.push({
      id,
      division,
      name: name || id,
      description: description || '',
      path: repoPath,
      sourceRepo: REPO,
      sourceRef: REF,
    });
  }

  const catalog = {
    version: 1,
    source: 'agency-agents',
    repo: REPO,
    ref: REF,
    fetchedAt: new Date().toISOString(),
    skills: entries,
  };
  writeFileSync(join(OUT_DIR, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${entries.length} skills → ${OUT_DIR}/catalog.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
