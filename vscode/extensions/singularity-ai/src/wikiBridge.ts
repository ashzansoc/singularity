/**
 * Workspace-scoped LLM Wiki helper for the Singularity AI extension.
 */

import {
  createWikiEngine,
  isWikiEngineActive,
  readWikiEngineFlags,
  type WikiEngine,
  type WikiIngestResult,
  type WikiQueryResult,
  type WikiLintResult,
  type WikiSearchHit,
  type WikiStatus,
} from '@singularity/wiki';
import * as vscode from 'vscode';

let engine: WikiEngine | undefined;
let workspaceRoot: string | undefined;

export function getWikiEngineFlagsFromConfig(): ReturnType<typeof readWikiEngineFlags> {
  const cfg = vscode.workspace.getConfiguration('singularity.ai');
  const envFlags = readWikiEngineFlags();
  const enabledSetting = cfg.inspect<boolean>('wiki.enabled');
  const userOverride =
    enabledSetting?.workspaceFolderValue ??
    enabledSetting?.workspaceValue ??
    enabledSetting?.globalValue;
  const enabled =
    userOverride !== undefined ? userOverride : envFlags.wiki_enabled;
  const rootSetting = cfg.get<string>('wiki.root')?.trim();
  return readWikiEngineFlags({
    wiki_enabled: Boolean(enabled),
    wiki_agent_integration_enabled:
      cfg.get<boolean>('wiki.agentIntegrationEnabled') ?? true,
    wiki_root: rootSetting || envFlags.wiki_root,
  });
}

export function ensureWikiEngine(
  folder?: vscode.WorkspaceFolder,
): WikiEngine | undefined {
  const root =
    folder?.uri.fsPath ??
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    return undefined;
  }
  const flags = getWikiEngineFlagsFromConfig();
  if (!isWikiEngineActive(flags)) {
    engine = undefined;
    workspaceRoot = undefined;
    return undefined;
  }
  if (engine && workspaceRoot === root) {
    return engine;
  }
  workspaceRoot = root;
  engine = createWikiEngine({ workspaceRoot: root, flags });
  return engine;
}

export function disposeWikiEngine(): void {
  engine = undefined;
  workspaceRoot = undefined;
}

export function getActiveWikiEngine(): WikiEngine | undefined {
  return ensureWikiEngine();
}

export function wikiStatus(): WikiStatus | undefined {
  return ensureWikiEngine()?.status();
}

export function initWiki():
  | { ok: true; created: boolean; wikiRoot: string; agentsPointer: boolean }
  | { ok: false; reason: string } {
  const wiki = ensureWikiEngine();
  if (!wiki) {
    return { ok: false, reason: 'disabled_or_no_workspace' };
  }
  const result = wiki.init();
  return { ok: true, ...result };
}

export function ingestIntoWiki(input: {
  text?: string;
  title?: string;
  sourcePath?: string;
  filename?: string;
  url?: string;
  notes?: string;
}): WikiIngestResult | { skipped: true; reason: string } {
  const wiki = ensureWikiEngine();
  if (!wiki) {
    return { skipped: true, reason: 'disabled_or_no_workspace' };
  }
  try {
    return wiki.ingest(input);
  } catch (err) {
    console.error(
      '[llm-wiki] ingest failed',
      err instanceof Error ? err.message : err,
    );
    return { skipped: true, reason: 'error' };
  }
}

export function queryWiki(
  question: string,
  opts?: { fileAnswer?: boolean },
): WikiQueryResult | undefined {
  return ensureWikiEngine()?.query(question, opts);
}

export function searchWiki(query: string, limit?: number): WikiSearchHit[] {
  return ensureWikiEngine()?.search(query, limit) ?? [];
}

export function lintWiki(): WikiLintResult | undefined {
  return ensureWikiEngine()?.lint();
}

export function fileWikiAnswer(input: {
  question: string;
  answer: string;
  title?: string;
  citations?: string[];
}): { relPath: string } | undefined {
  return ensureWikiEngine()?.fileAnswer(input);
}

export function buildWikiPromptBlock(task?: string): {
  systemBlock?: string;
  initialized?: boolean;
} {
  const flags = getWikiEngineFlagsFromConfig();
  if (!isWikiEngineActive(flags) || !flags.wiki_agent_integration_enabled) {
    return {};
  }
  const wiki = ensureWikiEngine();
  if (!wiki) {
    return {};
  }
  try {
    const block = wiki.formatContextBlock(task);
    return { systemBlock: block.systemBlock, initialized: block.initialized };
  } catch (err) {
    console.error(
      '[llm-wiki] context block failed',
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}
