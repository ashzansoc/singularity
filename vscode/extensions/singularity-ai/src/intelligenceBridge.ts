/**
 * Project Intelligence — thin extension-host bridge.
 *
 * Two lanes:
 * 1. **Passive capture** — file edits, saves, active editor, plane events always
 *    flow to the background worker. The graph stays current as the user works.
 * 2. **LLM retrieval** — `intelligenceContext()` / `includeIntelligence` only when
 *    an agent explicitly needs symbol/context search. Chat never triggers indexing.
 *
 * All heavy indexing runs in `dist/intelligenceWorker`.
 */

import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  formatContextBlock,
  type ContextResponse,
  type ProjectStatusResponse,
  type IntelligenceClient,
} from '@singularity/intelligence';
import {
  ensureIntelligenceWorker,
  getIntelligenceClient,
  getIntelligenceBaseUrl,
} from './intelligenceWorkerProcess.js';
import { singularityLog } from './singularityLog.js';
import { RemoteIntelligenceEngine } from './intelligenceRemoteEngine.js';

let engine: RemoteIntelligenceEngine | undefined;
let workspaceRoot: string | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let statusTimer: ReturnType<typeof setInterval> | undefined;
let activeFileTimer: ReturnType<typeof setTimeout> | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
/** True once we chose the out-of-process worker (even while it is still starting). */
let workerMode = false;
let passiveSeedStarted = false;

export function isIntelligenceRemoteMode(): boolean {
  return workerMode;
}

export function getIntelligenceEngine(): RemoteIntelligenceEngine | undefined {
  return engine;
}

export function getIntelligencePort(): number | undefined {
  const baseUrl = getIntelligenceBaseUrl();
  if (!baseUrl) {
    return undefined;
  }
  const m = /:(\d+)$/.exec(baseUrl.replace(/\/$/, ''));
  return m ? Number(m[1]) : undefined;
}

export function startIntelligenceDaemon(
  context: vscode.ExtensionContext,
): RemoteIntelligenceEngine | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  const enabled = vscode.workspace
    .getConfiguration('singularity.ai')
    .get<boolean>('intelligence.enabled', true);
  if (!enabled) {
    return undefined;
  }

  extensionContext = context;
  workspaceRoot = folder.uri.fsPath;
  workerMode = true;

  void ensureIntelligenceWorker(context, workspaceRoot).then((client) => {
    if (!client) {
      return;
    }
    engine = new RemoteIntelligenceEngine(workspaceRoot!, client);
    singularityLog('[singularity-ai] Intelligence worker attached (passive capture on)');
    startPassiveReferenceIndex(client);
  });

  statusItem = vscode.window.createStatusBarItem(
    'singularity.ai.intelligence',
    vscode.StatusBarAlignment.Right,
    990,
  );
  statusItem.name = 'Project Intelligence';
  statusItem.command = 'singularity.ai.intelligence.open';
  statusItem.text = '$(database) Intel —';
  statusItem.tooltip = 'Project Intelligence (background worker)';
  statusItem.show();

  statusTimer = setInterval(() => {
    void refreshIntelligenceStatusBar();
  }, 12_000);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed?.document.uri.scheme === 'file') {
        queueActiveFileCapture(ed.document);
      }
    }),
    { dispose: () => disposeIntelligenceDaemon() },
  );

  const active = vscode.window.activeTextEditor?.document;
  if (active?.uri.scheme === 'file') {
    queueActiveFileCapture(active);
  }

  return engine;
}

/** Background seed — recent git files become the always-on reference index. */
function startPassiveReferenceIndex(client: IntelligenceClient): void {
  if (passiveSeedStarted) {
    return;
  }
  passiveSeedStarted = true;
  void client.bootstrap('recent').then((files) => {
    if (files > 0) {
      singularityLog(`[singularity-ai] Passive reference index: ${files} recent files queued`);
    }
  });
}

/** Explicit on-demand index (Intelligence Shell, manual commands). */
export async function requestIntelligenceIndex(
  scope: 'recent' | 'full' = 'recent',
): Promise<number> {
  const client = await ensureWorker();
  if (!client) {
    return 0;
  }
  const autoFull = vscode.workspace
    .getConfiguration('singularity.ai')
    .get<boolean>('intelligence.autoIndex', false);
  const effectiveScope = !autoFull && scope === 'full' ? 'recent' : scope;
  return client.bootstrap(effectiveScope);
}

async function ensureWorker() {
  if (!extensionContext || !workspaceRoot) {
    return undefined;
  }
  const client = await ensureIntelligenceWorker(extensionContext, workspaceRoot);
  if (client && !engine) {
    engine = new RemoteIntelligenceEngine(workspaceRoot, client);
    startPassiveReferenceIndex(client);
  }
  return client;
}

function withClient(run: (client: IntelligenceClient) => void): void {
  const client = getIntelligenceClient();
  if (client) {
    run(client);
    return;
  }
  void ensureWorker().then((c) => {
    if (c) {
      run(c);
    }
  });
}

export function disposeIntelligenceDaemon(): void {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = undefined;
  }
  if (activeFileTimer) {
    clearTimeout(activeFileTimer);
    activeFileTimer = undefined;
  }
  statusItem?.dispose();
  statusItem = undefined;
  engine = undefined;
  workspaceRoot = undefined;
  extensionContext = undefined;
  workerMode = false;
  passiveSeedStarted = false;
}

/** Passive capture — always store file changes in the worker index. */
export function notifyIntelligenceFile(
  kind: 'FILE_CREATED' | 'FILE_MODIFIED' | 'FILE_DELETED',
  doc: vscode.TextDocument,
): void {
  if (doc.uri.scheme !== 'file') {
    return;
  }
  captureFileEvent(kind, doc.uri.toString(), kind === 'FILE_DELETED' ? [] : importRefs(doc.getText(), doc.uri), doc);
}

/** Passive capture for deletes (no open document). */
export function notifyIntelligenceUriDeleted(uri: vscode.Uri): void {
  if (uri.scheme !== 'file') {
    return;
  }
  captureFileEvent('FILE_DELETED', uri.toString(), [], undefined, [uri.fsPath]);
}

function captureFileEvent(
  kind: 'FILE_CREATED' | 'FILE_MODIFIED' | 'FILE_DELETED',
  uri: string,
  refs: string[],
  doc?: vscode.TextDocument,
  changedFiles?: string[],
): void {
  withClient((client) => {
    void client.notifyFile(kind, uri, refs);
  });
  engine?.notifyFileEvent(kind, uri, refs);
  postCodingPlaneFileEvent(kind, doc, changedFiles);
}

function postCodingPlaneFileEvent(
  kind: 'FILE_CREATED' | 'FILE_MODIFIED' | 'FILE_DELETED',
  doc?: vscode.TextDocument,
  changedFiles?: string[],
): void {
  if (!workerMode || !workspaceRoot) {
    return;
  }
  const payload = {
    event_type: kind,
    project_id: workspaceRoot,
    changed_files: changedFiles ?? (doc ? [doc.uri.fsPath] : undefined),
    text: doc && kind !== 'FILE_DELETED' ? doc.getText().slice(0, 2_000) : undefined,
  };
  withClient((client) => {
    void client.postCodingEvent(payload);
  });
}

/**
 * LLM retrieval lane — read indexed context for a task.
 * Never triggers bootstrap; passive capture keeps the index current.
 */
export async function intelligenceContext(task: string): Promise<{
  prompt_block: string;
  intelligence?: ContextResponse;
}> {
  if (!task.trim()) {
    return { prompt_block: '' };
  }
  const client = getIntelligenceClient();
  if (!client) {
    void ensureWorker();
    return { prompt_block: '' };
  }
  const res = await client.context(task);
  if (!res) {
    return { prompt_block: '' };
  }
  return { prompt_block: formatContextBlock(res), intelligence: res };
}

export function intelligenceStatus(): ProjectStatusResponse | undefined {
  return engine?.status();
}

async function refreshIntelligenceStatusBar(): Promise<void> {
  if (!statusItem || !engine) {
    return;
  }
  const s = await engine.refreshStatus();
  statusItem.text = `$(database) Intel ${s.percent}%`;
  const lines = s.stages.map(
    (st) => `${st.name} ${st.status === 'complete' ? '✓' : st.status} ${Math.round(st.progress * 100)}%`,
  );
  statusItem.tooltip = ['Project Intelligence (background worker)', ...lines, `queue ${s.jobQueueDepth}`].join('\n');
}

function queueActiveFileCapture(doc: vscode.TextDocument): void {
  if (activeFileTimer) {
    clearTimeout(activeFileTimer);
  }
  activeFileTimer = setTimeout(() => {
    activeFileTimer = undefined;
    const refs = importRefs(doc.getText(), doc.uri);
    const uri = doc.uri.toString();
    withClient((client) => {
      void client.notifyFile('FILE_MODIFIED', uri, refs);
    });
    engine?.bumpActiveFile(uri, refs);
    void enrichActiveFileWithLsp(uri);
  }, 1_500);
}

function importRefs(text: string, from: vscode.Uri): string[] {
  const refs: string[] = [];
  const re = /from\s+['"](\.[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const spec = m[1];
    if (!spec) {
      continue;
    }
    const base = vscode.Uri.joinPath(from, '..', spec);
    for (const ext of ['', '.ts', '.tsx', '.js', '.jsx']) {
      refs.push(base.toString() + ext);
    }
  }
  return refs.slice(0, 20);
}

async function enrichActiveFileWithLsp(uriStr: string): Promise<void> {
  const uri = vscode.Uri.parse(uriStr);
  const relations: Array<{
    fromUri: string;
    toUri: string;
    kind: 'references' | 'defined_in';
    fromName?: string;
    toName?: string;
  }> = [];

  try {
    const symbols = (await vscode.commands.executeCommand(
      'vscode.executeDocumentSymbolProvider',
      uri,
    )) as vscode.DocumentSymbol[] | undefined;
    for (const sym of (symbols ?? []).slice(0, 8)) {
      const pos = sym.selectionRange?.start ?? sym.range.start;
      try {
        const refs = (await vscode.commands.executeCommand(
          'vscode.executeReferenceProvider',
          uri,
          pos,
        )) as vscode.Location[] | undefined;
        for (const loc of refs ?? []) {
          if (loc.uri.toString() === uriStr) {
            continue;
          }
          relations.push({
            fromUri: loc.uri.toString(),
            toUri: uriStr,
            kind: 'references',
            toName: sym.name,
          });
        }
      } catch {
        /* language server may not be ready */
      }
    }
  } catch {
    /* ignore */
  }

  if (relations.length) {
    withClient((client) => {
      void client.applyLsp(relations);
    });
    engine?.applyLsp(relations);
  }
}

export function intelligenceDbHint(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    return '';
  }
  return join(folder, '.singularity', 'intelligence', 'graph.sqlite');
}
