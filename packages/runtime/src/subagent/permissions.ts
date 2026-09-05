/**
 * Fine-grained tool permission wrapper over WorkspacePort / ToolPort.
 */

import type { ToolPort, WorkspacePort } from '../ports.js';
import { normalizePath } from '../ports.js';
import type { ToolPermission } from './types.js';

export interface OwnershipRules {
  allowedPaths: string[];
  deniedPaths?: string[];
}

export interface PermissionedPorts {
  workspace: WorkspacePort;
  tools: ToolPort;
}

function pathAllowed(path: string, rules: OwnershipRules): boolean {
  const p = normalizePath(path);
  for (const d of rules.deniedPaths ?? []) {
    const nd = normalizePath(d);
    if (p === nd || p.startsWith(nd.replace(/\*\*$/, '').replace(/\*$/, ''))) {
      if (nd.endsWith('**') || nd.endsWith('*') || p === nd || p.startsWith(nd + '/')) {
        return false;
      }
      if (p === nd || p.startsWith(nd + '/')) {
        return false;
      }
    }
  }
  if (!rules.allowedPaths.length) {
    return true;
  }
  return rules.allowedPaths.some((a) => {
    const na = normalizePath(a);
    if (na.endsWith('/**')) {
      const base = na.slice(0, -3);
      return p === base || p.startsWith(base + '/');
    }
    if (na.endsWith('/**/*') || na.endsWith('/*')) {
      const base = na.replace(/\/\*\*?$/, '').replace(/\/\*$/, '');
      return p === base || p.startsWith(base + '/');
    }
    if (na.endsWith('**')) {
      const base = na.replace(/\*\*$/, '').replace(/\/$/, '');
      return p === base || p.startsWith(base + '/');
    }
    return p === na || p.startsWith(na + '/') || na.startsWith(p + '/');
  });
}

export class ToolPermissionError extends Error {
  constructor(
    public readonly tool: string,
    message: string,
  ) {
    super(message);
    this.name = 'ToolPermissionError';
  }
}

/**
 * Wrap workspace + tools so only allowed ToolPermissions and owned paths work.
 */
export function createPermissionedPorts(
  base: { workspace: WorkspacePort; tools?: ToolPort },
  allowed: ToolPermission[],
  ownership: OwnershipRules,
): PermissionedPorts {
  const allow = new Set(allowed);

  const assertTool = (tool: ToolPermission): void => {
    if (!allow.has(tool)) {
      throw new ToolPermissionError(tool, `Tool "${tool}" is not permitted for this subagent`);
    }
  };

  const workspace: WorkspacePort = {
    async readFile(path: string) {
      assertTool('read_file');
      return base.workspace.readFile(path);
    },
    async writeFile(path: string, content: string) {
      assertTool('write_file');
      if (!pathAllowed(path, ownership)) {
        throw new ToolPermissionError(
          'write_file',
          `Write denied for path outside ownership: ${path}`,
        );
      }
      if (!base.workspace.writeFile) {
        throw new ToolPermissionError('write_file', 'Workspace writeFile not available');
      }
      return base.workspace.writeFile(path, content);
    },
    async listFiles(glob?: string) {
      assertTool('list_directory');
      if (!base.workspace.listFiles) {
        return [];
      }
      return base.workspace.listFiles(glob);
    },
    async neighbors(path: string) {
      assertTool('read_file');
      return base.workspace.neighbors?.(path) ?? [];
    },
    async searchText(pattern: string, glob?: string) {
      assertTool('search_files');
      return base.workspace.searchText?.(pattern, glob) ?? [];
    },
  };

  const tools: ToolPort = {
    async searchText(pattern, glob) {
      assertTool('search_files');
      if (base.tools?.searchText) {
        return base.tools.searchText(pattern, glob);
      }
      return base.workspace.searchText?.(pattern, glob) ?? [];
    },
    async gitDiff(paths) {
      assertTool('git_diff');
      if (!base.tools?.gitDiff) {
        return '';
      }
      return base.tools.gitDiff(paths);
    },
    async gitStatus() {
      assertTool('git_status');
      if (!base.tools?.gitStatus) {
        return '';
      }
      return base.tools.gitStatus();
    },
    async typecheck(paths) {
      assertTool('typecheck');
      if (!base.tools?.typecheck) {
        return { ok: true, output: 'typecheck unavailable' };
      }
      return base.tools.typecheck(paths);
    },
    async test(paths) {
      assertTool('test');
      if (!base.tools?.test) {
        return { ok: true, output: 'test unavailable' };
      }
      return base.tools.test(paths);
    },
  };

  return { workspace, tools };
}

export async function executeToolCall(
  ports: PermissionedPorts,
  name: string,
  args: Record<string, unknown> = {},
  shellExec?: (command: string) => Promise<{ ok: boolean; output: string }>,
): Promise<{ ok: boolean; output: string }> {
  try {
    switch (name) {
      case 'read_file': {
        const path = String(args.path ?? '');
        const content = await ports.workspace.readFile(path);
        return {
          ok: content !== undefined,
          output: content ?? `File not found: ${path}`,
        };
      }
      case 'list_directory': {
        const files = await ports.workspace.listFiles?.(String(args.glob ?? '**/*'));
        return { ok: true, output: (files ?? []).slice(0, 200).join('\n') };
      }
      case 'search_files': {
        const hits = await ports.workspace.searchText?.(
          String(args.pattern ?? ''),
          args.glob ? String(args.glob) : undefined,
        );
        return {
          ok: true,
          output: (hits ?? [])
            .slice(0, 50)
            .map((h) => `${h.path}:${h.line}: ${h.text}`)
            .join('\n'),
        };
      }
      case 'write_file': {
        const path = String(args.path ?? '');
        const content = String(args.content ?? '');
        await ports.workspace.writeFile?.(path, content);
        return { ok: true, output: `Wrote ${path}` };
      }
      case 'git_status': {
        const out = await ports.tools.gitStatus?.();
        return { ok: true, output: out ?? '' };
      }
      case 'git_diff': {
        const paths = Array.isArray(args.paths)
          ? args.paths.map(String)
          : undefined;
        const out = await ports.tools.gitDiff?.(paths);
        return { ok: true, output: out ?? '' };
      }
      case 'typecheck': {
        const paths = Array.isArray(args.paths)
          ? args.paths.map(String)
          : undefined;
        const r = await ports.tools.typecheck?.(paths);
        return { ok: r?.ok ?? true, output: r?.output ?? '' };
      }
      case 'test': {
        const paths = Array.isArray(args.paths)
          ? args.paths.map(String)
          : undefined;
        const r = await ports.tools.test?.(paths);
        return { ok: r?.ok ?? true, output: r?.output ?? '' };
      }
      case 'terminal': {
        if (!shellExec) {
          return { ok: false, output: 'Terminal execution not available' };
        }
        return shellExec(String(args.command ?? ''));
      }
      default:
        return { ok: false, output: `Unknown tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, output: message };
  }
}

export { pathAllowed };
