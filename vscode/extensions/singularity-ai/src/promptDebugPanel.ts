import * as vscode from 'vscode';
import type { SingularityAI } from '@singularity/router';

/**
 * Level 16 — Prompt Engine debug panel (webview).
 */
export class PromptDebugPanel {
  public static readonly viewType = 'singularity.ai.promptDebug';
  private static current: PromptDebugPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(ai: SingularityAI): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;
    if (PromptDebugPanel.current) {
      PromptDebugPanel.current.panel.reveal(column);
      PromptDebugPanel.current.refresh(ai);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      PromptDebugPanel.viewType,
      'Singularity Prompt Debug',
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    PromptDebugPanel.current = new PromptDebugPanel(panel, ai);
  }

  private constructor(panel: vscode.WebviewPanel, ai: SingularityAI) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        if (msg?.type === 'refresh') {
          this.refresh(ai);
        }
      },
      null,
      this.disposables,
    );
    this.refresh(ai);
  }

  refresh(ai: SingularityAI): void {
    const debug = ai.getPromptDebug();
    const status = ai.status();
    this.panel.webview.html = this.renderHtml(debug, status);
  }

  dispose(): void {
    PromptDebugPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private renderHtml(
    debug: ReturnType<SingularityAI['getPromptDebug']>,
    status: ReturnType<SingularityAI['status']>,
  ): string {
    const esc = (s: unknown) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    if (!debug) {
      return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)">
        <h2>Prompt Engine Debug</h2>
        <p>No Prompt Engine run yet. Use <b>Singularity AI: Complete Prompt</b> first.</p>
        <pre>${esc(JSON.stringify(status, null, 2))}</pre>
        <button onclick="acquireVsCodeApi().postMessage({type:'refresh'})">Refresh</button>
      </body></html>`;
    }

    const irBlocks = debug.ir.blocks
      .map(
        (b) =>
          `<tr><td>${esc(b.role)}</td><td>${esc(b.estimatedTokens ?? b.tokenCount)}</td><td><code>${esc(b.hash.slice(0, 12))}</code></td><td><pre style="max-height:120px;overflow:auto;white-space:pre-wrap">${esc(b.text.slice(0, 800))}</pre></td></tr>`,
      )
      .join('');

    const retrieved = debug.retrieved
      .slice(0, 40)
      .map(
        (r) =>
          `<tr><td>${esc(r.score.toFixed(3))}</td><td>${esc(r.reason)}</td><td><code>${esc(r.nodeId)}</code></td></tr>`,
      )
      .join('');

    const messages = debug.rendered.messages
      .map(
        (m) =>
          `<div style="margin:8px 0;padding:8px;border-left:3px solid var(--vscode-focusBorder)"><b>${esc(m.role)}</b><pre style="white-space:pre-wrap">${esc(m.content.slice(0, 2000))}</pre></div>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
  h2,h3 { margin-top: 1.2em; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  td, th { border: 1px solid var(--vscode-panel-border); padding: 4px 6px; vertical-align: top; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(140px,1fr)); gap: 8px; }
  .card { padding: 10px; background: var(--vscode-editorWidget-background); border-radius: 4px; }
  .muted { opacity: 0.7; font-size: 12px; }
  button { margin: 8px 0; padding: 6px 12px; }
</style>
</head>
<body>
  <h2>Singularity Prompt Engine Debug</h2>
  <button id="refresh">Refresh</button>
  <div class="grid">
    <div class="card"><div class="muted">IR hash</div><code>${esc(debug.ir.irHash.slice(0, 16))}</code></div>
    <div class="card"><div class="muted">Tokens</div>${esc(debug.ir.totalTokens)} / ${esc(debug.ir.budgetTokens)}</div>
    <div class="card"><div class="muted">Intent</div>${esc(debug.ir.intent)}</div>
    <div class="card"><div class="muted">Provider</div>${esc(debug.rendered.provider)}</div>
    <div class="card"><div class="muted">Complexity</div>${esc(debug.route.complexity)}</div>
    <div class="card"><div class="muted">Cache</div>hits ${esc(debug.cacheStats.hits)} / misses ${esc(debug.cacheStats.misses)}</div>
    <div class="card"><div class="muted">Repo hash</div><code>${esc(debug.repoHash.slice(0, 12))}</code></div>
    <div class="card"><div class="muted">Working set</div>${esc(debug.workingSetNodeIds.length)} nodes</div>
    <div class="card"><div class="muted">Quality / confidence</div>${esc((debug as { estimatedAnswerConfidence?: number }).estimatedAnswerConfidence?.toFixed?.(2) ?? '—')} · regen ${esc((debug as { estimatedRegenerationProbability?: number }).estimatedRegenerationProbability?.toFixed?.(2) ?? '—')}</div>
    <div class="card"><div class="muted">Learning</div>${esc(JSON.stringify((debug as { learningStats?: unknown }).learningStats ?? {}))}</div>
    <div class="card"><div class="muted">Simulation</div>${esc((debug as { simulation?: { passed?: boolean; predictedSuccess?: number } }).simulation ? `${(debug as { simulation: { passed: boolean; predictedSuccess: number } }).simulation.passed ? 'pass' : 'fail'} · success ${(debug as { simulation: { predictedSuccess: number } }).simulation.predictedSuccess.toFixed(2)}` : '—')}</div>
  </div>

  <h3>Retrieved nodes</h3>
  <table><thead><tr><th>Score</th><th>Reason</th><th>Node</th></tr></thead><tbody>${retrieved}</tbody></table>

  <h3>Prompt IR blocks</h3>
  <table><thead><tr><th>Role</th><th>Tokens</th><th>Hash</th><th>Text</th></tr></thead><tbody>${irBlocks}</tbody></table>

  <h3>Rendered prompt</h3>
  ${messages}

  <h3>Routing metadata</h3>
  <pre>${esc(JSON.stringify(debug.route, null, 2))}</pre>

  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
  </script>
</body>
</html>`;
  }
}
