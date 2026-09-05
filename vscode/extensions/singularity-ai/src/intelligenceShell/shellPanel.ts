/**
 * Intelligence Shell host — unified webview for Context / Brain / Memory /
 * Architecture / Tasks. Preserves bridge contracts; thin UI adapters only.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { RuntimeEvent } from '@singularity/runtime';
import {
  architectureNeighborsForUi,
  getArchitectureSubsystem,
  listArchitectureForUi,
} from '../architectureBridge.js';
import { getActiveContextEngine, getContextEngineFlagsFromConfig } from '../contextEngineBridge.js';
import { intelligenceStatus } from '../intelligenceBridge.js';
import {
  listMemoriesForUi,
  removeMemoryForUi,
  searchMemoriesForUi,
} from '../memoryBridge.js';
import {
  isShellRoute,
  type ContextPayload,
  type ShellClientMessage,
  type ShellHostMessage,
  type ShellRoute,
  type TaskViewPayload,
  type TasksPayload,
  type SearchResult,
} from './protocol.js';

const STATE_KEY = 'singularity.intelligenceShell.route';

interface TaskState {
  id: string;
  title: string;
  role?: string;
  objective?: string;
  deps: string[];
  ownedPaths: string[];
  status: string;
  model?: string;
  toolsUsed: string[];
  error?: string;
  deltaText?: string;
}

export interface ShellPanelDeps {
  getBrainEngine: () => import('@singularity/brain').BrainEngine | undefined;
  onBrainSync: () => void;
  extensionPath: string;
}

export class IntelligenceShellPanel {
  public static readonly viewType = 'singularity.ai.intelligenceShell';
  private static current: IntelligenceShellPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private route: ShellRoute = 'context';
  private readonly tasks = new Map<string, TaskState>();
  private selectedTaskId: string | undefined;
  private taskSummary = '';
  private context: vscode.ExtensionContext | undefined;
  private webviewReady = false;
  private readonly pendingMessages: ShellHostMessage[] = [];

  static show(
    context: vscode.ExtensionContext,
    deps: ShellPanelDeps,
    route?: ShellRoute,
  ): IntelligenceShellPanel {
    const nextRoute = route ?? readStoredRoute(context) ?? 'context';
    if (IntelligenceShellPanel.current) {
      IntelligenceShellPanel.current.reveal(nextRoute);
      return IntelligenceShellPanel.current;
    }
    return new IntelligenceShellPanel(context, deps, nextRoute);
  }

  static getActive(): IntelligenceShellPanel | undefined {
    return IntelligenceShellPanel.current;
  }

  static refreshIfOpen(): void {
    const panel = IntelligenceShellPanel.current;
    if (!panel) {
      return;
    }
    void panel.refreshRoute(panel.route);
  }

  static postActivity(label: string, progress?: number): void {
    IntelligenceShellPanel.current?.post({
      type: 'activity',
      label,
      progress,
    });
  }

  static postBootStatus(label: string, progress?: number): void {
    IntelligenceShellPanel.current?.post({
      type: 'boot',
      label,
      progress,
    });
  }

  static postBrainForward(message: Record<string, unknown>): void {
    IntelligenceShellPanel.current?.post({ type: 'brainForward', message });
  }

  static openRoute(context: vscode.ExtensionContext, deps: ShellPanelDeps, route: ShellRoute): void {
    IntelligenceShellPanel.show(context, deps, route);
  }

  /** Feed runtime events (same contract as RuntimeExecutionPanel). */
  static handleRuntimeEvent(ev: RuntimeEvent): void {
    IntelligenceShellPanel.current?.ingestRuntimeEvent(ev);
  }

  private constructor(
    context: vscode.ExtensionContext,
    private readonly deps: ShellPanelDeps,
    initialRoute: ShellRoute,
  ) {
    this.context = context;
    this.route = initialRoute;
    IntelligenceShellPanel.current = this;

    const extUri = vscode.Uri.file(deps.extensionPath);
    this.panel = vscode.window.createWebviewPanel(
      IntelligenceShellPanel.viewType,
      'Singularity Intelligence',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extUri, 'dist'), vscode.Uri.joinPath(extUri, 'src', 'ui')],
      },
    );

    this.disposables.push(
      this.panel,
      this.panel.webview.onDidReceiveMessage((msg: ShellClientMessage) => void this.handle(msg)),
      this.panel.onDidDispose(() => this.dispose()),
    );

    this.renderHtml();
    void this.persistRoute();
    this.post({ type: 'boot', label: 'Starting Intelligence Shell…', progress: 0.08 });
  }

  reveal(route?: ShellRoute): void {
    if (route && route !== this.route) {
      this.route = route;
      void this.persistRoute();
      this.post({ type: 'navigate', route });
    }
    this.panel.reveal(vscode.ViewColumn.One);
  }

  dispose(): void {
    if (IntelligenceShellPanel.current === this) {
      IntelligenceShellPanel.current = undefined;
    }
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private async persistRoute(): Promise<void> {
    await this.context?.globalState.update(STATE_KEY, this.route);
  }

  private post(msg: ShellHostMessage): void {
    if (!this.webviewReady && msg.type !== 'init' && msg.type !== 'boot') {
      this.pendingMessages.push(msg);
      return;
    }
    void this.panel.webview.postMessage(msg);
  }

  private flushPendingMessages(): void {
    this.webviewReady = true;
    const queued = this.pendingMessages.splice(0);
    for (const msg of queued) {
      void this.panel.webview.postMessage(msg);
    }
  }

  private theme(): 'dark' | 'light' {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight
      ? 'light'
      : 'dark';
  }

  private projectMeta(): { projectName: string; branch: string } {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const projectName = folder?.name ?? 'workspace';
    return { projectName, branch: '' };
  }

  private async handle(msg: ShellClientMessage | Record<string, unknown>): Promise<void> {
    const raw = msg as Record<string, unknown>;
    const type = String(raw.type ?? '');

    // Brain Sigma viewer messages (same webview)
    if (
      type === 'ready' ||
      type === 'refresh' ||
      type === 'sync' ||
      type === 'detail' ||
      type === 'expand' ||
      type === 'search' ||
      type === 'insights' ||
      type === 'activity' ||
      type === 'insightFeedback' ||
      type === 'ultrathink'
    ) {
      await this.handleBrainMessage(raw);
      return;
    }

    const client = msg as ShellClientMessage;

    switch (client.type) {
      case 'ready': {
        this.post({ type: 'boot', label: 'Connecting to Singularity…', progress: 0.18 });
        const meta = this.projectMeta();
        this.post({
          type: 'init',
          route: this.route,
          theme: this.theme(),
          projectName: meta.projectName,
          branch: meta.branch,
          brainScript: this.panel.webview
            .asWebviewUri(vscode.Uri.joinPath(vscode.Uri.file(this.deps.extensionPath), 'dist', 'brain', 'viewer.js'))
            .toString(),
        });
        this.flushPendingMessages();
        break;
      }
      case 'navigate':
        if (isShellRoute(client.route)) {
          this.route = client.route;
          await this.persistRoute();
          this.post({ type: 'navigate', route: this.route });
        }
        break;
      case 'refresh':
        await this.refreshRoute(client.route ?? this.route);
        break;
      case 'search':
        await this.runSearch(client.query);
        break;
      case 'openFile':
        await openWorkspaceFile(client.path);
        break;
      case 'memoryRemove':
        if (await removeMemoryForUi(client.id)) {
          this.post({ type: 'toast', message: 'Memory removed' });
          await this.refreshRoute('memory');
        }
        break;
      case 'memoryDetail':
        break;
      case 'adrReview':
        getArchitectureSubsystem()?.review(client.id, client.action);
        this.post({ type: 'toast', message: client.action === 'accept' ? 'ADR accepted' : 'ADR rejected' });
        await this.refreshRoute('architecture');
        break;
      case 'contextOverride': {
        const engine = getActiveContextEngine();
        engine?.override(client.kind as never, client.content, { category: client.category });
        await this.refreshRoute('context');
        break;
      }
      case 'contextRemove':
        getActiveContextEngine()?.remove(client.id, 'archive');
        await this.refreshRoute('context');
        break;
      case 'contextExtract':
        await getActiveContextEngine()?.ingestMessage(client.text, { type: 'user_override' }, { force: true });
        await this.refreshRoute('context');
        break;
      case 'taskSelect':
        this.selectedTaskId = client.id;
        this.postTasks();
        break;
      case 'taskClear':
        this.tasks.clear();
        this.selectedTaskId = undefined;
        this.taskSummary = '';
        this.postTasks();
        break;
      case 'brainMessage':
        await this.handleBrainMessage(client.message);
        break;
      case 'archSelect': {
        const snap = listArchitectureForUi();
        const node = snap.nodes.find((n) => n.id === client.id);
        const neighbors = architectureNeighborsForUi(client.id, 1);
        this.post({
          type: 'architectureData',
          payload: {
            ...snap,
            selected: node
              ? {
                  id: node.id,
                  label: node.label,
                  kind: node.kind,
                  neighbors: neighbors.map((n) => ({
                    id: n.id,
                    title: n.title,
                    subtitle: n.subtitle,
                  })),
                }
              : undefined,
          },
        });
        break;
      }
      case 'archNeighbors': {
        const neighbors = architectureNeighborsForUi(client.id, client.depth ?? 1);
        const snap = listArchitectureForUi();
        const node = snap.nodes.find((n) => n.id === client.id);
        this.post({
          type: 'architectureData',
          payload: {
            ...snap,
            selected: node
              ? {
                  id: node.id,
                  label: node.label,
                  kind: node.kind,
                  neighbors: neighbors.map((n) => ({
                    id: n.id,
                    title: n.title,
                    subtitle: n.subtitle,
                  })),
                }
              : undefined,
          },
        });
        break;
      }
    }
  }

  private async refreshRoute(route: ShellRoute): Promise<void> {
    this.post({ type: 'activity', label: activityForRoute(route), progress: 0.35 });
    switch (route) {
      case 'context':
        this.post({ type: 'contextData', payload: await buildContextPayload() });
        break;
      case 'memory':
        await this.postMemory();
        break;
      case 'architecture':
        this.post({ type: 'architectureData', payload: listArchitectureForUi() });
        break;
      case 'tasks':
        this.postTasks();
        break;
      case 'brain':
        await this.handleBrainMessage({ type: 'ready' });
        break;
    }
    this.post({ type: 'activity', label: '', progress: undefined });
  }

  private async postMemory(): Promise<void> {
    const items = await listMemoriesForUi(120);
    const cats: Array<MemoryUiCategoryCount> = [
      { id: 'decisions', label: 'Decisions', count: 0 },
      { id: 'preferences', label: 'Preferences', count: 0 },
      { id: 'architecture', label: 'Architecture', count: 0 },
      { id: 'lessons', label: 'Lessons', count: 0 },
      { id: 'context', label: 'Context', count: 0 },
    ];
    for (const it of items) {
      const row = cats.find((c) => c.id === it.category);
      if (row) {
        row.count += 1;
      }
    }
    this.post({ type: 'memoryData', payload: { items, categories: cats } });
  }

  private postTasks(): void {
    const payload: TasksPayload = {
      tasks: [...this.tasks.values()].map(toTaskView),
      selectedId: this.selectedTaskId,
      summary: this.taskSummary || undefined,
      activityLabel: [...this.tasks.values()].some((t) => t.status === 'running')
        ? 'Agents running'
        : undefined,
    };
    this.post({ type: 'tasksData', payload });
    if (payload.activityLabel) {
      this.post({ type: 'activity', label: payload.activityLabel, progress: 0.6 });
    }
  }

  ingestRuntimeEvent(ev: RuntimeEvent): void {
    if (ev.kind === 'plan_created' && ev.data?.tasks) {
      const tasks = ev.data.tasks as Array<Record<string, unknown>>;
      for (const t of tasks) {
        const id = String(t.id);
        this.tasks.set(id, {
          id,
          title: String(t.title ?? t.objective ?? id),
          role: t.role ? String(t.role) : undefined,
          objective: t.objective ? String(t.objective) : undefined,
          deps: Array.isArray(t.deps) ? t.deps.map(String) : [],
          ownedPaths: Array.isArray(t.ownedPaths) ? t.ownedPaths.map(String) : [],
          status: String(t.status ?? 'queued'),
          toolsUsed: [],
        });
      }
      this.postTasks();
      this.post({ type: 'activity', label: 'Planning complete', progress: 0.2 });
      return;
    }

    const id = ev.taskId;
    if (!id) {
      if (ev.kind === 'run_done' || ev.kind === 'run_failed') {
        this.taskSummary = ev.message;
        this.postTasks();
        this.post({
          type: 'activity',
          label: ev.kind === 'run_done' ? 'Run complete' : 'Run failed',
          progress: 1,
        });
      }
      return;
    }

    const existing =
      this.tasks.get(id) ??
      ({
        id,
        title: id,
        deps: [],
        ownedPaths: [],
        status: 'running',
        toolsUsed: [],
      } satisfies TaskState);

    if (ev.kind === 'subagent_progress_delta') {
      existing.deltaText = String(ev.message ?? existing.deltaText ?? '');
      existing.status = 'running';
    } else if (ev.kind === 'subagent_started') {
      existing.status = 'running';
    } else if (ev.kind === 'subagent_completed') {
      existing.status = 'complete';
    } else if (ev.kind === 'subagent_failed') {
      existing.status = 'failed';
      existing.error = ev.message;
    } else if (ev.message) {
      existing.deltaText = ev.message;
    }

    this.tasks.set(id, existing);
    this.postTasks();
  }

  private async handleBrainMessage(message: Record<string, unknown>): Promise<void> {
    const engine = this.deps.getBrainEngine();
    const type = String(message.type ?? '');
    switch (type) {
      case 'ready':
      case 'refresh': {
        if (!engine) {
          this.post({
            type: 'toast',
            message: 'Brain engine not ready',
          });
          return;
        }
        const types = engine.typeRegistry();
        this.post({ type: 'brainForward', message: { type: 'init', types } });
        try {
          const view = engine.getGraphView(800);
          this.post({ type: 'brainForward', message: { type: 'graph', view, merge: false } });
          this.post({
            type: 'brainForward',
            message: { type: 'runtimeStatus', snap: engine.runtimeSnapshot() },
          });
          this.post({
            type: 'activity',
            label: `${view.nodes.length} entities`,
            progress: 1,
          });
        } catch {
          this.post({ type: 'toast', message: 'Failed to load brain graph' });
        }
        break;
      }
      case 'sync':
        this.deps.onBrainSync();
        this.post({ type: 'activity', label: 'Syncing brain…', progress: 0.4 });
        break;
      case 'ultrathink':
        void vscode.commands.executeCommand('singularity.brain.ultrathink');
        break;
      case 'insightFeedback':
        if (engine && message.id && message.status) {
          void vscode.commands.executeCommand('singularity.ai.brain.insightFeedback', {
            id: message.id,
            status: message.status,
          });
        }
        break;
      case 'insights':
        if (engine) {
          this.post({
            type: 'brainForward',
            message: {
              type: 'insights',
              insights: engine.store.listInsights(40).map((i) => ({
                id: i.id,
                title: i.title,
                kind: i.kind,
                confidence: i.confidence,
                status: i.status,
                observation: i.observation,
                improvement: i.improvement,
                createdAt: i.createdAt,
              })),
            },
          });
        }
        break;
      case 'activity':
        if (engine) {
          this.post({
            type: 'brainForward',
            message: {
              type: 'activity',
              events: engine.store.recentActivity(40).map((e) => ({
                id: e.id,
                ts: e.ts,
                kind: e.kind,
                message: e.message,
              })),
            },
          });
        }
        break;
      case 'detail':
        if (engine && message.id) {
          const detail = engine.getEntityDetail(String(message.id));
          this.post({ type: 'brainForward', message: { type: 'detail', detail } });
        }
        break;
      case 'expand':
        if (engine && message.id) {
          const view = engine.getNeighborhood(String(message.id), Number(message.depth ?? 1));
          this.post({ type: 'brainForward', message: { type: 'graph', view, merge: true } });
        }
        break;
      case 'search':
        if (engine && message.query) {
          const results = await engine.search(String(message.query), { limit: 10 });
          this.post({
            type: 'brainForward',
            message: {
              type: 'searchResults',
              query: message.query,
              hits: results.map((r) => ({
                id: r.entity.id,
                label: r.entity.label,
                type: r.entity.type,
                score: Number(r.score.toFixed(3)),
              })),
            },
          });
        }
        break;
      default:
        break;
    }
  }

  private async runSearch(query: string): Promise<void> {
    const results: SearchResult[] = [];
    const q = query.trim();
    if (q.length < 2) {
      this.post({ type: 'searchResults', query: q, results: [] });
      return;
    }

    const mems = await searchMemoriesForUi(q, 8);
    for (const m of mems) {
      results.push({
        id: m.id,
        title: m.title,
        kind: 'memory',
        subtitle: m.category,
        why: m.evidence ?? `Confidence ${Math.round(m.confidence * 100)}%`,
        route: 'memory',
      });
    }

    const arch = listArchitectureForUi();
    const lq = q.toLowerCase();
    for (const n of arch.nodes) {
      if (n.label.toLowerCase().includes(lq) || n.id.toLowerCase().includes(lq)) {
        results.push({
          id: n.id,
          title: n.label,
          kind: 'architecture',
          subtitle: n.kind,
          why: 'Matched architecture node',
          route: 'architecture',
        });
      }
    }
    for (const a of arch.adrs) {
      if (a.title.toLowerCase().includes(lq)) {
        results.push({
          id: a.id,
          title: a.title,
          kind: 'decision',
          subtitle: a.status,
          why: a.summary ?? 'Architecture decision',
          route: 'architecture',
        });
      }
    }

    for (const t of this.tasks.values()) {
      if (t.title.toLowerCase().includes(lq) || t.id.toLowerCase().includes(lq)) {
        results.push({
          id: t.id,
          title: t.title,
          kind: 'task',
          subtitle: t.status,
          why: t.objective,
          route: 'tasks',
        });
      }
    }

    const engine = getActiveContextEngine();
    if (engine) {
      try {
        const state = engine.getState();
        for (const f of [...(state.technologies ?? [])].slice(0, 40)) {
          const text = `${(f as { name?: string }).name ?? ''}`.toLowerCase();
          if (text.includes(lq)) {
            results.push({
              id: (f as { id: string }).id,
              title: (f as { name: string }).name,
              kind: 'file',
              subtitle: 'technology',
              why: 'Project context',
              route: 'context',
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    this.post({ type: 'searchResults', query: q, results: results.slice(0, 40) });
  }

  private renderHtml(): void {
    const nonce = Math.random().toString(36).slice(2);
    const ext = vscode.Uri.file(this.deps.extensionPath);
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(ext, 'dist', 'intelligenceShell', 'shellApp.js'),
    );
    const tokens = this.readCss('tokens.css');
    const primitives = this.readCss('primitives.css');
    const shell = this.readCss('shell.css');
    const csp = [
      `default-src 'none'`,
      `img-src ${this.panel.webview.cspSource} data:`,
      `style-src 'unsafe-inline'`,
      `script-src ${this.panel.webview.cspSource} 'nonce-${nonce}'`,
    ].join('; ');

    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>${tokens}\n${primitives}\n${shell}
html,body,#app{height:100%;margin:0;overflow:hidden}
</style>
</head>
<body>
<div id="app" class="singularity-ui sg-shell sg-booting">
  <div class="sg-boot-overlay" role="status" aria-live="polite">
    <div class="sg-boot-spinner" aria-hidden="true"></div>
    <p class="sg-boot-label" id="boot-label">Starting Intelligence Shell…</p>
    <div class="sg-progress sg-boot-progress"><span id="boot-progress" style="width:8%"></span></div>
  </div>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private readCss(name: string): string {
    try {
      return readFileSync(join(this.deps.extensionPath, 'src', 'ui', name), 'utf8');
    } catch {
      try {
        return readFileSync(join(this.deps.extensionPath, 'dist', 'ui', name), 'utf8');
      } catch {
        return '';
      }
    }
  }
}

type MemoryUiCategoryCount = {
  id: 'decisions' | 'preferences' | 'architecture' | 'lessons' | 'context';
  label: string;
  count: number;
};

function readStoredRoute(context: vscode.ExtensionContext): ShellRoute | undefined {
  const v = context.globalState.get<string>(STATE_KEY);
  return isShellRoute(v) ? v : undefined;
}

function activityForRoute(route: ShellRoute): string {
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

async function buildContextPayload(): Promise<ContextPayload> {
  const empty: ContextPayload = {
    files: [],
    architecture: [],
    decisions: [],
    memories: [],
    tasks: [],
    changes: [],
    dependencies: [],
    evidence: [],
  };
  const flags = getContextEngineFlagsFromConfig();
  if (!flags.context_engine_enabled) {
    return {
      ...empty,
      statusLine: 'Context engine disabled — enable singularity.ai.contextEngine.enabled',
    };
  }
  const engine = getActiveContextEngine();
  if (!engine) {
    return { ...empty, statusLine: 'Open a workspace folder to load project context.' };
  }

  try {
    const state = engine.getState();
    const active = <T extends { status: string }>(arr: T[]) =>
      arr.filter((x) => x.status === 'active' || x.status === 'proposed');

    const files = active((state.technologies ?? []) as Array<{
      id: string;
      name: string;
      category?: string;
      confidence?: number;
      source_type?: string;
      status: string;
    }>).map((t) => ({
      id: t.id,
      title: t.name,
      subtitle: t.category,
      confidence: t.confidence,
      kind: 'technology',
      meta: t.source_type,
    }));

    const decisions = active((state.architecture_decisions ?? []) as Array<{
      id: string;
      decision: string;
      confidence?: number;
      status: string;
    }>).map((d) => ({
      id: d.id,
      title: d.decision,
      confidence: d.confidence,
      kind: 'decision',
      meta: d.status,
    }));

    const architecture = listArchitectureForUi().nodes.slice(0, 24).map((n) => ({
      id: n.id,
      title: n.label,
      subtitle: n.kind,
      kind: n.kind,
      confidence: 0.7,
    }));

    const memories = (await listMemoriesForUi(12)).map((m) => ({
      id: m.id,
      title: m.title,
      subtitle: m.category,
      confidence: m.confidence,
      kind: 'memory',
    }));

    let statusLine = '';
    try {
      const st = intelligenceStatus();
      statusLine = typeof st === 'string' ? st : JSON.stringify(st).slice(0, 120);
    } catch {
      statusLine = `Context items loaded`;
    }

    return {
      files,
      architecture,
      decisions,
      memories,
      tasks: [],
      changes: [],
      dependencies: active((state.constraints ?? []) as Array<{
        id: string;
        constraint: string;
        strength?: string;
        confidence?: number;
        status: string;
      }>).map((c) => ({
        id: c.id,
        title: c.constraint,
        subtitle: c.strength,
        confidence: c.confidence,
      })),
      evidence: active((state.requirements ?? []) as Array<{
        id: string;
        description: string;
        type?: string;
        confidence?: number;
        status: string;
      }>).map((r) => ({
        id: r.id,
        title: r.description,
        subtitle: r.type,
        confidence: r.confidence,
      })),
      statusLine,
    };
  } catch {
    return { ...empty, statusLine: 'Failed to read context state.' };
  }
}

function toTaskView(t: TaskState): TaskViewPayload {
  const status = t.status.toLowerCase();
  const progress =
    status === 'complete' || status === 'succeeded' || status === 'done'
      ? 1
      : status === 'failed'
        ? 1
        : status === 'running'
          ? 0.55
          : 0.15;

  const steps: TaskViewPayload['steps'] = [
    {
      id: 'queued',
      title: 'Queued',
      status: status === 'queued' ? 'running' : 'complete',
    },
    {
      id: 'running',
      title: t.role ? `Execute (${t.role})` : 'Execute',
      status:
        status === 'running'
          ? 'running'
          : status === 'complete' || status === 'succeeded' || status === 'done'
            ? 'complete'
            : status === 'failed'
              ? 'failed'
              : 'pending',
    },
    {
      id: 'verify',
      title: 'Verify',
      status:
        status === 'complete' || status === 'succeeded' || status === 'done' ? 'complete' : 'pending',
    },
  ];

  return {
    id: t.id,
    title: t.title,
    status: t.status,
    progress,
    role: t.role,
    objective: t.objective,
    model: t.model,
    steps,
    ownedPaths: t.ownedPaths,
    error: t.error,
    deltaText: t.deltaText,
  };
}

async function openWorkspaceFile(path: string): Promise<void> {
  try {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const uri = path.startsWith('/') || /^[A-Za-z]:/.test(path)
      ? vscode.Uri.file(path)
      : vscode.Uri.joinPath(folder?.uri ?? vscode.Uri.file('.'), path);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch {
    void vscode.window.showWarningMessage(`Could not open ${path}`);
  }
}
