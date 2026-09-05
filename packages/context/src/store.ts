/**
 * Durable project context store under `.singularity/project-context/`.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { emptyProjectState } from './merge.js';
import { nowIso } from './ids.js';
import type { ProjectState } from './types.js';

const DIR_NAME = 'project-context';

const COLLECTION_FILES = [
  'requirements',
  'constraints',
  'prohibitions',
  'technologies',
  'decisions',
  'preferences',
  'goals',
  'questions',
  'entities',
  'files',
  'sources',
] as const;

function contextDir(workspaceRoot: string): string {
  return join(workspaceRoot, '.singularity', DIR_NAME);
}

function versionsDir(workspaceRoot: string): string {
  return join(contextDir(workspaceRoot), 'versions');
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) {
    return fallback;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export class ProjectStateStore {
  constructor(private readonly workspaceRoot: string) {}

  get dir(): string {
    return contextDir(this.workspaceRoot);
  }

  load(projectId = 'default'): ProjectState {
    const dir = this.dir;
    if (!existsSync(dir)) {
      return emptyProjectState(projectId, this.workspaceRoot);
    }
    const meta = readJson(join(dir, 'meta.json'), {
      project_id: projectId,
      version: 0,
      last_updated: nowIso(),
      workspace_root: this.workspaceRoot,
    });
    const state: ProjectState = {
      meta,
      requirements: readJson(join(dir, 'requirements.json'), []),
      constraints: readJson(join(dir, 'constraints.json'), []),
      prohibitions: readJson(join(dir, 'prohibitions.json'), []),
      technologies: readJson(join(dir, 'technologies.json'), []),
      architecture_decisions: readJson(join(dir, 'decisions.json'), []),
      user_preferences: readJson(join(dir, 'preferences.json'), []),
      current_goals: readJson(join(dir, 'goals.json'), []),
      open_questions: readJson(join(dir, 'questions.json'), []),
      entities: readJson(join(dir, 'entities.json'), []),
      important_files: readJson(join(dir, 'files.json'), []),
      source_references: readJson(join(dir, 'sources.json'), []),
    };
    return state;
  }

  save(state: ProjectState): void {
    const dir = this.dir;
    mkdirSync(dir, { recursive: true });
    mkdirSync(versionsDir(this.workspaceRoot), { recursive: true });

    writeFileSync(
      join(dir, 'meta.json'),
      `${JSON.stringify(state.meta, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'requirements.json'),
      `${JSON.stringify(state.requirements, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'constraints.json'),
      `${JSON.stringify(state.constraints, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'prohibitions.json'),
      `${JSON.stringify(state.prohibitions, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'technologies.json'),
      `${JSON.stringify(state.technologies, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'decisions.json'),
      `${JSON.stringify(state.architecture_decisions, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'preferences.json'),
      `${JSON.stringify(state.user_preferences, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'goals.json'),
      `${JSON.stringify(state.current_goals, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'questions.json'),
      `${JSON.stringify(state.open_questions, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'entities.json'),
      `${JSON.stringify(state.entities, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'files.json'),
      `${JSON.stringify(state.important_files, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(dir, 'sources.json'),
      `${JSON.stringify(state.source_references, null, 2)}\n`,
      'utf8',
    );

    // Version snapshot
    const snapPath = join(
      versionsDir(this.workspaceRoot),
      `v${state.meta.version}.json`,
    );
    writeFileSync(snapPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  loadVersion(version: number): ProjectState | undefined {
    const path = join(versionsDir(this.workspaceRoot), `v${version}.json`);
    if (!existsSync(path)) {
      return undefined;
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as ProjectState;
    } catch {
      return undefined;
    }
  }

  listVersions(): number[] {
    const dir = versionsDir(this.workspaceRoot);
    if (!existsSync(dir)) {
      return [];
    }
    return readdirSync(dir)
      .map((f) => {
        const m = /^v(\d+)\.json$/.exec(f);
        return m ? Number(m[1]) : NaN;
      })
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
  }
}

export { COLLECTION_FILES, contextDir };
