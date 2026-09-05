/**
 * Neural Relay host for the Singularity AI extension.
 * Default ON — Nemotron context intelligence for DeepSeek coding.
 */

import * as vscode from 'vscode';
import {
  applyContextExpansion,
  compactTokenCount,
  FilesystemRepoIndex,
  IntelligenceRepoIndex,
  isCodeOrConfigPath,
  isNeuralRelayEnabled,
  NeuralRelayStore,
  pathsFromFailureOutput,
  prepareNeuralRelayContext,
  readNeuralRelayFlags,
  shouldIgnorePath,
  type ExperimentRecord,
  type NeuralRelayFlags,
  type NeuralRelayMode,
  type RelayPrepareResult,
  type RepoIndexPort,
} from '@singularity/neural-relay';
import { getIntelligenceEngine } from './intelligenceBridge.js';
import {
  beginRequest,
  recordNeuralRelayExpansion,
  recordNeuralRelayPrepare,
  setRequestPhase,
} from './cacheTelemetry.js';
import { singularityLog, singularityWarn } from './singularityLog.js';

let lastPrepared: RelayPrepareResult | undefined;
let lastIndex: RepoIndexPort | undefined;
let store: NeuralRelayStore | undefined;
let onDidChange: vscode.EventEmitter<ExperimentRecord | undefined> | undefined;

export function getNeuralRelayFlagsFromConfig(): NeuralRelayFlags {
  const cfg = vscode.workspace.getConfiguration('singularity.ai');
  const env = readNeuralRelayFlags();
  const enabledSetting = cfg.inspect<boolean>('neuralRelay.enabled');
  const userOverride =
    enabledSetting?.workspaceFolderValue ??
    enabledSetting?.workspaceValue ??
    enabledSetting?.globalValue;
  const enabled =
    userOverride !== undefined ? Boolean(userOverride) : env.enabled;
  const mode = (cfg.get<string>('neuralRelay.mode') ?? env.mode) as NeuralRelayMode;
  return readNeuralRelayFlags({
    enabled,
    mode:
      mode === 'BASELINE' || mode === 'NEURAL_RELAY' || mode === 'NEURAL_RELAY_ITERATIVE'
        ? mode
        : env.mode,
    model: cfg.get<string>('neuralRelay.model') ?? env.model,
    confidenceHigh: cfg.get<number>('neuralRelay.confidenceHigh') ?? env.confidenceHigh,
    confidenceLow: cfg.get<number>('neuralRelay.confidenceLow') ?? env.confidenceLow,
    maxRelayFiles: cfg.get<number>('neuralRelay.maxFiles') ?? env.maxRelayFiles,
  });
}

export function neuralRelayStatus(): {
  enabled: boolean;
  mode: NeuralRelayMode;
  model: string;
  timeoutMs: number;
} {
  const flags = getNeuralRelayFlagsFromConfig();
  return {
    enabled: flags.enabled,
    mode: flags.mode,
    model: flags.model,
    timeoutMs: flags.timeoutMs,
  };
}

export function latestNeuralRelayExperiment(): ExperimentRecord | undefined {
  return lastPrepared?.experiment ?? store?.readLatest();
}

export function ensureNeuralRelayStore(): NeuralRelayStore | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    return undefined;
  }
  if (!store || store.dir.indexOf(root) < 0) {
    store = new NeuralRelayStore(root);
  }
  return store;
}

/** Reuse window for the cold-path filesystem index; keeps edits from going stale long. */
const FS_INDEX_REUSE_TTL_MS = 60_000;
const VSCODE_INDEX_EXCLUDE =
  '**/{node_modules,.git,dist,build,.singularity,coverage,.next}/**';
let lastIndexAt = 0;

/** True when the host engine exposes an in-process file graph (not just remote status). */
function intelligenceGraphReady(engine: { store: { listNodes(kind?: string): unknown[] } }): boolean {
  try {
    return engine.store.listNodes('file').length > 0;
  } catch {
    return false;
  }
}

async function discoverWorkspaceFileContents(
  root: string,
  maxFiles: number,
): Promise<Map<string, string>> {
  const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === root);
  if (!folder) {
    return new Map();
  }
  const uris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, '**/*'),
    VSCODE_INDEX_EXCLUDE,
    maxFiles,
  );
  const contents = new Map<string, string>();
  for (const uri of uris) {
    const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || shouldIgnorePath(rel) || !isCodeOrConfigPath(rel)) {
      continue;
    }
    try {
      const buf = await vscode.workspace.fs.readFile(uri);
      contents.set(rel, Buffer.from(buf).toString('utf8'));
    } catch {
      continue;
    }
  }
  return contents;
}

async function repoIndexFor(root: string): Promise<RepoIndexPort> {
  const engine = getIntelligenceEngine();
  // RemoteIntelligenceEngine reports fileCount from the worker but its in-process
  // store stub is empty until graph nodes are bridged — never use it without files.
  if (engine && intelligenceGraphReady(engine)) {
    const intelIndex = new IntelligenceRepoIndex(engine);
    if (intelIndex.listFileMetadata().length > 0) {
      const n = intelIndex.listFileMetadata().length;
      console.warn(`[neural-relay] index=intelligence files=${n} root=${root}`);
      singularityLog(`[neural-relay] index=intelligence files=${n}`);
      return intelIndex;
    }
  }
  // Perf: reuse the last FilesystemRepoIndex while its freshness window is
  // open instead of re-walking up to 2,000 files per cold call (cold start only).
  if (
    lastIndex &&
    lastIndex.workspaceRoot === root &&
    !(lastIndex instanceof IntelligenceRepoIndex) &&
    lastIndex.listFileMetadata().length > 0 &&
    Date.now() - lastIndexAt < FS_INDEX_REUSE_TTL_MS
  ) {
    return lastIndex;
  }

  const maxFiles = 2_000;
  const vscodeContents = await discoverWorkspaceFileContents(root, maxFiles);
  if (vscodeContents.size > 0) {
    lastIndex = FilesystemRepoIndex.fromPreloadedContents(root, vscodeContents);
    lastIndexAt = Date.now();
    const n = lastIndex.listFileMetadata().length;
    console.warn(
      `[neural-relay] index=vscode files=${n} discovered=${vscodeContents.size} root=${root}`,
    );
    singularityLog(`[neural-relay] index=vscode files=${n} root=${root}`);
    if (n > 0) {
      return lastIndex;
    }
  } else {
    console.warn(`[neural-relay] vscode discovery found 0 indexable files root=${root}`);
  }

  lastIndex = new FilesystemRepoIndex(root, maxFiles);
  lastIndexAt = Date.now();
  const n = lastIndex.listFileMetadata().length;
  console.warn(`[neural-relay] index=filesystem files=${n} root=${root}`);
  singularityLog(`[neural-relay] index=filesystem files=${n} root=${root}`);
  if (n === 0) {
    singularityWarn('[neural-relay] repo index empty — vscode and node fs both failed');
  }
  return lastIndex;
}

let inFlight: Promise<RelayPrepareResult | undefined> | undefined;
let inFlightTask: string | undefined;

export async function resolveNeuralRelay(
  task: string,
): Promise<RelayPrepareResult | undefined> {
  if (inFlight && inFlightTask === task) {
    return inFlight;
  }
  const flags = getNeuralRelayFlagsFromConfig();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root || !flags.enabled) {
    return undefined;
  }
  inFlightTask = task;
  inFlight = (async () => {
    beginRequest();
    setRequestPhase('Resolving Context', 'Neural Relay → Finding context…');
    lastIndex = await repoIndexFor(root);
    if (lastIndex.listFileMetadata().length === 0) {
      singularityWarn('[neural-relay] repo index empty after build — retrying vscode discovery');
      const contents = await discoverWorkspaceFileContents(root, 2_000);
      if (contents.size > 0) {
        lastIndex = FilesystemRepoIndex.fromPreloadedContents(root, contents);
        lastIndexAt = Date.now();
      }
    }
    const s = ensureNeuralRelayStore() ?? new NeuralRelayStore(root);
    try {
      lastPrepared = await prepareNeuralRelayContext({
        task,
        index: lastIndex,
        flags,
        store: s,
      });
      const exp = lastPrepared.experiment;
      console.warn(
        `[neural-relay] prepared candidates=${exp.tokens.files_considered} selected=${exp.tokens.files_selected} fallback=${lastPrepared.fallbackReason ?? 'none'}`,
      );
      singularityLog(
        `[neural-relay] prepared candidates=${exp.tokens.files_considered} selected=${exp.tokens.files_selected} fallback=${lastPrepared.fallbackReason ?? 'none'}`,
      );
      recordNeuralRelayPrepare(lastPrepared);
      onDidChange?.fire(lastPrepared.experiment);
      if (lastPrepared.usedRelay && lastPrepared.built) {
        setRequestPhase(
          'Building Context',
          `Context → ${compactTokenCount(lastPrepared.built.estimatedTokens)} tokens`,
        );
      }
      return lastPrepared;
    } catch (err) {
      setRequestPhase('Error', 'Neural Relay → Error');
      throw err;
    }
  })().finally(() => {
    if (inFlightTask === task) {
      inFlight = undefined;
      inFlightTask = undefined;
    }
  });
  return inFlight;
}

export async function expandNeuralRelay(
  requestedFiles: string[],
  reason: string,
): Promise<string> {
  if (!lastPrepared || !lastIndex) {
    return '';
  }
  setRequestPhase('Expanding Context', 'Neural Relay → Expanding…');
  const known = lastIndex.listFileMetadata().map((f) => f.path);
  const files = [
    ...new Set([...requestedFiles, ...pathsFromFailureOutput(reason, known)]),
  ];
  lastPrepared = applyContextExpansion(
    lastPrepared,
    lastIndex,
    files,
    reason,
    ensureNeuralRelayStore(),
  );
  recordNeuralRelayExpansion(lastPrepared);
  onDidChange?.fire(lastPrepared.experiment);
  return lastPrepared.promptBlock;
}

export function registerNeuralRelayStatusBar(
  context: vscode.ExtensionContext,
): void {
  onDidChange = new vscode.EventEmitter();
  context.subscriptions.push(onDidChange);
}

export function updateNeuralRelayStatusBar(): void {
  /* Cache/context status bar is owned by cacheTelemetry.ts */
}

export function isRelayEnvEnabled(): boolean {
  return isNeuralRelayEnabled() || getNeuralRelayFlagsFromConfig().enabled;
}
