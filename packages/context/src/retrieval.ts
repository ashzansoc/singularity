/**
 * Relevance-filtered retrieval over structured project state.
 */

import { estimateTokens } from './metrics.js';
import { formatRelevantContextBlock } from './format.js';
import type {
  ArchitectureDecision,
  Constraint,
  FileReference,
  Goal,
  OpenQuestion,
  Prohibition,
  ProjectState,
  RelevantContext,
  Requirement,
  Technology,
  UserPreference,
} from './types.js';

export interface RetrieveOptions {
  task: string;
  /** Max items per category. */
  limit?: number;
  /** Optional file paths from code retrieval to attach. */
  fileHints?: string[];
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9.+#-]+/)
      .filter((t) => t.length > 2),
  );
}

function scoreText(queryTokens: Set<string>, text: string): number {
  const tokens = tokenize(text);
  let hit = 0;
  for (const t of queryTokens) {
    if (tokens.has(t)) {
      hit += 1;
    }
  }
  // Boost hard constraints / prohibitions slightly always
  return hit;
}

function pickScored<T extends { status: string }>(
  items: T[],
  scoreFn: (item: T) => number,
  limit: number,
  minScore = 0,
): T[] {
  return items
    .filter((i) => i.status === 'active' || i.status === 'proposed')
    .map((item) => ({ item, score: scoreFn(item) }))
    .filter((x) => x.score > minScore || minScore === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item);
}

/**
 * Return only task-relevant project context (not full state).
 */
export function getRelevantContext(
  state: ProjectState,
  options: RetrieveOptions,
): RelevantContext {
  const limit = options.limit ?? 8;
  const q = tokenize(options.task);

  // Always include hard constraints / prohibitions with any overlap OR all if few
  const constraintsAll = state.constraints.filter(
    (c) => c.status === 'active' && c.strength === 'hard',
  );
  const prohibitionsAll = state.prohibitions.filter((p) => p.status === 'active');

  const requirements = pickScored(
    state.requirements,
    (r: Requirement) =>
      scoreText(q, `${r.description} ${r.type}`) +
      (r.priority === 'high' ? 0.5 : 0),
    limit,
  );
  let constraints = pickScored(
    state.constraints,
    (c: Constraint) =>
      scoreText(q, c.constraint) + (c.strength === 'hard' ? 1 : 0),
    limit,
  );
  if (constraints.length === 0 && constraintsAll.length <= 6) {
    constraints = constraintsAll.slice(0, limit);
  }

  let prohibitions = pickScored(
    state.prohibitions,
    (p: Prohibition) => scoreText(q, p.prohibition) + 1,
    limit,
  );
  if (prohibitions.length === 0 && prohibitionsAll.length <= 6) {
    prohibitions = prohibitionsAll.slice(0, limit);
  }

  const technologies = pickScored(
    state.technologies,
    (t: Technology) => scoreText(q, `${t.name} ${t.category} ${t.role ?? ''}`),
    limit,
  );
  const decisions = pickScored(
    state.architecture_decisions,
    (d: ArchitectureDecision) =>
      scoreText(q, `${d.decision} ${d.category} ${d.alternatives_rejected.join(' ')}`),
    limit,
  );
  const preferences = pickScored(
    state.user_preferences,
    (p: UserPreference) => scoreText(q, p.preference),
    Math.min(4, limit),
  );
  const goals = pickScored(
    state.current_goals,
    (g: Goal) => scoreText(q, g.goal),
    Math.min(4, limit),
  );
  const open_questions = pickScored(
    state.open_questions,
    (o: OpenQuestion) => scoreText(q, o.question),
    Math.min(4, limit),
  );

  let files = pickScored(
    state.important_files,
    (f: FileReference) => scoreText(q, `${f.path} ${f.reason ?? ''}`),
    limit,
  );

  // Attach file hints from code retrieval
  if (options.fileHints?.length) {
    const existing = new Set(files.map((f) => f.path));
    for (const path of options.fileHints.slice(0, limit)) {
      if (!existing.has(path)) {
        files.push({
          id: `hint_${path}`,
          path,
          reason: 'code retrieval hint',
          related_item_ids: [],
          status: 'active',
          confidence: 0.7,
          confidence_category: 'medium',
          source_type: 'inferred',
          source: { type: 'code', file: path },
          created_at: state.meta.last_updated,
          updated_at: state.meta.last_updated,
        });
      }
    }
    files = files.slice(0, limit);
  }

  // If nothing scored, include top active tech + goals as baseline
  if (
    requirements.length === 0 &&
    technologies.length === 0 &&
    decisions.length === 0
  ) {
    technologies.push(
      ...state.technologies.filter((t) => t.status === 'active').slice(0, 4),
    );
    goals.push(
      ...state.current_goals.filter((g) => g.status === 'active').slice(0, 3),
    );
  }

  const prompt_block = formatRelevantContextBlock({
    requirements,
    constraints,
    prohibitions,
    technologies,
    decisions,
    preferences,
    goals,
    open_questions,
    files,
  });

  return {
    requirements,
    constraints,
    prohibitions,
    technologies,
    decisions,
    preferences,
    goals,
    open_questions,
    files,
    prompt_block,
    estimated_tokens: estimateTokens(prompt_block),
  };
}

/**
 * Estimate raw (full state) tokens for comparison.
 */
export function estimateFullStateTokens(state: ProjectState): number {
  return estimateTokens(JSON.stringify(state));
}
