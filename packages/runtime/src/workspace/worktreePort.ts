/**
 * Git worktree workspace port — isolated agent workspaces for parallel code changes.
 */

import type { WorkspacePort } from '../ports.js';

export interface WorktreeWorkspaceOptions {
  /** Base workspace root (main repo). */
  rootPath: string;
  /** Per-agent worktree paths keyed by agent id. */
  worktrees: Map<string, string>;
}

/** Resolve an agent-specific workspace port (falls back to base). */
export function workspacePortForAgent(
  base: WorkspacePort,
  opts: WorktreeWorkspaceOptions,
  agentId: string,
  readOnly = false,
): WorkspacePort {
  if (readOnly) {
    return base;
  }
  const wt = opts.worktrees.get(agentId);
  if (!wt) {
    return base;
  }
  return {
    readFile: (p) => base.readFile(joinUnder(wt, p)),
    writeFile: (p, c) => base.writeFile!(joinUnder(wt, p), c),
    listFiles: base.listFiles,
    searchText: base.searchText,
  };
}

function joinUnder(root: string, rel: string): string {
  const cleaned = rel.replace(/^\/+/, '');
  return `${root.replace(/\/+$/, '')}/${cleaned}`;
}

export function worktreePathForAgent(agentId: string, repositoryRoot: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9-_]/g, '-');
  return `${repositoryRoot}.worktrees/${safe}`;
}
