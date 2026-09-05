import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  buildDesignBoardHtml,
  DEFAULT_PENPOT_URL,
  loadDesignPreviewGate,
  markDesignPreviewStatus,
  parseDesignSpecJson,
  type DesignSpecification,
} from '@singularity/design';
import type { PenpotManager } from './penpotManager.js';

/**
 * Welcome / walkthrough editors should only appear on fresh windows.
 * Close them when Design Canvas takes over the editor area.
 */
export async function dismissWelcomeEditors(): Promise<void> {
  const tabsToClose: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (isWelcomeOrWalkthroughTab(tab)) {
        tabsToClose.push(tab);
      }
    }
  }
  if (tabsToClose.length > 0) {
    await vscode.window.tabGroups.close(tabsToClose, true);
  }
}

function isWelcomeOrWalkthroughTab(tab: vscode.Tab): boolean {
  const label = tab.label?.trim() ?? '';
  if (label === 'Welcome' || label === 'Getting Started') {
    return true;
  }
  if (label.startsWith('Walkthrough:')) {
    return true;
  }
  // GettingStartedInput is UnknownInput in the tabs API — match walkThrough URI if present.
  const input = tab.input as { uri?: vscode.Uri } | unknown;
  if (input && typeof input === 'object' && 'uri' in input && input.uri instanceof vscode.Uri) {
    const uri = input.uri;
    if (uri.scheme === 'walkThrough' && uri.authority === 'vscode_getting_started_page') {
      return true;
    }
  }
  return false;
}

/**
 * Design Canvas — opens Spec frames directly in Singularity (no login / onboarding).
 */
export class DesignPreviewPanel {
  public static readonly viewType = 'singularity.ai.designPreview';
  private static current: DesignPreviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private workspaceRoot: string;
  private penpot: PenpotManager;

  static async show(
    penpot: PenpotManager,
    options: { workspaceRoot?: string; startPenpot?: boolean } = {},
  ): Promise<DesignPreviewPanel | undefined> {
    const root =
      options.workspaceRoot ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      void vscode.window.showWarningMessage('Open a workspace to open the Design Canvas.');
      return undefined;
    }

    // Welcome only belongs on new windows — clear it so Canvas owns the editor area.
    await dismissWelcomeEditors();

    // Prefer the primary editor group (replaces Welcome) instead of splitting Beside it.
    const column = vscode.ViewColumn.One;
    if (DesignPreviewPanel.current) {
      DesignPreviewPanel.current.workspaceRoot = root;
      DesignPreviewPanel.current.penpot = penpot;
      DesignPreviewPanel.current.panel.reveal(column);
      await DesignPreviewPanel.current.refresh();
      return DesignPreviewPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      DesignPreviewPanel.viewType,
      'Design Canvas',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableForms: true,
      },
    );
    DesignPreviewPanel.current = new DesignPreviewPanel(panel, penpot, root);
    await DesignPreviewPanel.current.refresh();
    return DesignPreviewPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel, penpot: PenpotManager, workspaceRoot: string) {
    this.panel = panel;
    this.penpot = penpot;
    this.workspaceRoot = workspaceRoot;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => void this.onMessage(msg),
      null,
      this.disposables,
    );
  }

  dispose(): void {
    DesignPreviewPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  async refresh(): Promise<void> {
    const spec = this.loadSpec();
    if (!spec) {
      this.panel.webview.html = `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)">
        <h2>Design Canvas</h2>
        <p>No <code>.singularity/design-spec.json</code> yet. Ask Singularity to build a product UI first.</p>
      </body></html>`;
      return;
    }

    const gate = loadDesignPreviewGate(this.workspaceRoot);
    markDesignPreviewStatus(this.workspaceRoot, 'awaiting_final', {
      productName: spec.product.name,
      penpotUrl: this.penpot.url || DEFAULT_PENPOT_URL,
      notes: gate?.notes,
    });

    this.panel.title = `Design Canvas — ${spec.product.name}`;
    this.panel.webview.html = buildDesignBoardHtml(spec, {
      notes: gate?.notes,
    });
  }

  private loadSpec(): DesignSpecification | undefined {
    const file = join(this.workspaceRoot, '.singularity', 'design-spec.json');
    if (!existsSync(file)) {
      return undefined;
    }
    try {
      return parseDesignSpecJson(readFileSync(file, 'utf8'));
    } catch {
      return undefined;
    }
  }

  private async onMessage(msg: { type?: string; notes?: string }): Promise<void> {
    if (!msg?.type) {
      return;
    }
    if (msg.type === 'saveNotes') {
      markDesignPreviewStatus(this.workspaceRoot, 'awaiting_final', {
        notes: msg.notes ?? '',
        penpotUrl: this.penpot.url || DEFAULT_PENPOT_URL,
      });
      void vscode.window.showInformationMessage('Design notes saved.');
      return;
    }
    if (msg.type === 'finalDesign') {
      markDesignPreviewStatus(this.workspaceRoot, 'approved', {
        notes: msg.notes ?? '',
        penpotUrl: this.penpot.url || DEFAULT_PENPOT_URL,
      });
      void vscode.window.showInformationMessage(
        'Final Design locked. Singularity will implement from the Design Spec.',
      );
      this.panel.webview.postMessage({ type: 'status', text: 'Final Design ✓ — coding unlocked' });
      return;
    }
    if (msg.type === 'skipDesign') {
      markDesignPreviewStatus(this.workspaceRoot, 'skipped', {
        notes: msg.notes ?? '',
        penpotUrl: this.penpot.url || DEFAULT_PENPOT_URL,
      });
      void vscode.window.showInformationMessage('Design canvas skipped — coding unlocked.');
      this.panel.webview.postMessage({ type: 'status', text: 'Skipped — coding unlocked' });
    }
  }
}
