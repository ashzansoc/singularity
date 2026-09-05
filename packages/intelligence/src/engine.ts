/**
 * Intelligence engine — Tree-sitter indexing, priority queue, staged bootstrap.
 * Fast reads never wait on workers.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  DefaultIncrementalIndexer,
  InMemoryContextGraph,
  defaultExtractors,
  pickExtractor,
  isTreeSitterReady,
  type FileChangeEvent,
} from '@singularity/prompt';
import {
  fileIdFromUri,
  isCodeFile,
  isDocFile,
  languageFromPath,
  sha256,
  shouldIgnorePath,
} from './hash.js';
import { JobQueue } from './queue.js';
import { formatContextBlock, impactForSymbol, retrieveContext } from './retriever.js';
import { applyLspRelations, ingestScipFile } from './scip.js';
import { openGraphStore, type SqliteGraphStore } from './sqliteGraphStore.js';
import type {
  ArchitectureResponse,
  ContextResponse,
  GraphStore,
  ImpactResponse,
  IntelligenceJob,
  JobKind,
  JobPriorityName,
  LiveSourceProvider,
  ProjectStatusResponse,
  StageName,
  SymbolHit,
} from './types.js';
import { JOB_PRIORITY } from './types.js';

const PUMP_KINDS: JobKind[] = [
  'INDEX_FILE',
  'INDEX_DOC',
  'SCIP_INGEST',
  'SUMMARY',
  'BOOTSTRAP_TREE',
];

export interface IntelligenceEngineOptions {
  workspaceRoot: string;
  dbPath?: string;
  store?: GraphStore;
  live?: LiveSourceProvider;
  onDocument?: (uri: string, text: string) => void | Promise<void>;
  maxFiles?: number;
}

const STAGE_NAMES: StageName[] = [
  'tree',
  'ast',
  'scip',
  'docs',
  'embeddings',
  'architecture',
];

export class IntelligenceEngine {
  readonly workspaceRoot: string;
  readonly store: GraphStore;
  readonly queue = new JobQueue();
  readonly sqlite?: SqliteGraphStore;
  private readonly indexer: DefaultIncrementalIndexer;
  private readonly hot = new InMemoryContextGraph();
  private readonly live?: LiveSourceProvider;
  private readonly onDocument?: IntelligenceEngineOptions['onDocument'];
  private readonly maxFiles: number;
  private pumpPromise: Promise<void> | undefined;
  private stopped = false;
  private gitCommit?: string;
  private branch?: string;
  private fileList: string[] = [];

  constructor(options: IntelligenceEngineOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.maxFiles = options.maxFiles ?? 8_000;
    this.live = options.live;
    this.onDocument = options.onDocument;
    if (options.store) {
      this.store = options.store;
    } else {
      const dbPath =
        options.dbPath ?? join(options.workspaceRoot, '.singularity', 'intelligence', 'graph.sqlite');
      this.sqlite = openGraphStore(dbPath);
      this.store = this.sqlite;
    }
    this.indexer = new DefaultIncrementalIndexer({
      graph: this.hot,
      repositoryId: `repo:${this.workspaceRoot}`,
    });
    for (const name of STAGE_NAMES) {
      if (!this.store.getStage(name)) {
        this.store.setStage({
          name,
          status: 'pending',
          progress: 0,
          updatedAt: Date.now(),
        });
      }
    }
  }

  async ensureParser(): Promise<boolean> {
    try {
      return await Promise.race([
        this.indexer.ensureReady(),
        new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(false), 8_000);
          t.unref();
        }),
      ]);
    } catch {
      return false;
    }
  }

  /**
   * Stage 1 — file tree + git metadata. Does not parse AST.
   * Enqueues Stage 2 jobs with priority. Yields to the event loop so extension
   * activation and chat are not blocked on large workspaces.
   */
  async bootstrapAsync(): Promise<{ files: number }> {
    this.readGit();
    this.fileList = await this.discoverFilesAsync();
    this.prepareBootstrapStages();
    await this.enqueueBootstrapJobsAsync();
    return { files: this.fileList.length };
  }

  /**
   * Index only recent git files (+ optional paths). Used when context is
   * requested — never walks the full repo tree on startup.
   */
  async bootstrapRecent(extraAbsPaths: string[] = []): Promise<{ files: number }> {
    this.readGit();
    const paths = [
      ...new Set([
        ...this.recentGitFiles(),
        ...extraAbsPaths.filter((p) => p.startsWith(this.workspaceRoot)),
      ]),
    ].filter((abs) => {
      try {
        return existsSync(abs) && statSync(abs).isFile();
      } catch {
        return false;
      }
    });
    this.fileList = paths.slice(0, 500);
    this.prepareBootstrapStages();
    await this.enqueueBootstrapJobsAsync(80);
    return { files: this.fileList.length };
  }

  /**
   * Synchronous bootstrap for CLI/tests. Prefer {@link bootstrapAsync} in the
   * VS Code extension host.
   */
  bootstrap(): { files: number } {
    this.readGit();
    this.fileList = this.discoverFiles();
    this.prepareBootstrapStages();
    this.enqueueBootstrapJobsSync();
    return { files: this.fileList.length };
  }

  private prepareBootstrapStages(): void {
    this.store.setMeta('workspace', this.workspaceRoot);
    if (this.gitCommit) {
      this.store.setMeta('git_commit', this.gitCommit);
    }
    if (this.branch) {
      this.store.setMeta('branch', this.branch);
    }
    this.store.setStage({
      name: 'tree',
      status: 'complete',
      progress: 1,
      updatedAt: Date.now(),
      detail: `${this.fileList.length} files`,
    });
    this.store.setStage({
      name: 'ast',
      status: 'processing',
      progress: 0,
      updatedAt: Date.now(),
    });
  }

  private enqueueBootstrapJobsSync(): void {
    const recentSet = new Set(this.recentGitFiles());
    for (const abs of this.fileList) {
      this.enqueueBootstrapFile(abs, recentSet);
    }
    this.enqueueScipIfPresent();
    void this.pump();
  }

  private async enqueueBootstrapJobsAsync(yieldEvery = 400): Promise<void> {
    const recentSet = new Set(this.recentGitFiles());
    for (let i = 0; i < this.fileList.length; i++) {
      this.enqueueBootstrapFile(this.fileList[i]!, recentSet);
      if (i > 0 && i % yieldEvery === 0) {
        await yieldToEventLoop();
      }
    }
    this.enqueueScipIfPresent();
    void this.pump();
  }

  private enqueueBootstrapFile(abs: string, recentSet: Set<string>): void {
    const uri = pathToUri(abs);
    if (isDocFile(abs) && !isCodeFile(abs)) {
      this.queue.enqueue('INDEX_DOC', { uri, priority: JOB_PRIORITY.rest });
      return;
    }
    if (!isCodeFile(abs)) {
      return;
    }
    let pri: JobPriorityName = 'rest';
    if (recentSet.has(abs)) {
      pri = 'recent_git';
    }
    this.queue.enqueue('INDEX_FILE', {
      uri,
      priority: JOB_PRIORITY[pri],
      payload: { path: abs },
    });
  }

  private enqueueScipIfPresent(): void {
    const scipPath = join(this.workspaceRoot, 'index.scip.json');
    const scipAlt = join(this.workspaceRoot, '.scip.json');
    if (existsSync(scipPath) || existsSync(scipAlt)) {
      this.queue.enqueue('SCIP_INGEST', {
        uri: pathToUri(existsSync(scipPath) ? scipPath : scipAlt),
        priority: JOB_PRIORITY.recent_git,
      });
    }
  }

  private async discoverFilesAsync(yieldEvery = 250): Promise<string[]> {
    const out: string[] = [];
    const stack = [this.workspaceRoot];
    let scanned = 0;
    while (stack.length > 0) {
      const dir = stack.pop()!;
      if (out.length >= this.maxFiles) {
        break;
      }
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        const abs = join(dir, name);
        if (shouldIgnorePath(abs)) {
          continue;
        }
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        scanned += 1;
        if (scanned % yieldEvery === 0) {
          await yieldToEventLoop();
        }
        if (st.isDirectory()) {
          stack.push(abs);
        } else if (st.isFile() && (isCodeFile(abs) || isDocFile(abs))) {
          if (st.size > 80_000 || /\.min\.(js|css)$/i.test(abs)) {
            continue;
          }
          out.push(abs);
          if (out.length >= this.maxFiles) {
            return out;
          }
        }
      }
    }
    return out;
  }

  bumpActiveFile(uri: string, referenced: string[] = []): void {
    this.queue.enqueue('INDEX_FILE', { uri, priority: JOB_PRIORITY.active_file });
    this.queue.enqueue('LSP_ENRICH', { uri, priority: JOB_PRIORITY.active_file });
    for (const ref of referenced) {
      this.queue.enqueue('INDEX_FILE', {
        uri: ref,
        priority: JOB_PRIORITY.referenced_by_active,
      });
    }
    void this.pump();
  }

  notifyFileEvent(
    kind: 'FILE_CREATED' | 'FILE_MODIFIED' | 'FILE_DELETED',
    uri: string,
    referenced: string[] = [],
  ): void {
    if (kind === 'FILE_DELETED') {
      this.store.removeFileNeighborhood(fileIdFromUri(uri));
      return;
    }
    this.bumpActiveFile(uri, referenced);
  }

  async indexPathNow(absPath: string, content?: string, priority = JOB_PRIORITY.rest): Promise<void> {
    const uri = pathToUri(absPath);
    const text = content ?? safeRead(absPath);
    if (text == null) {
      return;
    }
    await this.indexUri(uri, text, languageFromPath(absPath), priority);
  }

  getContext(query: string, opts?: { limit?: number; depth?: number }): ContextResponse {
    return retrieveContext(this.store, {
      query,
      limit: opts?.limit,
      depth: opts?.depth,
      live: this.live,
    });
  }

  search(query: string, limit = 24): SymbolHit[] {
    return this.store.findSymbols(query, { limit });
  }

  symbols(query: string, limit = 24): SymbolHit[] {
    return this.search(query, limit);
  }

  impact(symbol: string, depth = 2): ImpactResponse {
    return impactForSymbol(this.store, symbol, depth);
  }

  dependencies(symbol: string, depth = 2): ImpactResponse {
    return this.impact(symbol, depth);
  }

  architecture(): ArchitectureResponse {
    const summaryNode = this.store.listNodes('summary')[0];
    const docs = this.store.listNodes('document').slice(0, 8);
    const adrs = this.store.listNodes('adr').slice(0, 8);
    const constraints: ArchitectureResponse['constraints'] = [];
    for (const n of [...docs, ...adrs]) {
      if (n.content) {
        constraints.push({ text: n.content.slice(0, 400), source: n.label });
      }
    }
    return {
      summary: summaryNode?.content ?? this.store.getMeta('architecture_summary') ?? '',
      constraints,
      technologies: [],
    };
  }

  status(): ProjectStatusResponse {
    const stages = this.store.listStages();
    const percent =
      stages.length === 0
        ? 0
        : Math.round((stages.reduce((s, x) => s + x.progress, 0) / stages.length) * 100);
    return {
      percent,
      stages,
      fileCount: this.store.listNodes('file').length,
      symbolCount: this.store
        .listNodes()
        .filter((n) => n.kind === 'function' || n.kind === 'class' || n.kind === 'method').length,
      jobQueueDepth: this.queue.depth('queued') + this.queue.depth('running'),
    };
  }

  formatContext(query: string): string {
    return formatContextBlock(this.getContext(query));
  }

  applyLsp(
    relations: Array<{
      fromUri: string;
      toUri: string;
      kind: 'calls' | 'references' | 'defined_in' | 'implements' | 'extends';
      fromName?: string;
      toName?: string;
    }>,
  ): number {
    const n = applyLspRelations(this.store, relations);
    const scip = this.store.getStage('scip');
    const progress = Math.min(1, (scip?.progress ?? 0) + 0.05);
    this.store.setStage({
      name: 'scip',
      status: progress >= 1 ? 'complete' : 'processing',
      progress,
      updatedAt: Date.now(),
    });
    return n;
  }

  takeLspJobs(max = 8): IntelligenceJob[] {
    const out: IntelligenceJob[] = [];
    for (let i = 0; i < max; i++) {
      const j = this.queue.dequeue(['LSP_ENRICH']);
      if (!j) {
        break;
      }
      out.push(j);
    }
    return out;
  }

  completeJob(id: string, error?: string): void {
    this.queue.complete(id, error);
  }

  async pump(): Promise<void> {
    if (this.pumpPromise) {
      await this.pumpPromise;
      if (!this.stopped && this.hasPumpWork()) {
        await new Promise<void>((r) => setImmediate(r));
        return this.pump();
      }
      return;
    }
    this.pumpPromise = this.runPumpLoop().finally(() => {
      this.pumpPromise = undefined;
    });
    await this.pumpPromise;
    if (!this.stopped && this.hasPumpWork()) {
      await new Promise<void>((r) => setImmediate(r));
      return this.pump();
    }
  }

  private hasPumpWork(): boolean {
    return this.queue.list('queued').some((j) => PUMP_KINDS.includes(j.kind));
  }

  private async runPumpLoop(): Promise<void> {
    void this.ensureParser();
    let n = 0;
    while (!this.stopped && n < 8) {
      const job = this.queue.dequeue(PUMP_KINDS);
      if (!job) {
        break;
      }
      try {
        await this.runJob(job);
        this.queue.complete(job.id);
      } catch (err) {
        this.queue.complete(job.id, err instanceof Error ? err.message : String(err));
      }
      n++;
      this.refreshAstProgress();
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.sqlite?.close();
  }

  private async runJob(job: IntelligenceJob): Promise<void> {
    if (job.kind === 'INDEX_FILE' && job.uri) {
      const abs = uriToFs(job.uri, this.workspaceRoot);
      const text = safeRead(abs);
      if (text == null) {
        return;
      }
      await this.indexUri(job.uri, text, languageFromPath(abs), job.priority);
      this.queue.enqueue('LSP_ENRICH', {
        uri: job.uri,
        priority: Math.max(JOB_PRIORITY.rest, job.priority - 20),
      });
      return;
    }
    if (job.kind === 'INDEX_DOC' && job.uri) {
      const abs = uriToFs(job.uri, this.workspaceRoot);
      const text = safeRead(abs);
      if (text == null) {
        return;
      }
      const fileId = fileIdFromUri(job.uri);
      const kind = /adr/i.test(abs) ? 'adr' : 'document';
      this.store.upsertNodes([
        InMemoryContextGraph.makeNode({
          id: fileId,
          kind,
          label: abs,
          content: text.slice(0, 12_000),
          hash: sha256(text),
          meta: { uri: job.uri },
        }),
      ]);
      this.store.setFileMeta({
        uri: job.uri,
        fileId,
        contentHash: sha256(text),
        lastIndexedAt: Date.now(),
        gitCommit: this.gitCommit,
        branch: this.branch,
      });
      await this.onDocument?.(job.uri, text);
      const docs = this.store.listNodes('document').length + this.store.listNodes('adr').length;
      this.store.setStage({
        name: 'docs',
        status: 'processing',
        progress: Math.min(0.99, docs / 40),
        updatedAt: Date.now(),
      });
      return;
    }
    if (job.kind === 'SCIP_INGEST' && job.uri) {
      const abs = uriToFs(job.uri, this.workspaceRoot);
      const edges = ingestScipFile(this.store, abs, this.workspaceRoot);
      this.store.setStage({
        name: 'scip',
        status: 'complete',
        progress: 1,
        updatedAt: Date.now(),
        detail: `${edges} edges`,
      });
    }
  }

  private async indexUri(
    uri: string,
    content: string,
    languageId: string | undefined,
    _priority: number,
  ): Promise<void> {
    const hash = sha256(content);
    const prev = this.store.getFileMeta(uri);
    if (prev && prev.contentHash === hash) {
      this.store.markStale(fileIdFromUri(uri), false);
      return;
    }
    const event: FileChangeEvent = {
      uri,
      content,
      version: 1,
      languageId,
    };
    if (isTreeSitterReady()) {
      await this.indexer.indexFile(event);
    } else {
      this.indexWithRegex(event);
    }
    const fileId = fileIdFromUri(uri);
    const snap = this.hot.snapshot();
    const relatedNodes = snap.nodes.filter(
      (n) => n.id === fileId || n.id.startsWith(`${fileId}:`) || n.meta?.uri === uri,
    );
    const ids = new Set(relatedNodes.map((n) => n.id));
    const relatedEdges = snap.edges.filter((e) => ids.has(e.from) || ids.has(e.to));
    this.store.removeFileNeighborhood(fileId);
    this.store.upsertNodes(relatedNodes);
    this.store.upsertEdges(relatedEdges);
    this.store.setFileMeta({
      uri,
      fileId,
      contentHash: hash,
      lastIndexedAt: Date.now(),
      gitCommit: this.gitCommit,
      branch: this.branch,
      languageId,
      stale: false,
    });
  }

  private indexWithRegex(event: FileChangeEvent): void {
    const fileId = InMemoryContextGraph.fileId(event.uri);
    this.hot.removeNode(fileId);
    const fileNode = InMemoryContextGraph.makeNode({
      id: fileId,
      kind: 'file',
      label: event.uri,
      content: event.content,
      hash: sha256(event.content),
      version: event.version,
      meta: { uri: event.uri, languageId: event.languageId },
    });
    this.hot.upsertNode(fileNode);
    const extractor = pickExtractor(defaultExtractors(), event.languageId);
    const extracted = extractor?.extract({
      uri: event.uri,
      content: event.content,
      languageId: event.languageId,
    });
    if (!extracted) {
      return;
    }
    for (const sym of extracted.symbols) {
      const sid = `${fileId}:${sym.kind}:${sym.name}:${sym.startLine ?? 0}`;
      this.hot.upsertNode(
        InMemoryContextGraph.makeNode({
          id: sid,
          kind: sym.kind,
          label: sym.name,
          content: sym.content ?? sym.name,
          meta: {
            uri: event.uri,
            startLine: sym.startLine,
            endLine: sym.endLine,
            parent: fileId,
          },
        }),
      );
      this.hot.addEdge({
        id: `e:${fileId}->${sid}`,
        from: fileId,
        to: sid,
        kind: 'contains',
      });
    }
    for (const call of extracted.calls ?? []) {
      this.hot.addEdge({
        id: `e:call:${fileId}:${call.from}->${call.to}`,
        from: `${fileId}:function:${call.from}:0`,
        to: `${fileId}:function:${call.to}:0`,
        kind: 'calls',
        weight: 1,
      });
    }
  }

  private refreshAstProgress(): void {
    const total = Math.max(1, this.fileList.filter((f) => isCodeFile(f)).length);
    const done = this.store.listNodes('file').length;
    const progress = Math.min(1, done / total);
    this.store.setStage({
      name: 'ast',
      status: progress >= 1 ? 'complete' : 'processing',
      progress,
      updatedAt: Date.now(),
      detail: `${done}/${total}`,
    });
    if (progress >= 1 && (this.store.getStage('docs')?.status === 'pending')) {
      this.store.setStage({
        name: 'docs',
        status: this.queue.list('queued').some((j) => j.kind === 'INDEX_DOC')
          ? 'processing'
          : 'complete',
        progress: this.queue.list('queued').some((j) => j.kind === 'INDEX_DOC') ? 0.1 : 1,
        updatedAt: Date.now(),
      });
    }
    if (progress >= 0.3 && this.store.getStage('embeddings')?.status === 'pending') {
      this.store.setStage({
        name: 'embeddings',
        status: 'complete',
        progress: 1,
        updatedAt: Date.now(),
        detail: 'hash embeddings with symbols',
      });
    }
    if (progress >= 0.5 && this.store.getStage('architecture')?.status === 'pending') {
      this.store.setStage({
        name: 'architecture',
        status: 'processing',
        progress: 0.2,
        updatedAt: Date.now(),
      });
    }
  }

  private discoverFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      if (out.length >= this.maxFiles) {
        return;
      }
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        const abs = join(dir, name);
        if (shouldIgnorePath(abs)) {
          continue;
        }
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          walk(abs);
        } else if (st.isFile() && (isCodeFile(abs) || isDocFile(abs))) {
          if (st.size > 80_000 || /\.min\.(js|css)$/i.test(abs)) {
            continue;
          }
          out.push(abs);
          if (out.length >= this.maxFiles) {
            return;
          }
        }
      }
    };
    walk(this.workspaceRoot);
    return out;
  }

  private readGit(): void {
    try {
      this.branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      this.gitCommit = execSync('git rev-parse HEAD', {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      /* not a git repo */
    }
  }

  private recentGitFiles(): string[] {
    try {
      const out = execSync('git log -n 15 --name-only --pretty=format:', {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((rel) => join(this.workspaceRoot, rel));
    } catch {
      return [];
    }
  }
}

export function pathToUri(absPath: string): string {
  const normalized = absPath.replaceAll('\\', '/');
  return normalized.startsWith('file://') ? normalized : `file://${normalized}`;
}

export function uriToFs(uri: string, workspaceRoot: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice('file://'.length));
  }
  if (uri.startsWith('/')) {
    return uri;
  }
  return join(workspaceRoot, uri);
}

function safeRead(abs: string): string | undefined {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return undefined;
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
