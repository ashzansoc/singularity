/**
 * Compact Neural Relay + token usage labels for the chat input footer.
 */

import * as vscode from 'vscode';
import {
  averageContextReduction,
  formatNeuralRelayTooltip,
  formatRatePercent,
  formatSavedBar,
} from '@singularity/neural-relay';
import { getCacheStatusSnapshot } from './cacheTelemetry.js';
import { formatTokenCount, formatUsageTooltip, type ProjectTokenUsage } from './tokenUsage.js';

export interface ChatFooterTelemetrySnapshot {
  readonly show: boolean;
  readonly relayLabel: string;
  readonly relayTooltip: string;
  readonly tokensLabel: string;
  readonly tokensTooltip: string;
}

type FooterListener = () => void;
const footerListeners = new Set<FooterListener>();

export function notifyChatFooterTelemetryChanged(): void {
  for (const listener of footerListeners) {
    listener();
  }
}

function formatRelayFooterLabel(): string {
  const snap = getCacheStatusSnapshot();
  const reduction = averageContextReduction(snap);
  if (typeof reduction === 'number' && Number.isFinite(reduction) && reduction > 0) {
    return `$(arrow-down) ${formatRatePercent(reduction)} relay`;
  }
  const saved = formatSavedBar(snap);
  if (saved) {
    return saved.replace(' ctx', ' ctx saved');
  }
  const lastReduction = snap.last?.neuralRelay.contextReduction;
  if (typeof lastReduction === 'number' && lastReduction > 0) {
    const rate = lastReduction > 1 ? lastReduction / 100 : lastReduction;
    return `$(arrow-down) ${formatRatePercent(rate)} relay`;
  }
  if (snap.neuralRelay.requests > 0) {
    return `$(circle-outline) Neural Relay`;
  }
  return `$(circle-outline) Neural Relay —`;
}

function formatTokensFooterLabel(usage: ProjectTokenUsage): string {
  const total = usage.inputTokens + usage.cachedInputTokens + usage.outputTokens;
  if (total <= 0) {
    return `$(symbol-numeric) 0 tokens`;
  }
  return `$(symbol-numeric) ${formatTokenCount(total)} tokens`;
}

export function buildChatFooterTelemetry(
  usage: ProjectTokenUsage,
  workspaceLabel: string,
): ChatFooterTelemetrySnapshot {
  const relayLabel = formatRelayFooterLabel();
  const tokensLabel = formatTokensFooterLabel(usage);
  const snap = getCacheStatusSnapshot();
  const show = true;

  return {
    show,
    relayLabel,
    relayTooltip: formatNeuralRelayTooltip(snap),
    tokensLabel,
    tokensTooltip: formatUsageTooltip(usage, workspaceLabel),
  };
}

export function registerChatFooterTelemetry(
  context: vscode.ExtensionContext,
  getUsage: () => ProjectTokenUsage,
): void {
  const getSnapshot = (): ChatFooterTelemetrySnapshot => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.name ?? 'this project';
    return buildChatFooterTelemetry(getUsage(), folder);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('singularity.ai.getChatFooterTelemetry', () => getSnapshot()),
    vscode.commands.registerCommand('singularity.ai.chatFooter.relay', () => {
      void vscode.commands.executeCommand('singularity.ai.cacheTelemetry');
    }),
    vscode.commands.registerCommand('singularity.ai.chatFooter.tokens', () => {
      void vscode.commands.executeCommand('singularity.ai.status');
    }),
    {
      dispose: () => footerListeners.clear(),
    },
  );

  const bump = () => notifyChatFooterTelemetryChanged();
  context.subscriptions.push(
    vscode.commands.registerCommand('singularity.ai.chatFooter.notify', bump),
  );
}

export function onChatFooterTelemetryChanged(listener: FooterListener): vscode.Disposable {
  footerListeners.add(listener);
  return new vscode.Disposable(() => footerListeners.delete(listener));
}
