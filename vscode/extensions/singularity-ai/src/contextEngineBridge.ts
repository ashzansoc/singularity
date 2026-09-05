/**
 * Workspace-scoped Context Engine helper for the Singularity AI extension.
 *
 * Chat agent path: schedule LangExtract in the background, read already-written
 * JSON synchronously. Never await the sidecar on the chat critical path.
 */

import {
  createContextEngine,
  formatProjectSummary,
  formatVerificationChecklist,
  isContextEngineActive,
  readContextEngineFlags,
  type ContextEngine,
  type IngestMessageResult,
  type RelevantContext,
} from '@singularity/context';
import type { SingularityAI } from '@singularity/router';
import * as vscode from 'vscode';
import { buildWikiPromptBlock } from './wikiBridge.js';
import {
  isLangExtractSkipPrompt,
  scheduleLangExtractJob,
  type ScheduleResult,
} from './langExtractBackgroundAgent.js';
import {
  emitArchitectureEvent,
  getArchitectureSubsystem,
  lookupArchitectureContext,
} from './architectureBridge.js';
import { getMemorySubsystem, lookupMemoryContext } from './memoryBridge.js';
import { emitOutcomeEvent, getOutcomeSubsystem } from './outcomeBridge.js';
import { getIntelligenceEngine, isIntelligenceRemoteMode } from './intelligenceBridge.js';
import { ENGINE, uniqueEngines, type EngineDisplayName } from './engineCatalog.js';

let engine: ContextEngine | undefined;
let workspaceRoot: string | undefined;

export function getContextEngineFlagsFromConfig(): ReturnType<
  typeof readContextEngineFlags
> {
  const cfg = vscode.workspace.getConfiguration('singularity.ai');
  const envFlags = readContextEngineFlags();
  const enabledSetting = cfg.inspect<boolean>('contextEngine.enabled');
  // Explicit user/workspace setting wins; otherwise env / code default (ON).
  const userOverride =
    enabledSetting?.workspaceFolderValue ??
    enabledSetting?.workspaceValue ??
    enabledSetting?.globalValue;
  const enabled =
    userOverride !== undefined
      ? userOverride
      : envFlags.context_engine_enabled;
  return readContextEngineFlags({
    context_engine_enabled: Boolean(enabled),
    langextract_enabled:
      cfg.get<boolean>('contextEngine.langextractEnabled') ?? true,
    context_retrieval_enabled:
      cfg.get<boolean>('contextEngine.retrievalEnabled') ?? true,
    context_agent_integration_enabled:
      cfg.get<boolean>('contextEngine.agentIntegrationEnabled') ?? true,
  });
}

export function ensureContextEngine(
  folder?: vscode.WorkspaceFolder,
): ContextEngine | undefined {
  const root =
    folder?.uri.fsPath ??
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    return undefined;
  }
  const flags = getContextEngineFlagsFromConfig();
  if (!isContextEngineActive(flags)) {
    engine?.dispose();
    engine = undefined;
    workspaceRoot = undefined;
    return undefined;
  }
  if (engine && workspaceRoot === root) {
    return engine;
  }
  engine?.dispose();
  workspaceRoot = root;
  engine = createContextEngine({
    workspaceRoot: root,
    flags,
    // Prefer LangExtract when enabled; falls back to heuristic automatically
    heuristicOnly: !flags.langextract_enabled,
  });
  return engine;
}

export function disposeContextEngine(): void {
  engine?.dispose();
  engine = undefined;
  workspaceRoot = undefined;
}

/**
 * Run LangExtract now (manual refresh / tools). Prefer {@link scheduleContextIngest}
 * from the chat agent path.
 */
export async function ingestChatMessage(
  text: string,
  messageId?: string,
  ai?: SingularityAI,
): Promise<IngestMessageResult | undefined> {
  const trimmed = text?.trim() ?? '';
  if (isLangExtractSkipPrompt(trimmed)) {
    return { skipped: true, reason: 'trivial' };
  }
  const ce = ensureContextEngine();
  if (!ce) {
    return undefined;
  }
  try {
    const result = await ce.ingestMessage(text, {
      type: 'conversation',
      message_id: messageId,
    });
    if (!result.skipped && ai) {
      syncFactsToProjectMemory(ce, ai);
    }
    return result;
  } catch (err) {
    console.error(
      '[context-engine] ingest failed',
      err instanceof Error ? err.message : err,
    );
    return {
      skipped: true,
      reason: 'error',
    };
  }
}

/** Chat agent entry: enqueue LangExtract and return immediately. */
export function scheduleContextIngest(
  text: string,
  messageId?: string,
  ai?: SingularityAI,
): ScheduleResult {
  return scheduleLangExtractJob(
    text,
    messageId ?? `bg-${Date.now()}`,
    ai,
  );
}

function syncFactsToProjectMemory(ce: ContextEngine, ai: SingularityAI): void {
  for (const fact of ce.memoryFacts()) {
    ai.promptEngine.projectMemory.upsert({
      id: `ctx-${fact.id}`,
      kind: fact.kind as
        | 'architecture'
        | 'preference'
        | 'convention'
        | 'approach'
        | 'other',
      text: fact.text.slice(0, 400),
      updatedAt: Date.now(),
    });
  }
}

function collectPlaneEngines(): EngineDisplayName[] {
  const remote = isIntelligenceRemoteMode();
  return uniqueEngines([
    getArchitectureSubsystem() || remote ? ENGINE.architecture : undefined,
    getMemorySubsystem() || remote ? ENGINE.memory : undefined,
    getOutcomeSubsystem() || remote ? ENGINE.outcome : undefined,
    getIntelligenceEngine() || remote ? ENGINE.intelligence : undefined,
  ]);
}

export function buildRuntimeContextPayload(goal: string): {
  projectSummary?: string;
  structuredContext?: string;
  verificationChecklist?: string;
  relevant?: RelevantContext;
  engines: EngineDisplayName[];
} {
  const engines = collectPlaneEngines();
  const archBlock = (() => {
    try {
      const a = lookupArchitectureContext(goal);
      const m = lookupMemoryContext(goal);
      if (a && m) {
        return `${a}\n\n${m}`;
      }
      return a || m;
    } catch {
      return '';
    }
  })();
  const flags = getContextEngineFlagsFromConfig();
  if (
    !isContextEngineActive(flags) ||
    !flags.context_agent_integration_enabled
  ) {
    return archBlock
      ? { structuredContext: archBlock, engines }
      : { engines };
  }
  const ce = ensureContextEngine();
  if (ce) {
    engines.push(ENGINE.context);
  }
  if (!ce) {
    return archBlock
      ? { structuredContext: archBlock, engines }
      : { engines };
  }
  try {
    const relevant = ce.getRelevant(goal);
    let structured = relevant.prompt_block;
    if (archBlock) {
      structured = structured ? `${structured}\n\n${archBlock}` : archBlock;
    }
    if (!structured) {
      return { relevant, engines };
    }
    return {
      projectSummary: formatProjectSummary(relevant),
      structuredContext: structured,
      verificationChecklist: formatVerificationChecklist(relevant),
      relevant,
      engines,
    };
  } catch (err) {
    console.error(
      '[context-engine] retrieval failed',
      err instanceof Error ? err.message : err,
    );
    return archBlock
      ? { structuredContext: archBlock, engines }
      : { engines };
  }
}

/**
 * Chat-safe prepare: schedule LangExtract in background, return only
 * already-persisted context for the prompt. Never awaits the sidecar.
 */
export async function prepareContextForPrompt(
  text: string,
  ai?: SingularityAI,
  opts?: { messageId?: string; intent?: string },
): Promise<{
  structuredContext?: string;
  projectSummary?: string;
  verificationChecklist?: string;
  systemBlock?: string;
  engines?: EngineDisplayName[];
}> {
  if (!text?.trim()) {
    return { engines: [] };
  }
  if (isLangExtractSkipPrompt(text)) {
    return { engines: [] };
  }

  scheduleContextIngest(text, opts?.messageId ?? `mode-${Date.now()}`, ai);
  emitArchitectureEvent('USER_INTENT_CAPTURED', {
    text: text.slice(0, 4_000),
    session_id: opts?.messageId,
    task_id: opts?.intent,
  });
  emitOutcomeEvent('USER_INTENT_CAPTURED', {
    text: text.slice(0, 4_000),
    session_id: opts?.messageId,
    task_id: opts?.intent,
  });

  const payload = buildRuntimeContextPayload(text);
  const wiki = buildWikiPromptBlock(text);
  const engines = uniqueEngines([
    ...payload.engines,
    wiki.systemBlock ? ENGINE.wiki : undefined,
    ENGINE.context,
  ]);
  const intentHint = opts?.intent ? `Mode: ${opts.intent}` : '';
  const parts = [
    payload.structuredContext
      ? [
          'Singularity Project Context Engine — authoritative structured project state.',
          'Prefer explicit requirements, hard constraints, and prohibitions over speculation.',
          'Never violate active prohibitions or hard constraints.',
          intentHint,
          payload.structuredContext,
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    wiki.systemBlock,
  ].filter(Boolean);
  if (!parts.length) {
    return { ...payload, engines };
  }
  return { ...payload, systemBlock: parts.join('\n\n'), engines };
}

export function getActiveContextEngine(): ContextEngine | undefined {
  return ensureContextEngine();
}
