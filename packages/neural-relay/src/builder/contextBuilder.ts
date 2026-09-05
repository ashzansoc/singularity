import { createHash } from 'node:crypto';
import { estimateTokens } from '../hash.js';
import type {
  BuiltContext,
  ContextResolution,
  RepoIndexPort,
} from '../types.js';

function promptCacheKeyFor(stablePrefix: string): string {
  return `nr-${createHash('sha256').update(stablePrefix).digest('hex').slice(0, 24)}`;
}

export interface ContextBuilderInput {
  task: string;
  resolution: ContextResolution;
  index: RepoIndexPort;
  /** Stable architecture / project instructions (cacheable). */
  projectInstructions?: string;
  architecture?: string;
  toolDefinitions?: string;
  extraFiles?: string[];
  maxFileChars?: number;
  maxFiles?: number;
}

const STABLE_SYSTEM = `You are Singularity's coding agent.
Edit only what the task requires. Preserve existing architecture, routing, error handling, and tests unless the task says otherwise.
If you lack a file needed for a correct change, return JSON with needs_more_context, requested_files, and reason — do not guess.`;

/**
 * Convert a Nemotron resolution into DeepSeek prompt blocks.
 * Stable prefix is independent of the selected files so provider KV cache can hit.
 */
export function buildDeepSeekContext(input: ContextBuilderInput): BuiltContext {
  const maxFileChars = input.maxFileChars ?? 5_000;
  const maxFiles = input.maxFiles ?? 10;
  const wanted = new Set<string>();
  const ordered = [...input.resolution.relevant_files].sort(
    (a, b) => a.priority - b.priority,
  );
  for (const f of ordered) {
    wanted.add(f.path);
  }
  for (const extra of input.extraFiles ?? []) {
    wanted.add(extra);
  }

  const byPath = new Map(input.index.listFileMetadata().map((f) => [f.path, f]));
  const resolved: string[] = [];
  for (const path of wanted) {
    const meta = byPath.get(path);
    if (!meta) {
      continue;
    }
    resolved.push(path);
    const nb = input.index.neighborhood(path);
    for (const p of [...nb.imports.slice(0, 2), ...nb.tests.slice(0, 2)]) {
      if (!wanted.has(p) && byPath.has(p) && resolved.length < maxFiles) {
        resolved.push(p);
        wanted.add(p);
      }
    }
    if (resolved.length >= maxFiles) {
      break;
    }
  }

  const stableParts = [
    STABLE_SYSTEM,
    input.projectInstructions?.trim() || '',
    input.architecture?.trim() || '',
    input.toolDefinitions?.trim() || '',
    'STABLE PROJECT CONTEXT: prefer explicit constraints over speculation.',
  ].filter(Boolean);

  const fileBlocks: string[] = [];
  const filesUsed: string[] = [];
  for (const path of resolved) {
    const body = input.index.readFile(path);
    if (body === undefined) {
      continue;
    }
    filesUsed.push(path);
    const meta = byPath.get(path);
    const reason =
      ordered.find((f) => f.path === path)?.reason ?? 'dependency/test';
    fileBlocks.push(
      [
        `FILE ${path}`,
        meta ? `language=${meta.language} symbols=${meta.symbols.slice(0, 12).join(', ')}` : '',
        `reason: ${reason}`,
        body.slice(0, maxFileChars),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const symbols = input.resolution.relevant_symbols.length
    ? `RELEVANT SYMBOLS: ${input.resolution.relevant_symbols.join(', ')}`
    : '';
  const deps = input.resolution.dependencies_to_inspect.length
    ? `DEPENDENCIES: ${input.resolution.dependencies_to_inspect.join(', ')}`
    : '';

  const relevantBlock = [
    'MINIMUM SUFFICIENT CONTEXT (Neural Relay)',
    `Task understanding: ${input.resolution.task_understanding}`,
    symbols,
    deps,
    ...fileBlocks,
  ]
    .filter(Boolean)
    .join('\n\n');

  const stablePrefix = stableParts.join('\n\n');
  const originalContextTokens =
    estimateTokens(stablePrefix) +
    input.index.estimateCorpusTokens() +
    estimateTokens(input.task);
  const estimatedTokens =
    estimateTokens(stablePrefix) +
    estimateTokens(relevantBlock) +
    estimateTokens(input.task);

  return {
    stablePrefix,
    promptCacheKey: promptCacheKeyFor(stablePrefix),
    relevantBlock,
    userTask: input.task,
    filesUsed,
    estimatedTokens,
    originalContextTokens,
  };
}

export function renderDeepSeekPrompt(
  built: BuiltContext,
  extraVolatile?: string,
): string {
  return [
    built.stablePrefix,
    built.relevantBlock,
    extraVolatile?.trim() ?? '',
    `CURRENT TASK:\n${built.userTask}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function appendVolatileContext(
  built: BuiltContext,
  addition: string,
  files: string[],
): BuiltContext {
  const relevantBlock = `${built.relevantBlock}\n\n${addition}`;
  return {
    ...built,
    relevantBlock,
    filesUsed: [...new Set([...built.filesUsed, ...files])],
    estimatedTokens: estimateTokens(built.stablePrefix + relevantBlock + built.userTask),
    promptCacheKey: built.promptCacheKey,
  };
}
