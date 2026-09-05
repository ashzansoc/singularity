/**
 * Default tools, model policy, and specialty mapping per SubagentRole.
 */

import type { Tier } from '@singularity/router';
import type { TaskNode } from '../types.js';
import type {
  ModelPolicy,
  ModelStrategy,
  SubagentRole,
  ToolPermission,
} from './types.js';

export interface RoleDefaults {
  tools: ToolPermission[];
  modelPolicy: ModelPolicy;
  maxIterations: number;
  timeoutMs: number;
  retryLimit: number;
  specialty?: TaskNode['specialty'];
}

const READ_TOOLS: ToolPermission[] = [
  'read_file',
  'search_files',
  'list_directory',
];

const EDIT_TOOLS: ToolPermission[] = [
  ...READ_TOOLS,
  'write_file',
  'terminal',
  'git_status',
  'git_diff',
];

const REVIEW_TOOLS: ToolPermission[] = [
  ...READ_TOOLS,
  'terminal',
  'typecheck',
  'test',
  'git_status',
  'git_diff',
];

const TEST_TOOLS: ToolPermission[] = [
  ...READ_TOOLS,
  'terminal',
  'typecheck',
  'test',
  'git_status',
];

function policy(
  strategy: ModelStrategy,
  preferredTier: Tier,
  preferredModels?: string[],
): ModelPolicy {
  return { strategy, preferredTier, preferredModels };
}

const ROLE_DEFAULTS: Record<string, RoleDefaults> = {
  explorer: {
    tools: READ_TOOLS,
    modelPolicy: policy('fast', 'T1'),
    maxIterations: 6,
    timeoutMs: 120_000,
    retryLimit: 1,
    specialty: 'general',
  },
  researcher: {
    tools: READ_TOOLS,
    modelPolicy: policy('fast', 'T1'),
    maxIterations: 6,
    timeoutMs: 120_000,
    retryLimit: 1,
    specialty: 'general',
  },
  frontend: {
    tools: EDIT_TOOLS,
    modelPolicy: policy('coding', 'T2', ['deepseek/deepseek-v4-flash-0731']),
    maxIterations: 10,
    timeoutMs: 300_000,
    retryLimit: 2,
    specialty: 'frontend',
  },
  backend: {
    tools: EDIT_TOOLS,
    modelPolicy: policy('coding', 'T3'),
    maxIterations: 10,
    timeoutMs: 300_000,
    retryLimit: 2,
    specialty: 'backend',
  },
  database: {
    tools: EDIT_TOOLS,
    modelPolicy: policy('coding', 'T3'),
    maxIterations: 8,
    timeoutMs: 240_000,
    retryLimit: 2,
    specialty: 'backend',
  },
  debugger: {
    tools: EDIT_TOOLS,
    modelPolicy: policy('reasoning', 'T4'),
    maxIterations: 10,
    timeoutMs: 300_000,
    retryLimit: 2,
    specialty: 'general',
  },
  tester: {
    tools: TEST_TOOLS,
    modelPolicy: policy('fast', 'T2'),
    maxIterations: 8,
    timeoutMs: 240_000,
    retryLimit: 1,
    specialty: 'general',
  },
  reviewer: {
    tools: REVIEW_TOOLS,
    modelPolicy: policy('reasoning', 'T4'),
    maxIterations: 6,
    timeoutMs: 180_000,
    retryLimit: 1,
    specialty: 'general',
  },
  integrator: {
    tools: [...READ_TOOLS, 'write_file', 'git_status', 'git_diff'],
    modelPolicy: policy('balanced', 'T4'),
    maxIterations: 6,
    timeoutMs: 180_000,
    retryLimit: 1,
    specialty: 'general',
  },
};

const FALLBACK: RoleDefaults = {
  tools: EDIT_TOOLS,
  modelPolicy: policy('balanced', 'T3'),
  maxIterations: 8,
  timeoutMs: 240_000,
  retryLimit: 2,
  specialty: 'general',
};

export function getRoleDefaults(role: SubagentRole): RoleDefaults {
  return ROLE_DEFAULTS[role] ?? FALLBACK;
}

/** Map legacy specialty → subagent role when role omitted. */
export function roleFromSpecialty(
  specialty: TaskNode['specialty'] | undefined,
): SubagentRole {
  switch (specialty) {
    case 'frontend':
    case 'frontend-refine':
      return 'frontend';
    case 'backend':
      return 'backend';
    case 'visual-critic':
      return 'reviewer';
    case 'design-director':
      return 'researcher';
    case 'ai-pipeline':
    case 'infrastructure':
    case 'general':
    default:
      return specialty === 'ai-pipeline'
        ? 'backend'
        : specialty === 'infrastructure'
          ? 'backend'
          : 'explorer';
  }
}

/** Infer role from title/objective heuristics. */
export function inferRoleFromText(text: string): SubagentRole | undefined {
  const t = text.toLowerCase();
  if (/\b(explor|analyz|survey|map (the )?codebase)\b/.test(t)) {
    return 'explorer';
  }
  if (/\b(research|investigat)\b/.test(t)) {
    return 'researcher';
  }
  if (/\b(review|qa|critique|visual critic)\b/.test(t)) {
    return 'reviewer';
  }
  if (/\b(test|spec|jest|vitest|playwright)\b/.test(t)) {
    return 'tester';
  }
  if (/\b(debug|fix|hotfix)\b/.test(t)) {
    return 'debugger';
  }
  if (/\b(integrat|stitch|merge)\b/.test(t)) {
    return 'integrator';
  }
  if (/\b(database|migration|schema|prisma|sql)\b/.test(t)) {
    return 'database';
  }
  if (/\b(frontend|ui|react|css|component|page)\b/.test(t)) {
    return 'frontend';
  }
  if (/\b(backend|api|server|endpoint|auth)\b/.test(t)) {
    return 'backend';
  }
  return undefined;
}

export function strategyToTier(strategy: ModelStrategy): Tier {
  switch (strategy) {
    case 'fast':
      return 'T1';
    case 'coding':
      return 'T2';
    case 'balanced':
      return 'T3';
    case 'reasoning':
      return 'T4';
    case 'vision':
      return 'T3';
    case 'custom':
      return 'T3';
    default:
      return 'T3';
  }
}

export function isKnownRole(role: string): boolean {
  return role in ROLE_DEFAULTS;
}
