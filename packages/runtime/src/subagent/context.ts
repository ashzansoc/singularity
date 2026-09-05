/**
 * Per-subagent filtered context — never dump the full plan/repo.
 */

import type { ExecutionPlan, TaskNode } from '../types.js';
import type { SubagentResult } from './types.js';

export interface BuildSubagentContextOptions {
  task: TaskNode;
  plan: ExecutionPlan;
  /** Parent/global structured context (will be truncated). */
  parentContext?: string;
  /** Results from completed dependency subagents. */
  dependencyResults?: SubagentResult[];
  maxChars?: number;
}

/**
 * Build a role/task-scoped context block for a subagent.
 */
export function buildSubagentContext(opts: BuildSubagentContextOptions): string {
  const max = opts.maxChars ?? 6_000;
  const task = opts.task;
  const parts: string[] = [];

  parts.push(`## Subagent Context`);
  parts.push(`Role: ${task.role ?? task.specialty ?? 'general'}`);
  parts.push(`Objective: ${task.objective ?? task.title}`);
  if (task.contextScope?.length) {
    parts.push(
      `Context scope:\n${task.contextScope.map((p) => `- ${p}`).join('\n')}`,
    );
  }
  if (task.deliverable) {
    parts.push(`Deliverable: ${task.deliverable}`);
  }
  if (task.ownedPaths.length) {
    parts.push(`Owned paths:\n${task.ownedPaths.map((p) => `- ${p}`).join('\n')}`);
  }
  if (task.deniedPaths?.length) {
    parts.push(`Denied paths:\n${task.deniedPaths.map((p) => `- ${p}`).join('\n')}`);
  }
  if (task.neighborPaths?.length) {
    parts.push(
      `Neighbor paths:\n${task.neighborPaths.map((p) => `- ${p}`).join('\n')}`,
    );
  }

  if (opts.parentContext?.trim()) {
    const scoped = filterParentContext(opts.parentContext, task);
    if (scoped) {
      parts.push(`## Project context (filtered)\n${scoped}`);
    }
  }

  if (opts.dependencyResults?.length) {
    parts.push(`## Dependency results (structured only)`);
    for (const r of opts.dependencyResults) {
      parts.push(
        [
          `### ${r.subagentId} (${r.status})`,
          r.summary,
          r.filesCreated.length
            ? `Created: ${r.filesCreated.slice(0, 20).join(', ')}`
            : '',
          r.filesModified.length
            ? `Modified: ${r.filesModified.slice(0, 20).join(', ')}`
            : '',
          r.issues.length ? `Issues: ${r.issues.slice(0, 10).join('; ')}` : '',
          r.recommendations.length
            ? `Recommendations: ${r.recommendations.slice(0, 10).join('; ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
  }

  // Sibling private paths must not appear — only own + deps + neighbors.
  const text = parts.join('\n\n');
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Keep hard constraints/requirements lines; drop unrelated file dumps.
 */
function filterParentContext(parent: string, task: TaskNode): string {
  const scopeHints = (task.contextScope ?? []).map((p) =>
    p.replace(/\*\*/g, '').replace(/\*/g, '').toLowerCase(),
  );
  const hints = new Set(
    [...task.ownedPaths, ...(task.neighborPaths ?? []), ...scopeHints]
      .map((p) => p.toLowerCase())
      .concat((task.role ?? '').toLowerCase())
      .concat((task.objective ?? task.title).toLowerCase().split(/\s+/).slice(0, 12)),
  );

  const lines = parent.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    // Always keep constraints / prohibitions / requirements headers
    if (
      /constraint|prohibit|requirement|decision|tech|goal|standard/i.test(line)
    ) {
      kept.push(line);
      continue;
    }
    // Keep lines mentioning owned/neighbor path fragments or role keywords
    let hit = false;
    for (const h of hints) {
      if (h.length >= 3 && lower.includes(h)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      kept.push(line);
    }
  }

  // If filtering removed everything useful, keep a short prefix of parent
  if (kept.length < 3) {
    return parent.slice(0, 2_000);
  }
  return kept.join('\n').slice(0, 4_000);
}

/**
 * Collect dependency SubagentResults from completed plan nodes.
 */
export function collectDependencyResults(
  plan: ExecutionPlan,
  task: TaskNode,
): SubagentResult[] {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  const out: SubagentResult[] = [];
  for (const depId of task.deps) {
    const dep = byId.get(depId);
    if (dep?.result) {
      out.push(dep.result);
    }
  }
  return out;
}
