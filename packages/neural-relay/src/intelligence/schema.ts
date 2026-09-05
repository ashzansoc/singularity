import type { ContextResolution } from '../types.js';

export const CONTEXT_RESOLUTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'task_understanding',
    'relevant_files',
    'relevant_symbols',
    'dependencies_to_inspect',
    'missing_context',
    'confidence',
  ],
  properties: {
    task_understanding: { type: 'string' },
    relevant_files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'reason', 'priority'],
        properties: {
          path: { type: 'string' },
          reason: { type: 'string' },
          priority: { type: 'integer' },
        },
      },
    },
    relevant_symbols: { type: 'array', items: { type: 'string' } },
    dependencies_to_inspect: { type: 'array', items: { type: 'string' } },
    missing_context: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number' },
  },
};

export const CONTEXT_INTELLIGENCE_SYSTEM = `You are Singularity's Context Intelligence Agent.
You do NOT write or edit source code.
Your only job is to decide which existing repository information the coding model needs.

Return ONLY valid JSON matching the schema. No markdown fences. No reasoning.

Rules:
- Prefer the smallest set of files that is sufficient.
- Always include related tests and config when they exist in the candidate list.
- Paths MUST be taken from the provided candidate list. Do not invent paths.
- confidence is 0–1 reflecting how complete the selected set is.`;

export function emptyResolution(task: string): ContextResolution {
  return {
    task_understanding: task.slice(0, 200),
    relevant_files: [],
    relevant_symbols: [],
    dependencies_to_inspect: [],
    missing_context: [],
    confidence: 0,
  };
}

export function parseContextResolution(
  text: string,
  fallbackTask: string,
): ContextResolution | undefined {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return undefined;
  }
  try {
    const raw = JSON.parse(cleaned.slice(start, end + 1)) as Partial<ContextResolution>;
    if (!Array.isArray(raw.relevant_files)) {
      return undefined;
    }
    const files = raw.relevant_files
      .filter((f) => f && typeof f.path === 'string')
      .map((f, i) => ({
        path: String(f.path),
        reason: String(f.reason ?? ''),
        priority: Number(f.priority) || i + 1,
      }));
    const conf = Number(raw.confidence);
    return {
      task_understanding: String(raw.task_understanding ?? fallbackTask).slice(
        0,
        400,
      ),
      relevant_files: files,
      relevant_symbols: Array.isArray(raw.relevant_symbols)
        ? raw.relevant_symbols.map(String)
        : [],
      dependencies_to_inspect: Array.isArray(raw.dependencies_to_inspect)
        ? raw.dependencies_to_inspect.map(String)
        : [],
      missing_context: Array.isArray(raw.missing_context)
        ? raw.missing_context.map(String)
        : [],
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
    };
  } catch {
    return undefined;
  }
}

export function deterministicResolution(
  task: string,
  paths: string[],
): ContextResolution {
  return {
    task_understanding: task.slice(0, 400),
    relevant_files: paths.slice(0, 16).map((path, i) => ({
      path,
      reason: 'deterministic retrieval fallback',
      priority: i + 1,
    })),
    relevant_symbols: [],
    dependencies_to_inspect: [],
    missing_context: [],
    confidence: paths.length ? 0.55 : 0.2,
  };
}
