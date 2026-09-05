import * as vscode from 'vscode';
import { join } from 'node:path';
import {
  getActiveWikiEngine,
  getWikiEngineFlagsFromConfig,
  ingestIntoWiki,
  initWiki,
  lintWiki,
  queryWiki,
} from './wikiBridge.js';

/**
 * LLM Wiki webview — browse index, ingest, query, lint.
 */
export class WikiPanel {
  public static readonly viewType = 'singularity.ai.llmWiki';
  private static current: WikiPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private lastQuery = '';
  private lastQueryDraft = '';
  private lastLint = '';

  static show(): void {
    const column =
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.Beside;
    if (WikiPanel.current) {
      WikiPanel.current.panel.reveal(column);
      WikiPanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      WikiPanel.viewType,
      'LLM Wiki',
      column,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    WikiPanel.current = new WikiPanel(panel);
  }

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (msg) => {
        if (msg?.type === 'refresh') {
          this.refresh();
          return;
        }
        if (msg?.type === 'init') {
          initWiki();
          this.refresh();
          return;
        }
        if (msg?.type === 'open' && msg.relPath) {
          await openWikiPage(String(msg.relPath));
          return;
        }
        if (msg?.type === 'ingestText' && msg.text) {
          ingestIntoWiki({
            text: String(msg.text),
            title: msg.title ? String(msg.title) : undefined,
          });
          this.refresh();
          return;
        }
        if (msg?.type === 'ingestActive') {
          const editor = vscode.window.activeTextEditor;
          if (!editor) {
            void vscode.window.showWarningMessage('No active editor to ingest.');
            return;
          }
          ingestIntoWiki({
            sourcePath: editor.document.uri.fsPath,
            title: editor.document.fileName.split(/[\\/]/).pop(),
          });
          this.refresh();
          return;
        }
        if (msg?.type === 'query' && msg.question) {
          const result = queryWiki(String(msg.question), {
            fileAnswer: Boolean(msg.fileAnswer),
          });
          this.lastQuery = String(msg.question);
          this.lastQueryDraft = result?.draft ?? 'No result.';
          this.refresh();
          return;
        }
        if (msg?.type === 'lint') {
          const wiki = getActiveWikiEngine();
          const result = lintWiki();
          this.lastLint = result && wiki ? wiki.formatLint(result) : 'No lint result.';
          this.refresh();
        }
      },
      null,
      this.disposables,
    );
    this.refresh();
  }

  refresh(): void {
    const flags = getWikiEngineFlagsFromConfig();
    const wiki = getActiveWikiEngine();
    this.panel.webview.html = this.renderHtml(flags, wiki);
  }

  dispose(): void {
    WikiPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private renderHtml(
    flags: ReturnType<typeof getWikiEngineFlagsFromConfig>,
    wiki: ReturnType<typeof getActiveWikiEngine>,
  ): string {
    const esc = (s: unknown) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    if (!flags.wiki_enabled) {
      return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)">
        <h2>LLM Wiki</h2>
        <p>Wiki is disabled. Enable <code>singularity.ai.wiki.enabled</code> or set <code>SINGULARITY_WIKI=true</code>.</p>
      </body></html>`;
    }
    if (!wiki) {
      return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)">
        <h2>LLM Wiki</h2>
        <p>Open a workspace folder to load the wiki.</p>
      </body></html>`;
    }

    const status = wiki.status();
    if (!status.initialized) {
      return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground);max-width:720px">
        <h2>LLM Wiki</h2>
        <p>Persistent compounding knowledge base (Karpathy pattern). The agent maintains markdown pages; you curate sources and ask questions.</p>
        <p style="opacity:.8">Root <code>${esc(status.wikiRoot)}</code></p>
        <button id="init">Initialize wiki</button>
        <script>
          const vscode = acquireVsCodeApi();
          document.getElementById('init')?.addEventListener('click', () => vscode.postMessage({type:'init'}));
        </script>
      </body></html>`;
    }

    const pages = wiki.listPages().filter(
      (p) => p.relPath !== 'index.md' && p.relPath !== 'log.md',
    );
    const log = wiki.readLog(8);
    const cats = Object.entries(status.categories)
      .map(([k, v]) => `${esc(k)} <strong>${esc(v)}</strong>`)
      .join(' · ');

    const pageList = pages
      .map(
        (p) => `<div style="margin:6px 0">
          <a href="#" data-open="${esc(p.relPath)}">[[${esc(p.frontmatter.title)}]]</a>
          <span style="opacity:.7;font-size:12px"> ${esc(p.frontmatter.category)} · ${esc(p.relPath)}</span>
          <div style="opacity:.75;font-size:12px">${esc(p.frontmatter.summary || '')}</div>
        </div>`,
      )
      .join('');

    const logItems = log.entries
      .slice()
      .reverse()
      .map(
        (e) => `<div style="margin:8px 0;padding-bottom:8px;border-bottom:1px solid var(--vscode-widget-border)">
          <strong>[${esc(e.date)}] ${esc(e.op)}</strong> · ${esc(e.title)}
          <div style="opacity:.8;font-size:12px;white-space:pre-wrap">${esc(e.detail)}</div>
        </div>`,
      )
      .join('');

    return `<!DOCTYPE html><html><body style="font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground);max-width:820px">
      <h2>LLM Wiki</h2>
      <p style="opacity:.8">${esc(status.pageCount)} pages · ${esc(status.sourceCount)} sources · updated ${esc(status.lastUpdated)} · <code>${esc(status.wikiRoot)}</code></p>
      <div style="opacity:.85;margin:8px 0">${cats || 'No categories yet'}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">
        <button id="refresh">Refresh</button>
        <button id="lint">Lint</button>
        <button id="ingestActive">Ingest active file</button>
        <button id="openIndex" data-open="index.md">Open index.md</button>
        <button id="openLog" data-open="log.md">Open log.md</button>
        <button id="openSchema">Open SCHEMA.md</button>
      </div>
      <div style="margin:16px 0;padding:12px;background:var(--vscode-editor-inactiveSelectionBackground)">
        <label>Ingest text</label><br/>
        <input id="ingestTitle" style="width:40%;margin:6px 8px 6px 0" placeholder="Title (optional)" />
        <textarea id="ingestText" style="width:100%;height:72px;margin-top:6px" placeholder="Paste an article, notes, or transcript…"></textarea>
        <button id="ingestBtn" style="margin-top:8px">Ingest</button>
      </div>
      <div style="margin:16px 0;padding:12px;background:var(--vscode-editor-inactiveSelectionBackground)">
        <label>Query wiki</label><br/>
        <input id="queryText" style="width:70%;margin-top:6px" placeholder="What do we know about…?" value="${esc(this.lastQuery)}" />
        <label style="margin-left:8px;font-size:12px"><input type="checkbox" id="fileAnswer" /> file answer</label>
        <button id="queryBtn">Query</button>
        ${this.lastQueryDraft ? `<pre style="white-space:pre-wrap;font-size:12px;margin-top:10px">${esc(this.lastQueryDraft)}</pre>` : ''}
      </div>
      ${this.lastLint ? `<h3>Lint</h3><pre style="white-space:pre-wrap;font-size:12px">${esc(this.lastLint)}</pre>` : ''}
      <h3>Recent log</h3>
      ${logItems || '<p style="opacity:.7">No entries yet</p>'}
      <h3>Pages</h3>
      ${pageList || '<p style="opacity:.7">None yet — ingest a source</p>'}
      <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('refresh')?.addEventListener('click', () => vscode.postMessage({type:'refresh'}));
        document.getElementById('lint')?.addEventListener('click', () => vscode.postMessage({type:'lint'}));
        document.getElementById('ingestActive')?.addEventListener('click', () => vscode.postMessage({type:'ingestActive'}));
        document.getElementById('ingestBtn')?.addEventListener('click', () => {
          const text = document.getElementById('ingestText')?.value;
          const title = document.getElementById('ingestTitle')?.value;
          if (text) vscode.postMessage({type:'ingestText', text, title});
        });
        document.getElementById('queryBtn')?.addEventListener('click', () => {
          const question = document.getElementById('queryText')?.value;
          const fileAnswer = document.getElementById('fileAnswer')?.checked;
          if (question) vscode.postMessage({type:'query', question, fileAnswer});
        });
        document.querySelectorAll('[data-open]').forEach((el) => {
          el.addEventListener('click', (e) => {
            e.preventDefault();
            vscode.postMessage({type:'open', relPath: el.getAttribute('data-open')});
          });
        });
        document.getElementById('openSchema')?.addEventListener('click', () => vscode.postMessage({type:'open', relPath:'../SCHEMA.md'}));
      </script>
    </body></html>`;
  }
}

async function openWikiPage(relPath: string): Promise<void> {
  const wiki = getActiveWikiEngine();
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!wiki || !folder) {
    return;
  }
  const abs =
    relPath === '../SCHEMA.md'
      ? wiki.store.paths.schema
      : relPath === 'index.md'
        ? wiki.store.paths.index
        : relPath === 'log.md'
          ? wiki.store.paths.log
          : join(wiki.store.paths.pages, ...String(relPath).split('/'));
  const uri = vscode.Uri.file(abs);
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: false });
  } catch {
    void vscode.window.showWarningMessage(`Could not open wiki page ${relPath}`);
  }
}
