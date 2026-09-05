/**
 * Singularity Brain bridge — persistent USER-level cognitive runtime.
 *
 * Owns the BrainEngine singleton (SQLite in globalStorage), starts BrainRuntime
 * on activate, feeds events through the attention loop, and hosts the graph UI.
 */

import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import * as vscode from 'vscode';
import { BrainEngine, type BrainRuntimeSnapshot } from '@singularity/brain';
import type { SingularityAI } from '@singularity/router';
import { IntelligenceShellPanel } from './intelligenceShell/shellPanel.js';
import { isShellRoute, type ShellRoute } from './intelligenceShell/protocol.js';
import { requestIntelligenceIndex } from './intelligenceBridge.js';
import { singularityLog, singularityWarn } from './singularityLog.js';

let engine: BrainEngine | undefined;
let contextRef: vscode.ExtensionContext | undefined;
let gatewayKeyRef: string | undefined;
let gatewayUrlRef: string | undefined;
let fileTimer: ReturnType<typeof setTimeout> | undefined;
let bridgeStarted = false;

const BRAIN_USER_KEY = 'singularity.brain.userId';

const progressListeners = new Set<(event: import('@singularity/brain').SyncProgressEvent) => void>();
const statusListeners = new Set<(snap: BrainRuntimeSnapshot) => void>();
const deltaListeners = new Set<(delta: { memories?: number; relationships?: number; learnings?: number; insights?: number }) => void>();

/** Panel subscribes so sync progress reaches the graph UI. */
export function onBrainProgress(fn: (event: import('@singularity/brain').SyncProgressEvent) => void): vscode.Disposable {
  progressListeners.add(fn);
  return new vscode.Disposable(() => progressListeners.delete(fn));
}

export function onBrainRuntimeStatus(fn: (snap: BrainRuntimeSnapshot) => void): vscode.Disposable {
  statusListeners.add(fn);
  return new vscode.Disposable(() => statusListeners.delete(fn));
}

export function onBrainMemoryDelta(fn: (delta: { memories?: number; relationships?: number; learnings?: number; insights?: number }) => void): vscode.Disposable {
  deltaListeners.add(fn);
  return new vscode.Disposable(() => deltaListeners.delete(fn));
}

export function startBrainBridge(
  context: vscode.ExtensionContext,
  opts: {
    getAi: () => SingularityAI | undefined;
    gatewayKey?: string;
    gatewayUrl?: string;
  },
): void {
  contextRef = context;
  if (opts.gatewayKey) {
    gatewayKeyRef = opts.gatewayKey;
  }
  if (opts.gatewayUrl) {
    gatewayUrlRef = opts.gatewayUrl;
  }
  if (bridgeStarted) {
    return;
  }
  bridgeStarted = true;
  void opts.getAi; // retained for future embedding/router fallbacks

  context.subscriptions.push(
    vscode.commands.registerCommand('singularity.brain.open', () => openBrain()),
    vscode.commands.registerCommand(
      'singularity.ai.intelligence.open',
      (route?: string) => {
        const r: ShellRoute = isShellRoute(route) ? route : 'context';
        openIntelligenceShell(r);
        void requestIntelligenceIndex('recent');
      },
    ),
    vscode.commands.registerCommand('singularity.ai.memory.open', () => openIntelligenceShell('memory')),
    vscode.commands.registerCommand('singularity.ai.architecture.open', () => openIntelligenceShell('architecture')),
    vscode.commands.registerCommand('singularity.ai.tasks.open', () => openIntelligenceShell('tasks')),
    vscode.commands.registerCommand('singularity.brain.syncEverything', () => syncEverything(true)),
    vscode.commands.registerCommand('singularity.brain.ultrathink', () => void runUltrathink()),
    vscode.commands.registerCommand('singularity.ai.brain.status', () => brainStatus()),
    vscode.commands.registerCommand('singularity.ai.brain.context', () => brainContextSnapshot()),
    vscode.commands.registerCommand(
      'singularity.ai.brain.relevant',
      async (req?: { task?: string; limit?: number }) => {
        const task = req?.task?.trim();
        const eng = ensureBrainEngine();
        if (!task || !eng) {
          return { ok: false, block: '' };
        }
        try {
          const block = await eng.relevantContext(task, req?.limit ?? 900);
          return { ok: Boolean(block), block };
        } catch {
          return { ok: false, block: '' };
        }
      },
    ),
    vscode.commands.registerCommand('singularity.ai.brain.global', async () => {
      const eng = ensureBrainEngine();
      if (!eng) {
        return { ok: false, block: '' };
      }
      try {
        const block = await eng.relevantContext(
          'user identity name profile company role creator preferences projects who is the user',
          1_200,
        );
        return { ok: Boolean(block), block };
      } catch {
        return { ok: false, block: '' };
      }
    }),
    vscode.commands.registerCommand(
      'singularity.ai.brain.observeChat',
      (req?: { text?: string; sourceRef?: string }) => {
        const text = req?.text?.trim();
        if (text) {
          observeChat(text, req?.sourceRef);
        }
        return { ok: true };
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.brain.observeFile',
      (req?: { uri?: string; content?: string }) => {
        if (req?.uri && typeof req.content === 'string') {
          queueFileObservation(req.uri, req.content);
        }
        return { ok: true };
      },
    ),
    vscode.commands.registerCommand(
      'singularity.ai.brain.insightFeedback',
      (req?: { id?: string; status?: 'accepted' | 'rejected' | 'dismissed' | 'seen' }) => {
        if (!engine || !req?.id || !req.status) {
          return { ok: false };
        }
        const updated = engine.store.updateInsightStatus(req.id, req.status);
        if (updated && (req.status === 'accepted' || req.status === 'rejected' || req.status === 'dismissed')) {
          // Reinforcement-like procedural learning: raise threshold after rejections.
          const proc = engine.store.searchProcedures('insight recommendation', 1)[0];
          if (proc) {
            const success = req.status === 'accepted' ? proc.successRate + 0.05 : proc.successRate;
            const failure = req.status !== 'accepted' ? proc.failureRate + 0.05 : proc.failureRate;
            engine.store.upsertProcedure({
              ...proc,
              successRate: Math.min(1, success),
              failureRate: Math.min(1, failure),
              lastEvaluated: Date.now(),
              evidence: [...proc.evidence, `feedback:${req.status}:${req.id}`].slice(-20),
            });
          } else if (req.status === 'rejected' || req.status === 'dismissed') {
            engine.store.upsertProcedure({
              name: 'insight recommendation threshold',
              conditions: 'When proposing architecture/refactor insights',
              steps: ['Require stronger evidence', 'Prefer NO_ACTION over low-value suggestions'],
              successRate: 0,
              failureRate: 0.1,
              evidence: [`feedback:${req.status}:${req.id}`],
              confidence: 0.6,
            });
          }
        }
        IntelligenceShellPanel.refreshIfOpen();
        return { ok: Boolean(updated) };
      },
    ),
    { dispose: () => engine?.close() },
  );

  context.subscriptions.push(
    onBrainProgress((event) => {
      IntelligenceShellPanel.postBrainForward({ type: 'progress', event });
      if (event.status === 'done') {
        IntelligenceShellPanel.refreshIfOpen();
      }
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      queueFileObservation(doc.uri.toString(), doc.getText());
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      engine?.observeEvent({
        kind: 'project_switch',
        text: root ? `Switched workspace to ${root}` : 'Workspace folders changed',
        projectId: root ? projectIdForRoot(root) : undefined,
        workspaceRoot: root,
        ts: Date.now(),
      });
    }),
    { dispose: () => fileTimer && clearTimeout(fileTimer) },
  );
}

function readBrainConfigFromSettings(): import('@singularity/brain').BrainConfigPartial {
  const cfg = vscode.workspace.getConfiguration('singularity.ai.brain');
  return {
    enabled: cfg.get<boolean>('enabled', true),
    model: {
      provider: 'openai-compatible',
      baseUrl: cfg.get<string>('model.baseUrl', '') || '',
      apiKey: cfg.get<string>('model.apiKey', '') || '',
      model: cfg.get<string>('model.model', '') || '',
      timeoutMs: cfg.get<number>('model.timeoutMs', 120_000),
    },
    reasoning: {
      default: cfg.get<string>('reasoning.default', 'high') || 'high',
      ultrathink: cfg.get<string>('reasoning.ultrathink', 'maximum') || 'maximum',
    },
    contextLimit: cfg.get<number>('contextLimit', 12_000),
    maxBackgroundCallsPerDay: cfg.get<number>('maxBackgroundCallsPerDay', 48),
    maxTokensPerCall: cfg.get<number>('maxTokensPerCall', 4096),
    idleMs: cfg.get<number>('idleMs', 5 * 60_000),
    backgroundLevel: cfg.get<'low' | 'balanced' | 'high'>('backgroundLevel', 'balanced'),
    ultrathink: cfg.get<'off' | 'manual' | 'automatic'>('ultrathink', 'automatic'),
    dailyBudgetUsd: cfg.get<number>('dailyBudgetUsd', 2),
  };
}

/** Returns the shared BrainEngine, initializing on first use. */
export function getBrainEngine(gatewayKey?: string, gatewayUrl?: string): BrainEngine | undefined {
  return ensureBrainEngine(gatewayKey, gatewayUrl);
}

function ensureBrainEngine(gatewayKey?: string, gatewayUrl?: string): BrainEngine | undefined {
  if (engine || !contextRef) {
    return engine;
  }
  const key = gatewayKey ?? gatewayKeyRef;
  const url = gatewayUrl ?? gatewayUrlRef;
  try {
    const storageDir = join(contextRef.globalStorageUri.fsPath, 'brain');
    let userId = contextRef.globalState.get<string>(BRAIN_USER_KEY);
    if (!userId) {
      userId = randomUUID();
      void contextRef.globalState.update(BRAIN_USER_KEY, userId);
    }
    engine = new BrainEngine({
      storageDir,
      userId,
      brainConfig: readBrainConfigFromSettings(),
      embedding: key && url ? { apiKey: key, baseUrl: url } : undefined,
      onProgress: (event) => {
        progressListeners.forEach((fn) => fn(event));
      },
      onRuntimeStatus: (snap) => {
        statusListeners.forEach((fn) => fn(snap));
        IntelligenceShellPanel.postActivity(
          snap.status !== 'idle' ? `Brain: ${snap.status}` : 'Brain idle',
          snap.status === 'active' ? 0.55 : 0.2,
        );
      },
      onMemoryDelta: (delta) => {
        deltaListeners.forEach((fn) => fn(delta));
        const parts = [
          delta.memories ? `${delta.memories} memories` : '',
          delta.relationships ? `${delta.relationships} links` : '',
          delta.insights ? `${delta.insights} insights` : '',
        ].filter(Boolean);
        if (parts.length) {
          IntelligenceShellPanel.postActivity(parts.join(' · '), 0.7);
        }
      },
      getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      startRuntime: false,
    });
    singularityLog(`[singularity-ai] Brain runtime ready (${engine.store.usesSqlite ? 'sqlite' : 'json-fallback'})`);
  } catch (err) {
    singularityWarn('[singularity-ai] Brain init failed', err instanceof Error ? err.message : err);
    engine = undefined;
  }
  return engine;
}

function ensureBrainRuntime(): void {
  engine?.ensureRuntimeStarted();
}

function projectIdForRoot(root: string): string {
  return basename(root) || root;
}

export function openIntelligenceShell(route: ShellRoute = 'context'): void {
  if (!contextRef) {
    void vscode.window.showWarningMessage('Singularity is still starting.');
    return;
  }
  IntelligenceShellPanel.postBootStatus('Opening Intelligence Shell…', 0.05);
  if (route === 'brain' && !ensureBrainEngine()) {
    IntelligenceShellPanel.postActivity('Brain engine unavailable', undefined);
    void vscode.window.showWarningMessage('Singularity Brain is not available.');
    return;
  }
  if (route === 'brain') {
    ensureBrainRuntime();
  }
  IntelligenceShellPanel.show(
    contextRef,
    {
      getBrainEngine: () => engine,
      onBrainSync: () => void syncEverything(false),
      extensionPath: contextRef.extensionPath,
    },
    route,
  );
  IntelligenceShellPanel.postBootStatus(activityLabelForRoute(route), 0.12);
}

export function reportIntelligenceShellProgress(label: string, progress?: number): void {
  IntelligenceShellPanel.postBootStatus(label, progress);
}

export function openBrain(): void {
  openIntelligenceShell('context');
}

function activityLabelForRoute(route: ShellRoute): string {
  switch (route) {
    case 'context':
      return 'Building context…';
    case 'brain':
      return 'Loading knowledge graph…';
    case 'memory':
      return 'Loading memories…';
    case 'architecture':
      return 'Tracing architecture…';
    case 'tasks':
      return 'Loading tasks…';
  }
}

export async function syncEverything(notify: boolean): Promise<void> {
  const eng = ensureBrainEngine();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!eng || !root) {
    if (notify) {
      void vscode.window.showWarningMessage('Open a workspace folder to sync into the Brain.');
    }
    return;
  }
  if (notify) {
    void vscode.window.showInformationMessage('Singularity Brain: syncing everything…');
  }
  ensureBrainRuntime();
  eng.observeEvent({
    kind: 'sync',
    text: `Sync everything for ${root}`,
    projectId: projectIdForRoot(root),
    workspaceRoot: root,
    ts: Date.now(),
  });
  const state = await eng.syncWorkspace(root, projectIdForRoot(root));
  if (notify) {
    if (state.status === 'done') {
      void vscode.window.showInformationMessage(`Singularity Brain updated — ${eng.stats().entities} memories.`);
    } else if (state.status === 'error') {
      void vscode.window.showErrorMessage(`Singularity Brain sync failed: ${state.error ?? 'unknown error'}`);
    }
  }
  IntelligenceShellPanel.refreshIfOpen();
}

async function runUltrathink(): Promise<void> {
  const eng = ensureBrainEngine();
  if (!eng) {
    void vscode.window.showWarningMessage('Singularity Brain is not available.');
    return;
  }
  const brief = await vscode.window.showInputBox({
    prompt: 'UltraThink brief (what should the Brain investigate?)',
    placeHolder: 'e.g. Look for duplicated auth logic across services',
  });
  if (!brief?.trim()) {
    return;
  }
  ensureBrainRuntime();
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const result = await eng.ultrathink(brief.trim(), root ? projectIdForRoot(root) : undefined);
  if (result.noAction) {
    void vscode.window.showInformationMessage('Singularity Brain: no significant finding.');
  } else {
    void vscode.window.showInformationMessage(`Singularity Brain: ${result.insightIds.length} insight(s) created.`);
  }
  IntelligenceShellPanel.refreshIfOpen();
}

function brainStatus(): {
  ok: boolean;
  stats: ReturnType<BrainEngine['stats']> | undefined;
  runtime?: BrainRuntimeSnapshot;
  storage: string;
} {
  const eng = ensureBrainEngine();
  const storage = contextRef ? join(contextRef.globalStorageUri.fsPath, 'brain', 'brain.sqlite') : '';
  return { ok: Boolean(eng), stats: eng?.stats(), runtime: eng?.runtimeSnapshot(), storage };
}

function brainContextSnapshot(): { ok: boolean; episodes: number; entities: number; insights: number } {
  const eng = ensureBrainEngine();
  if (!eng) {
    return { ok: false, episodes: 0, entities: 0, insights: 0 };
  }
  const stats = eng.stats();
  return { ok: true, episodes: stats.episodes, entities: stats.entities, insights: eng.store.listInsights(50).length };
}

function observeChat(text: string, sourceRef?: string): void {
  if (!engine) {
    return;
  }
  const cfg = vscode.workspace.getConfiguration('singularity.ai.brain');
  if (cfg.get<boolean>('enabled', true) === false || cfg.get<boolean>('chatLearning', true) === false) {
    return;
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  engine.observeEvent({
    kind: 'chat',
    text,
    sourceRef,
    projectId: root ? projectIdForRoot(root) : undefined,
    workspaceRoot: root,
    ts: Date.now(),
  });
}

function queueFileObservation(uri: string, content: string): void {
  const cfg = vscode.workspace.getConfiguration('singularity.ai.brain');
  if (cfg.get<boolean>('enabled', true) === false || cfg.get<boolean>('fileLearning', true) === false) {
    return;
  }
  if (content.length > 200_000 || !/\.(ts|tsx|js|jsx|mjs|py|go|rs|md|json|yml|yaml|sql|tf|css|scss)$/i.test(uri)) {
    return;
  }
  if (/node_modules|\.singularity|\.git[/\\]|dist[/\\]|\.build[/\\]/.test(uri)) {
    return;
  }
  if (fileTimer) {
    clearTimeout(fileTimer);
  }
  fileTimer = setTimeout(() => {
    const eng = ensureBrainEngine();
    if (!eng) {
      return;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const kind = /\.(css|scss|less)$/i.test(uri) ? 'css_edit' : 'file_save';
    eng.observeEvent({
      kind,
      text: content.slice(0, 8_000),
      sourceRef: uri,
      projectId: root ? projectIdForRoot(root) : undefined,
      workspaceRoot: root,
      ts: Date.now(),
    });
  }, 5_000);
}

export function disposeBrainBridge(): void {
  try {
    engine?.close();
  } catch {
    /* ignore */
  }
  engine = undefined;
  contextRef = undefined;
  bridgeStarted = false;
  progressListeners.clear();
  statusListeners.clear();
  deltaListeners.clear();
}
