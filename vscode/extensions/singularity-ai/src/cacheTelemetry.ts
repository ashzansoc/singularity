/**
 * Status-bar controller for DeepSeek provider cache vs Neural Relay context hits.
 * Does not change model routing.
 */

import * as vscode from 'vscode';
import {
  applyDeepSeekUsage,
  applyNeuralRelayResult,
  emptyCacheStatusSnapshot,
  formatDeepSeekCacheBar,
  formatDeepSeekCacheTooltip,
  formatNeuralRelayBar,
  formatNeuralRelayTooltip,
  formatRequestTelemetryDebug,
  formatSavedBar,
  NeuralRelayStore,
  setPhase,
  type CacheStatusSnapshot,
  type RelayPrepareResult,
  type RequestPhase,
} from '@singularity/neural-relay';

let snapshot: CacheStatusSnapshot = emptyCacheStatusSnapshot();
let store: NeuralRelayStore | undefined;
let deepseekItem: vscode.StatusBarItem | undefined;
let relayItem: vscode.StatusBarItem | undefined;
let savedItem: vscode.StatusBarItem | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let currentRequestId: string | undefined;
let debugChannel: vscode.OutputChannel | undefined;

function workspaceStore(): NeuralRelayStore | undefined {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    return undefined;
  }
  if (!store || store.dir.indexOf(root) < 0) {
    store = new NeuralRelayStore(root);
    snapshot = store.readTelemetry();
  }
  return store;
}

function persist(): void {
  try {
    workspaceStore()?.writeTelemetry(snapshot);
  } catch {
    /* ignore disk errors */
  }
}

function live(): boolean {
  return snapshot.phase !== 'Idle';
}

export function getCacheStatusSnapshot(): CacheStatusSnapshot {
  return snapshot;
}

export function getActiveRequestId(): string {
  if (!currentRequestId) {
    currentRequestId = `req-${Date.now().toString(36)}`;
  }
  return currentRequestId;
}

export function beginRequest(requestId?: string): string {
  currentRequestId = requestId ?? `req-${Date.now().toString(36)}`;
  snapshot = setPhase(snapshot, 'Idle', undefined, currentRequestId);
  return currentRequestId;
}

export function setRequestPhase(phase: RequestPhase, liveLabel?: string): void {
  if (idleTimer && phase !== 'Complete' && phase !== 'Error' && phase !== 'Idle') {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  }
  snapshot = setPhase(snapshot, phase, liveLabel, getActiveRequestId());
  refreshCacheStatusBar();
  if (phase === 'Complete' || phase === 'Error') {
    scheduleIdle();
  }
}

function scheduleIdle(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    snapshot = setPhase(snapshot, 'Idle', undefined, currentRequestId);
    refreshCacheStatusBar();
  }, 4_000);
}

export function recordDeepSeekProviderUsage(opts: {
  modelId?: string;
  promptTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheReported: boolean;
}): void {
  snapshot = applyDeepSeekUsage(snapshot, {
    requestId: getActiveRequestId(),
    ...opts,
  });
  persist();
  refreshCacheStatusBar();
  if (
    snapshot.phase !== 'Verifying' &&
    snapshot.phase !== 'Expanding Context' &&
    snapshot.phase !== 'Resolving Context' &&
    snapshot.phase !== 'Building Context'
  ) {
    scheduleIdle();
  }
}

export function recordNeuralRelayExpansion(prepared: RelayPrepareResult): void {
  const exp = prepared.experiment;
  snapshot = applyNeuralRelayResult(snapshot, {
    requestId: getActiveRequestId(),
    enabled: prepared.enabled,
    mode: prepared.mode,
    usedRelay: prepared.usedRelay,
    fallbackReason: prepared.fallbackReason,
    candidateFiles: exp.tokens.files_considered,
    selectedFiles: exp.tokens.files_used_by_deepseek || exp.tokens.files_selected,
    contextTokensBefore: exp.original_context_tokens,
    contextTokensAfter: exp.context_tokens_sent_to_deepseek,
    contextReduction: exp.context_reduction,
    model: exp.context_model,
    tokensPerSecond: exp.performance.nemotron_tokens_per_second,
    nemotronTokens: exp.nemotron_tokens,
    testsPassed: exp.quality.tests_passed,
    retryCount: exp.retry_count,
    expansionCount: exp.context_expansions,
    estimatedCost: exp.relay_cost,
    baselineCost: exp.baseline_cost,
    countAsRequest: false,
  });
  persist();
  refreshCacheStatusBar();
}

export function recordNeuralRelayPrepare(prepared: RelayPrepareResult): void {
  const exp = prepared.experiment;
  snapshot = applyNeuralRelayResult(snapshot, {
    requestId: getActiveRequestId(),
    enabled: prepared.enabled,
    mode: prepared.mode,
    usedRelay: prepared.usedRelay,
    fallbackReason: prepared.fallbackReason,
    candidateFiles: exp.tokens.files_considered,
    selectedFiles: exp.tokens.files_used_by_deepseek || exp.tokens.files_selected,
    contextTokensBefore: exp.original_context_tokens,
    contextTokensAfter: exp.context_tokens_sent_to_deepseek,
    contextReduction: exp.context_reduction,
    model: exp.context_model,
    tokensPerSecond: exp.performance.nemotron_tokens_per_second,
    nemotronTokens: exp.nemotron_tokens,
    testsPassed: exp.quality.tests_passed,
    retryCount: exp.retry_count,
    expansionCount: exp.context_expansions,
    estimatedCost: exp.relay_cost,
    baselineCost: exp.baseline_cost,
    countAsRequest: true,
  });
  persist();
  refreshCacheStatusBar();
}

export function showCacheTelemetryDebug(): void {
  if (!debugChannel) {
    debugChannel = vscode.window.createOutputChannel('Singularity Request Telemetry');
  }
  debugChannel.clear();
  debugChannel.appendLine(formatRequestTelemetryDebug(snapshot));
  debugChannel.show(true);
}

export function refreshCacheStatusBar(): void {
  if (!deepseekItem || !relayItem || !savedItem) {
    return;
  }
  const isLive = live();
  if (!isLive && snapshot.phase === 'Idle') {
    deepseekItem.hide();
    relayItem.hide();
    savedItem.hide();
    return;
  }
  deepseekItem.text = formatDeepSeekCacheBar(snapshot, isLive);
  deepseekItem.tooltip = formatDeepSeekCacheTooltip(snapshot);
  deepseekItem.backgroundColor = undefined;
  deepseekItem.show();

  relayItem.text = formatNeuralRelayBar(snapshot, isLive);
  relayItem.tooltip = formatNeuralRelayTooltip(snapshot);
  relayItem.backgroundColor =
    snapshot.phase === 'Fallback'
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
  relayItem.show();

  const saved = formatSavedBar(snapshot);
  if (saved && !isLive) {
    savedItem.text = saved;
    savedItem.tooltip = [
      'DeepSeek context avoided by Neural Relay',
      `${snapshot.neuralRelay.tokensAvoided.toLocaleString()} tokens vs baseline context path`,
      'This is not DeepSeek provider cache.',
    ].join('\n');
    savedItem.show();
  } else {
    savedItem.hide();
  }
  void vscode.commands.executeCommand('singularity.ai.chatFooter.notify');
}

export function resetCacheStatus(): void {
  snapshot = emptyCacheStatusSnapshot();
  currentRequestId = undefined;
  persist();
  refreshCacheStatusBar();
}

export function registerCacheStatusBar(context: vscode.ExtensionContext): void {
  workspaceStore();
  deepseekItem = vscode.window.createStatusBarItem(
    'singularity.ai.deepseekCache',
    vscode.StatusBarAlignment.Right,
    1004,
  );
  deepseekItem.name = 'DeepSeek Provider Cache';
  deepseekItem.command = 'singularity.ai.cacheTelemetry';

  relayItem = vscode.window.createStatusBarItem(
    'singularity.ai.neuralRelay',
    vscode.StatusBarAlignment.Right,
    1003,
  );
  relayItem.name = 'Neural Relay';
  relayItem.command = 'singularity.ai.cacheTelemetry';

  savedItem = vscode.window.createStatusBarItem(
    'singularity.ai.contextSaved',
    vscode.StatusBarAlignment.Right,
    1002,
  );
  savedItem.name = 'Neural Relay tokens avoided';
  savedItem.command = 'singularity.ai.cacheTelemetry';

  context.subscriptions.push(deepseekItem, relayItem, savedItem, {
    dispose: () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      debugChannel?.dispose();
    },
  });
  refreshCacheStatusBar();
}
