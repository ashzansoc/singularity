/**
 * BrainEngine — orchestrates the Singularity Brain.
 *
 * Owns the store, embeddings, extraction, dedup/importance and repo ingestion.
 * All writes are user-level: the same Brain survives project switches.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative, sep } from 'node:path';
import { BrainStore, normLabel } from './store.js';
import { GatewayBrainEmbedder, HashBrainEmbedder, cosine, type BrainEmbeddingProvider } from './embeddings.js';
import { MemoryExtractor, isTrivialForBrain, type ExtractionResult } from './extraction.js';
import { brainSearch } from './search.js';
import { computeImportance } from './importance.js';
import type {
  BrainConfig,
  BrainEpisode,
  BrainRuntimeSnapshot,
  BrainSyncState,
  BrainTypeMeta,
  EntityDetail,
  GraphView,
  ReasoningContext,
  RuntimeEvent,
  SearchFilters,
  SearchResult,
  SyncProgressEvent,
  UpsertRelationshipInput,
} from './types.js';
import { clusterForType } from './types.js';
import { resolveBrainConfig, type BrainConfigPartial, brainModelConfigured } from './config.js';
import { OpenAiCompatibleBrainClient, brainLlmFromClient, type BrainModelClient } from './modelClient.js';
import { BrainRuntime } from './runtime.js';
import { SemanticMemoryApi } from './semantic.js';
import { ImprovementManager } from './improvement.js';

export interface BrainLlm {
  complete(prompt: string): Promise<string>;
}

export interface BrainEngineOptions {
  /** Directory for brain.sqlite (VS Code globalStorage/brain). USER-level. */
  storageDir: string;
  /** Stable user identity; generated once by the host and reused forever. */
  userId: string;
  /** @deprecated Prefer brainConfig + dedicated model client. Still used as extraction fallback. */
  llm?: BrainLlm;
  /** Dedicated Brain model / runtime configuration. */
  brainConfig?: BrainConfigPartial;
  /** Inject a model client (tests). */
  modelClient?: BrainModelClient;
  embedding?: { apiKey?: string; baseUrl?: string; model?: string };
  onProgress?: (event: SyncProgressEvent) => void;
  onRuntimeStatus?: (snap: BrainRuntimeSnapshot) => void;
  onMemoryDelta?: (delta: { memories?: number; relationships?: number; learnings?: number; insights?: number }) => void;
  getWorkspaceRoot?: () => string | undefined;
  /** Start the autonomous runtime loop (default true). */
  startRuntime?: boolean;
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.build', 'target', '.venv',
  'venv', '__pycache__', '.cache', 'coverage', '.turbo', '.parcel-cache', 'vendor',
]);
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.rb',
  '.json', '.md', '.mdx', '.yml', '.yaml', '.toml', '.sql', '.css', '.scss', '.html',
  '.sh', '.tf', '.proto', '.graphql', '.vue', '.svelte', '.php', '.c', '.cpp', '.h',
]);
const MAX_FILE_BYTES = 96 * 1024;

export class BrainEngine {
  readonly store: BrainStore;
  readonly config: BrainConfig;
  readonly modelClient: BrainModelClient;
  readonly runtime: BrainRuntime;
  readonly semantic: SemanticMemoryApi;
  readonly improvement: ImprovementManager;
  private readonly embedder: BrainEmbeddingProvider;
  private readonly extractor: MemoryExtractor;
  private readonly onProgress?: (event: SyncProgressEvent) => void;
  private syncRunning = false;
  private embedQueue = new Set<string>();

  constructor(private opts: BrainEngineOptions) {
    this.store = new BrainStore(join(opts.storageDir, 'brain.sqlite'), opts.userId);
    this.config = resolveBrainConfig(opts.brainConfig);
    this.modelClient = opts.modelClient ?? new OpenAiCompatibleBrainClient(this.config);
    const llm: BrainLlm | undefined = opts.llm
      ?? (brainModelConfigured(this.config) ? brainLlmFromClient(this.modelClient) : undefined);
    this.embedder =
      opts.embedding?.apiKey && opts.embedding?.baseUrl
        ? new GatewayBrainEmbedder(opts.embedding)
        : new HashBrainEmbedder(256);
    this.extractor = new MemoryExtractor({
      complete: async (prompt) => {
        if (!llm) {
          throw new Error('no llm configured');
        }
        return llm.complete(prompt);
      },
    });
    // Preserve llm on opts for observeChat checks.
    if (llm && !opts.llm) {
      (this.opts as BrainEngineOptions).llm = llm;
    }
    this.onProgress = opts.onProgress;
    this.semantic = new SemanticMemoryApi(this.store);
    this.improvement = new ImprovementManager(this.store);
    this.runtime = new BrainRuntime({
      store: this.store,
      config: this.config,
      model: this.modelClient,
      onStore: async (event) => this.handleRuntimeStore(event),
      onStatus: opts.onRuntimeStatus,
      onMemoryDelta: opts.onMemoryDelta,
      getWorkspaceRoot: opts.getWorkspaceRoot,
    });
    if (opts.startRuntime !== false && this.config.enabled) {
      this.runtime.start();
    }
  }

  /** Start the background runtime loop if it is not already running. */
  ensureRuntimeStarted(): void {
    if (this.config.enabled) {
      this.runtime.start();
    }
  }

  /** Feed an event into the autonomous loop (preferred over direct observe for background). */
  observeEvent(event: RuntimeEvent): void {
    this.runtime.enqueue(event);
  }

  runtimeSnapshot(): BrainRuntimeSnapshot {
    return this.runtime.snapshot();
  }

  async ultrathink(brief: string, projectId?: string) {
    return this.runtime.ultrathink(brief, projectId);
  }

  private async handleRuntimeStore(event: RuntimeEvent): Promise<void> {
    const text = event.text ?? '';
    if (event.kind === 'file_save' || event.kind === 'file_change' || event.kind === 'css_edit') {
      if (event.sourceRef && text) {
        await this.observeFileChange(event.sourceRef, text, {
          projectId: event.projectId,
          workspaceRoot: event.workspaceRoot,
        });
      }
      return;
    }
    if (text) {
      await this.observeChat(text, {
        projectId: event.projectId,
        workspaceRoot: event.workspaceRoot,
        sourceRef: event.sourceRef,
      });
    }
  }

  get userId(): string {
    return this.opts.userId;
  }

  typeRegistry(): BrainTypeMeta[] {
    return this.store.listTypeRegistry();
  }

  // ---- Continuous learning ---------------------------------------------------

  /**
   * Observe a chat turn. Fire-and-forget friendly; never throws.
   * Returns the extraction result so callers can log/telemetry it.
   */
  async observeChat(text: string, opts?: { projectId?: string; workspaceRoot?: string; sourceRef?: string }): Promise<ExtractionResult | undefined> {
    if (isTrivialForBrain(text)) {
      return undefined;
    }
    // No LLM configured: fall back to deterministic patterns so the Brain
    // still records obvious decisions/learnings instead of dropping the turn.
    if (!this.opts.llm) {
      const heuristic = heuristicChatExtraction(text);
      if (!heuristic.durable) {
        return undefined;
      }
      this.applyExtraction(heuristic, { projectId: opts?.projectId, sourceRef: opts?.sourceRef });
      return heuristic;
    }
    try {
      const result = await this.extractor.extract({ kind: 'chat', text, contextHint: opts?.projectId ? `Project: ${opts.projectId}` : undefined });
      if (!result.durable) {
        return result;
      }
      const entityIds = this.applyExtraction(result, { projectId: opts?.projectId, sourceRef: opts?.sourceRef });
      if (result.episode) {
        this.store.addEpisode({
          kind: result.episode.kind,
          summary: result.episode.summary,
          projectId: opts?.projectId,
          workspaceRoot: opts?.workspaceRoot,
          entityIds,
          occurredAt: Date.now(),
          sourceRef: opts?.sourceRef,
        });
      }
      this.queueEmbeddings(entityIds);
      return result;
    } catch {
      return undefined;
    }
  }

  /**
   * Observe a file save/change. Debounced upstream; keeps module entities fresh.
   * Works without an LLM: heuristic import/path linking always runs so the
   * graph grows as the user works. LLM enrichment (when available) adds nuance.
   */
  async observeFileChange(uri: string, content: string, opts?: { projectId?: string; workspaceRoot?: string }): Promise<void> {
    try {
      const rel = opts?.workspaceRoot ? relative(opts.workspaceRoot, uri) : basename(uri);
      const moduleName = moduleOfPath(rel);
      const fileLabel = basename(uri).replace(/\.[^.]+$/, '') || basename(uri);
      const projectLabel = opts?.workspaceRoot
        ? (basename(opts.workspaceRoot) || opts.workspaceRoot)
        : (opts?.projectId ? basename(opts.projectId) : 'Workspace');
      const archLabel = `${projectLabel} Architecture`;

      // Code-layer nodes — NO direct project→file star edges.
      this.resolveOrCreate(projectLabel, 'project', opts?.projectId);
      this.resolveOrCreate(archLabel, 'architecture', opts?.projectId);
      this.resolveOrCreate(moduleName, 'code', opts?.projectId);
      this.resolveOrCreate(fileLabel, 'code', opts?.projectId);

      this.store.upsertRelationship(
        { sourceLabel: moduleName, sourceType: 'code', targetLabel: archLabel, targetType: 'architecture', relType: 'part_of', confidence: 0.75, projectId: opts?.projectId },
        (l, t) => this.resolveOrCreate(l, t, opts?.projectId),
      );
      this.store.upsertRelationship(
        { sourceLabel: moduleName, sourceType: 'code', targetLabel: fileLabel, targetType: 'code', relType: 'contains', confidence: 0.9, projectId: opts?.projectId },
        (l, t) => this.resolveOrCreate(l, t, opts?.projectId),
      );

      // Import edges: from/import/require → depends_on.
      for (const dep of extractImportTargets(content)) {
        const isPkg = !dep.startsWith('.') && dep.length < 40;
        this.resolveOrCreate(dep, isPkg ? 'technology' : 'code', opts?.projectId);
        this.store.upsertRelationship(
          {
            sourceLabel: fileLabel, sourceType: 'code',
            targetLabel: dep, targetType: isPkg ? 'technology' : 'code',
            relType: isPkg ? 'uses' : 'depends_on', confidence: 0.7, projectId: opts?.projectId,
          },
          (l, t) => this.resolveOrCreate(l, t, opts?.projectId),
        );
      }

      // Technology keywords in the file.
      for (const tech of detectTechInText(content)) {
        this.resolveOrCreate(tech, 'technology', opts?.projectId);
        this.store.upsertRelationship(
          { sourceLabel: fileLabel, sourceType: 'code', targetLabel: tech, targetType: 'technology', relType: 'uses', confidence: 0.55, projectId: opts?.projectId },
          (l, t) => this.resolveOrCreate(l, t, opts?.projectId),
        );
        this.store.upsertRelationship(
          { sourceLabel: tech, sourceType: 'technology', targetLabel: archLabel, targetType: 'architecture', relType: 'affects', confidence: 0.4, projectId: opts?.projectId },
          (l, t) => this.resolveOrCreate(l, t, opts?.projectId),
        );
      }

      this.store.refreshDegrees();
      this.recomputeImportance();

      if (this.opts.llm) {
        try {
          const result = await this.extractor.extract({
            kind: 'code_change',
            text: `File ${rel} changed. Excerpt:\n${clip(content, 4000)}`,
            contextHint: 'Incremental code observation. Only extract durable facts (what this file/module is, technologies, decisions it encodes).',
          });
          if (result.durable) {
            const entityIds = this.applyExtraction(result, { projectId: opts?.projectId, sourceRef: uri });
            this.store.addEpisode({
              kind: 'code_change',
              summary: `Modified ${rel}`,
              projectId: opts?.projectId,
              workspaceRoot: opts?.workspaceRoot,
              entityIds,
              occurredAt: Date.now(),
              sourceRef: uri,
            });
            this.queueEmbeddings(entityIds);
          }
        } catch {
          /* LLM enrichment is optional */
        }
      }
    } catch {
      /* memory must never break the coding hot path */
    }
  }

  // ---- Sync Everything (repo ingestion) ----------------------------------------

  /**
   * Deep repository ingestion: walks the workspace, groups files into modules,
   * reads manifests/configs/docs, then LLM-summarizes each cluster into
   * entities + relationships. Chunked, resumable, emits progress events.
   * Enriched with the tree-sitter symbol graph already indexed by the
   * Project Intelligence daemon (packages/intelligence), when present.
   */
  async syncWorkspace(workspaceRoot: string, projectId?: string, maxModules = 40): Promise<BrainSyncState> {
    if (this.syncRunning) {
      return this.store.getSyncState(workspaceRoot) ?? {
        workspaceRoot, status: 'running', phase: 'already-running', filesTotal: 0, filesDone: 0,
        startedAt: Date.now(), updatedAt: Date.now(),
      };
    }
    this.syncRunning = true;
    const startedAt = Date.now();
    const state: BrainSyncState = {
      workspaceRoot,
      status: 'running',
      phase: 'discovering',
      filesTotal: 0,
      filesDone: 0,
      startedAt,
      updatedAt: startedAt,
    };
    this.store.setSyncState(state);
    const emit = (phase: string, message?: string): void => {
      state.phase = phase;
      state.updatedAt = Date.now();
      this.store.setSyncState(state);
      this.onProgress?.({
        workspaceRoot,
        status: state.status,
        phase,
        filesDone: state.filesDone,
        filesTotal: state.filesTotal,
        message,
      });
    };

    try {
      const files = this.discoverFiles(workspaceRoot);
      state.filesTotal = files.length;
      emit('discovering', `${files.length} files discovered`);

      const projectEntity = this.store.upsertEntity(
        {
          type: 'project',
          label: basename(workspaceRoot) || workspaceRoot,
          description: `Project workspace at ${workspaceRoot}`,
          sourceType: 'brain.sync',
          projectId,
          importance: 0.35,
          authority: 'fact',
          cluster: 'project',
        },
        undefined,
      );
      const projectLabel = projectEntity.label;
      // Drop legacy star-hub edges so Sync Everything rebuilds a multi-center graph.
      this.store.pruneProjectStarEdges(projectEntity.id);

      const skeleton = this.seedSemanticSkeleton(projectLabel, projectId);

      // Group into modules (top-level or second-level directories).
      const modules = this.groupIntoModules(files, workspaceRoot);
      const moduleNames = [...modules.keys()].slice(0, maxModules);
      emit('understanding', `${moduleNames.length} modules`);

      const techLabels = new Set<string>();
      const moduleEntityLabels: string[] = [];
      for (let i = 0; i < moduleNames.length; i++) {
        const moduleName = moduleNames[i]!;
        const moduleFiles = modules.get(moduleName)!;
        const digest = this.buildModuleDigest(workspaceRoot, moduleName, moduleFiles);
        let extraction: ExtractionResult | undefined;
        if (this.opts.llm) {
          extraction = await this.extractor.summarizeModule(moduleName, digest);
        }
        if (!extraction || !extraction.durable) {
          extraction = heuristicModuleExtraction(moduleName, moduleFiles, digest);
        }
        const entityIds = this.applyExtraction(extraction, { projectId, sourceRef: join(workspaceRoot, moduleName) });
        moduleEntityLabels.push(moduleName);
        // Modules attach to Architecture (not project) — kills the star hub.
        this.store.upsertRelationship(
          {
            sourceLabel: moduleName, sourceType: 'code',
            targetLabel: skeleton.architecture, targetType: 'architecture',
            relType: 'part_of', confidence: 0.85, projectId,
          },
          (label, type) => this.resolveOrCreate(label, type, projectId),
          Date.now(),
        );
        // Code-layer topic for progressive disclosure.
        this.store.upsertRelationship(
          {
            sourceLabel: moduleName, sourceType: 'code',
            targetLabel: skeleton.codeLayer, targetType: 'topic',
            relType: 'related_to', confidence: 0.55, projectId,
          },
          (label, type) => this.resolveOrCreate(label, type, projectId),
          Date.now(),
        );
        void entityIds;
        this.queueEmbeddings(entityIds);
        state.filesDone = Math.round(((i + 1) / moduleNames.length) * files.length);
        emit('understanding', `${moduleName}`);
      }

      // Adjacent modules share a weak related_to bridge (cluster cohesion without a hub).
      for (let i = 0; i < moduleEntityLabels.length - 1; i++) {
        this.store.upsertRelationship(
          {
            sourceLabel: moduleEntityLabels[i]!, sourceType: 'code',
            targetLabel: moduleEntityLabels[i + 1]!, targetType: 'code',
            relType: 'related_to', confidence: 0.35, projectId,
          },
          (label, type) => this.resolveOrCreate(label, type, projectId),
          Date.now(),
        );
      }

      // Manifests → technologies attach to Architecture + Dependencies topic.
      const techs = this.detectTechnologies(workspaceRoot, files);
      for (const t of techs) {
        techLabels.add(t.label);
        this.resolveOrCreate(t.label, 'technology', projectId);
        this.store.upsertRelationship(
          {
            sourceLabel: t.label, sourceType: 'technology',
            targetLabel: skeleton.architecture, targetType: 'architecture',
            relType: 'affects', confidence: 0.7, projectId,
          },
          (label, type) => this.resolveOrCreate(label, type, projectId),
          Date.now(),
        );
        this.store.upsertRelationship(
          {
            sourceLabel: t.label, sourceType: 'technology',
            targetLabel: skeleton.dependencies, targetType: 'topic',
            relType: 'part_of', confidence: 0.8, projectId,
          },
          (label, type) => this.resolveOrCreate(label, type, projectId),
          Date.now(),
        );
        if (t.note) {
          const ent = this.store.findByNormLabel(normLabel(t.label));
          if (ent && !ent.description) {
            this.store.upsertEntity({ ...t, description: t.note, sourceType: 'brain.sync', projectId, cluster: 'dependencies' });
          }
        }
      }
      this.queueEmbeddings([...techLabels]);

      // Docs → real concepts/constraints (from README headings only — no invented edges).
      emit('understanding', 'docs');
      const docIds = this.ingestDocsConcepts(workspaceRoot, files, projectId, skeleton);
      this.queueEmbeddings(docIds);

      // Symbol-graph enrichment: reuse the intelligence daemon's tree-sitter
      // index to add high-signal classes/services and their imports edge.
      emit('linking', 'symbol graph');
      this.enrichFromIntelligenceGraph(workspaceRoot, projectId, skeleton.architecture);

      emit('linking', 'cross-linking entities');
      this.store.refreshDegrees();
      this.recomputeImportance();
      await this.flushEmbeddingQueue();

      state.status = 'done';
      state.finishedAt = Date.now();
      emit('done', 'Brain updated');
      return state;
    } catch (err) {
      state.status = 'error';
      state.error = err instanceof Error ? err.message : String(err);
      state.finishedAt = Date.now();
      emit('error', state.error);
      return state;
    } finally {
      this.syncRunning = false;
    }
  }

  /**
   * Pull durable concepts from top-level README / ARCHITECTURE / DESIGN docs.
   * Only materializes headings and explicit "must/should" constraint lines —
   * never invents relationships beyond part_of Architecture / related_to topics.
   */
  private ingestDocsConcepts(
    root: string,
    files: string[],
    projectId: string | undefined,
    skeleton: { architecture: string; decisions: string; evaluation: string; codeLayer: string; dependencies: string },
  ): string[] {
    const ids: string[] = [];
    const docPaths = files.filter((f) => {
      const rel = relative(root, f).toLowerCase();
      const base = basename(f).toLowerCase();
      if (rel.split(sep).length > 2) {
        return false;
      }
      return /^(readme|architecture|design|adr|contributing|changelog)/.test(base.replace(/\.[^.]+$/, ''))
        || base.endsWith('.md') && /^(docs\/)?(architecture|design|adr)/.test(rel);
    }).slice(0, 6);

    for (const path of docPaths) {
      let text = '';
      try {
        text = readFileSync(path, 'utf8');
      } catch {
        continue;
      }
      const headings = [...text.matchAll(/^#{1,3}\s+(.+)$/gm)]
        .map((m) => clip(m[1]!.replace(/[#*`\[\]]/g, '').trim(), 80))
        .filter((h) => h.length >= 4 && h.length <= 80 && !/^(table of contents|toc|license|installation|getting started)$/i.test(h));
      for (const heading of headings.slice(0, 12)) {
        const ent = this.store.upsertEntity({
          type: 'concept',
          label: heading,
          description: `From ${basename(path)}`,
          sourceType: 'brain.sync.docs',
          sourceRef: path,
          projectId,
          confidence: 0.55,
          authority: 'observation',
          cluster: 'memory',
          importance: 0.45,
        });
        ids.push(ent.id);
        this.store.upsertRelationship(
          {
            sourceLabel: heading, sourceType: 'concept',
            targetLabel: skeleton.architecture, targetType: 'architecture',
            relType: 'related_to', confidence: 0.5, projectId,
          },
          (label, type) => this.resolveOrCreate(label, type, projectId),
          Date.now(),
        );
      }
      const constraintLines = text.split('\n')
        .map((l) => l.trim())
        .filter((l) => /^(?:[-*]\s+)?(?:must|should|never|always|required|constraint)\b/i.test(l))
        .slice(0, 6);
      for (const line of constraintLines) {
        const label = clip(line.replace(/^[-*]\s+/, ''), 90);
        if (label.length < 8) {
          continue;
        }
        const ent = this.store.upsertEntity({
          type: 'constraint',
          label,
          sourceType: 'brain.sync.docs',
          sourceRef: path,
          projectId,
          confidence: 0.5,
          authority: 'observation',
          cluster: 'problems',
        });
        ids.push(ent.id);
        this.store.upsertRelationship(
          {
            sourceLabel: label, sourceType: 'constraint',
            targetLabel: skeleton.architecture, targetType: 'architecture',
            relType: 'constrains', confidence: 0.55, projectId,
          },
          (l, t) => this.resolveOrCreate(l, t, projectId),
          Date.now(),
        );
      }
    }
    return ids;
  }

  private discoverFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string, depth: number): void => {
      if (depth > 6) {
        return;
      }
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const name of entries) {
        if (IGNORED_DIRS.has(name) || name.startsWith('.') && depth > 0) {
          continue;
        }
        const full = join(dir, name);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          walk(full, depth + 1);
        } else if (st.isFile() && st.size < MAX_FILE_BYTES) {
          const ext = name.slice(name.lastIndexOf('.'));
          if (TEXT_EXT.has(ext)) {
            out.push(full);
          }
        }
      }
    };
    walk(root, 0);
    return out;
  }

  private groupIntoModules(files: string[], root: string): Map<string, string[]> {
    const modules = new Map<string, string[]>();
    for (const f of files) {
      const rel = relative(root, f);
      const parts = rel.split(sep);
      const moduleName = parts.length > 1 ? `${parts[0]}${parts[1] && parts[1].match(/^(src|lib|browser|node|common)/) ? `/${parts[1]}` : ''}` : '(root)';
      const list = modules.get(moduleName) ?? [];
      list.push(f);
      modules.set(moduleName, list);
    }
    return modules;
  }

  private buildModuleDigest(root: string, moduleName: string, files: string[]): string {
    const lines: string[] = [`Module ${moduleName} — ${files.length} files`];
    const priority = files.filter((f) => /package\.json|README|Cargo\.toml|pyproject|go\.mod|config|main|index|server|app/.test(basename(f)));
    for (const f of priority.slice(0, 4)) {
      try {
        const content = readFileSync(f, 'utf8');
        lines.push(`--- ${relative(root, f)} ---`);
        lines.push(clip(content, 2200));
      } catch {
        /* unreadable file, skip */
      }
    }
    const names = files.slice(0, 40).map((f) => relative(root, f));
    lines.push(`Files: ${names.join(', ')}`);
    return lines.join('\n');
  }

  private detectTechnologies(root: string, files: string[]): Array<{ type: string; label: string; note?: string; confidence?: number; sourceType: string }> {
    const out: Array<{ type: string; label: string; note?: string; confidence?: number; sourceType: string }> = [];
    const add = (label: string, note?: string): void => {
      out.push({ type: 'technology', label, ...(note ? { note } : {}), sourceType: 'brain.sync' });
    };
    const pkgPath = files.find((f) => basename(f) === 'package.json' && relative(root, f).split(sep).length <= 2);
    if (pkgPath) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
        const notable = deps.filter((d) => !d.startsWith('@types/') && !d.startsWith('eslint') && !d.startsWith('@typescript-eslint'));
        for (const d of notable.slice(0, 25)) {
          add(d);
        }
      } catch {
        /* malformed manifest */
      }
    }
    const has = (re: RegExp): boolean => files.some((f) => re.test(f));
    if (has(/Dockerfile$/)) {
      add('Docker');
    }
    if (has(/docker-compose/)) {
      add('Docker Compose');
    }
    if (has(/\.py$/)) {
      add('Python');
    }
    if (has(/\.go$/)) {
      add('Go');
    }
    if (has(/\.rs$/)) {
      add('Rust');
    }
    if (has(/requirements\.txt|pyproject\.toml/)) {
      add('pip');
    }
    return out;
  }

  /**
   * Seed intermediate semantic hubs so the project never becomes a star center.
   * These are real structural concepts (architecture / topics), not fake edges.
   */
  private seedSemanticSkeleton(projectLabel: string, projectId: string | undefined): {
    architecture: string;
    decisions: string;
    evaluation: string;
    codeLayer: string;
    dependencies: string;
  } {
    const architecture = `${projectLabel} Architecture`;
    const decisions = `${projectLabel} Decisions`;
    const evaluation = `${projectLabel} Evaluation`;
    const codeLayer = `${projectLabel} Code`;
    const dependencies = `${projectLabel} Dependencies`;

    this.store.upsertEntity({
      type: 'architecture', label: architecture,
      description: `Architectural center for ${projectLabel}`,
      sourceType: 'brain.sync', projectId, importance: 0.72,
      authority: 'fact', cluster: 'architecture',
    });
    this.store.upsertEntity({
      type: 'topic', label: decisions,
      description: 'Engineering decisions and tradeoffs',
      sourceType: 'brain.sync', projectId, importance: 0.55,
      authority: 'fact', cluster: 'decisions',
    });
    this.store.upsertEntity({
      type: 'topic', label: evaluation,
      description: 'Experiments, hypotheses, and outcomes',
      sourceType: 'brain.sync', projectId, importance: 0.5,
      authority: 'fact', cluster: 'evaluation',
    });
    this.store.upsertEntity({
      type: 'topic', label: codeLayer,
      description: 'Code and module layer',
      sourceType: 'brain.sync', projectId, importance: 0.48,
      authority: 'fact', cluster: 'code',
    });
    this.store.upsertEntity({
      type: 'topic', label: dependencies,
      description: 'Technologies and external dependencies',
      sourceType: 'brain.sync', projectId, importance: 0.48,
      authority: 'fact', cluster: 'dependencies',
    });

    // Single weak project ↔ architecture link — project is a leaf, not a hub.
    this.store.upsertRelationship(
      {
        sourceLabel: projectLabel, sourceType: 'project',
        targetLabel: architecture, targetType: 'architecture',
        relType: 'related_to', confidence: 0.9, projectId,
      },
      (label, type) => this.resolveOrCreate(label, type, projectId),
      Date.now(),
    );
    this.store.upsertRelationship(
      {
        sourceLabel: decisions, sourceType: 'topic',
        targetLabel: architecture, targetType: 'architecture',
        relType: 'informs', confidence: 0.7, projectId,
      },
      (label, type) => this.resolveOrCreate(label, type, projectId),
      Date.now(),
    );
    this.store.upsertRelationship(
      {
        sourceLabel: evaluation, sourceType: 'topic',
        targetLabel: architecture, targetType: 'architecture',
        relType: 'informs', confidence: 0.55, projectId,
      },
      (label, type) => this.resolveOrCreate(label, type, projectId),
      Date.now(),
    );
    this.store.upsertRelationship(
      {
        sourceLabel: codeLayer, sourceType: 'topic',
        targetLabel: architecture, targetType: 'architecture',
        relType: 'part_of', confidence: 0.65, projectId,
      },
      (label, type) => this.resolveOrCreate(label, type, projectId),
      Date.now(),
    );
    this.store.upsertRelationship(
      {
        sourceLabel: dependencies, sourceType: 'topic',
        targetLabel: architecture, targetType: 'architecture',
        relType: 'affects', confidence: 0.6, projectId,
      },
      (label, type) => this.resolveOrCreate(label, type, projectId),
      Date.now(),
    );

    return { architecture, decisions, evaluation, codeLayer, dependencies };
  }

  /**
   * Read the intelligence daemon's symbol graph (tree-sitter index) and fold
   * its most important classes/services into the Brain as `code` entities with
   * import edges. Attaches symbols to Architecture / modules — never project.
   */
  private enrichFromIntelligenceGraph(workspaceRoot: string, projectId: string | undefined, architectureLabel: string): void {
    const dbPath = join(workspaceRoot, '.singularity', 'intelligence', 'graph.sqlite');
    if (!existsSync(dbPath)) {
      return;
    }
    try {
      const req = createRequire(import.meta.url);
      const sqlite = req('node:sqlite') as {
        DatabaseSync: new (path: string) => { prepare(sql: string): { all(...p: unknown[]): Record<string, unknown>[] }; close(): void };
      };
      const db = new sqlite.DatabaseSync(dbPath);
      const rows = db
        .prepare(
          `SELECT n.id, n.kind, n.label FROM nodes n
           WHERE n.kind IN ('class','interface','file')
           ORDER BY n.token_count DESC LIMIT 150`,
        )
        .all();
      const seen = new Set<string>();
      let added = 0;
      for (const r of rows) {
        if (added >= 60) {
          break;
        }
        const label = String(r.label);
        if (!label || label.length > 80 || seen.has(normLabel(label))) {
          continue;
        }
        seen.add(normLabel(label));
        this.resolveOrCreate(label, 'code', projectId);
        added++;
        // Prefer attaching to a matching module; else Architecture (not project).
        const moduleHint = moduleOfPath(label) !== '(root)' ? moduleOfPath(label) : undefined;
        const attachTo = moduleHint && this.store.findByNormLabel(normLabel(moduleHint))
          ? moduleHint
          : architectureLabel;
        const attachType = attachTo === architectureLabel ? 'architecture' : 'code';
        this.store.upsertRelationship(
          {
            sourceLabel: label, sourceType: 'code',
            targetLabel: attachTo, targetType: attachType,
            relType: attachType === 'architecture' ? 'part_of' : 'related_to',
            confidence: 0.65, projectId,
          },
          (l, t) => this.resolveOrCreate(l, t, projectId),
          Date.now(),
        );
      }
      const importRows = db
        .prepare(
          `SELECT sn.label AS src, tn.label AS dst FROM edges e
           JOIN nodes sn ON sn.id = e.src JOIN nodes tn ON tn.id = e.dst
           WHERE e.kind = 'imports' LIMIT 400`,
        )
        .all();
      let imports = 0;
      for (const r of importRows) {
        if (imports >= 80) {
          break;
        }
        const src = String(r.src);
        const dst = String(r.dst);
        if (!src || !dst || src === dst) {
          continue;
        }
        this.store.upsertRelationship(
          { sourceLabel: src, sourceType: 'code', targetLabel: dst, targetType: 'code', relType: 'depends_on', confidence: 0.6, projectId },
          (l, t) => this.resolveOrCreate(l, t, projectId),
          Date.now(),
        );
        imports++;
      }
      db.close();
    } catch {
      /* enrichment is optional */
    }
  }

  /** Resolve-or-create used when materializing relationship endpoints. */
  private resolveOrCreate(label: string, type: string, projectId?: string) {
    const existing = this.store.findByNormLabel(normLabel(label));
    if (existing) {
      return existing;
    }
    return this.store.upsertEntity({
      type, label, sourceType: 'brain.inferred', projectId,
      cluster: clusterForType(type),
      authority: type === 'decision' ? 'decision' : 'inference',
    }, undefined);
  }

  private applyExtraction(result: ExtractionResult, opts: { projectId?: string; sourceRef?: string }): string[] {
    const ids: string[] = [];
    const byLabel = new Map<string, string>();
    for (const e of result.entities) {
      const ent = this.store.upsertEntity({
        ...e,
        projectId: opts.projectId,
        sourceRef: opts.sourceRef ?? e.sourceRef,
        cluster: e.cluster ?? clusterForType(e.type),
        authority: e.authority ?? (e.type === 'decision' ? 'decision' : e.type === 'hypothesis' ? 'hypothesis' : 'observation'),
      }, undefined);
      byLabel.set(normLabel(e.label), ent.id);
      ids.push(ent.id);

      // Attach decisions/learnings to Decisions topic or Architecture when present.
      if (e.type === 'decision' || e.type === 'tradeoff' || e.type === 'learning' || e.type === 'lesson') {
        const topics = this.store.entitiesByType('topic', 40)
          .filter((t) => !opts.projectId || t.projectId === opts.projectId);
        const decisionsTopic = topics.find((t) => /decisions$/i.test(t.label));
        const arch = this.store.entitiesByType('architecture', 8)
          .find((a) => !opts.projectId || a.projectId === opts.projectId);
        const target = decisionsTopic ?? arch;
        if (target) {
          this.store.upsertRelationship(
            {
              sourceLabel: e.label, sourceType: e.type,
              targetLabel: target.label, targetType: target.type,
              relType: e.type === 'decision' || e.type === 'tradeoff' ? 'part_of' : 'related_to',
              confidence: 0.55, projectId: opts.projectId,
            },
            (label, type) => this.resolveOrCreate(label, type, opts.projectId),
          );
        }
      }
    }
    for (const r of result.relationships as UpsertRelationshipInput[]) {
      const relType = r.relType === 'replaced' ? 'replaced_by' : r.relType;
      this.store.upsertRelationship(
        { ...r, relType, projectId: opts.projectId, sourceEvent: opts.sourceRef },
        (label, type) => {
          const knownId = byLabel.get(normLabel(label));
          if (knownId) {
            const ent = this.store.getEntity(knownId);
            if (ent) {
              return ent;
            }
          }
          return this.resolveOrCreate(label, type, opts.projectId);
        },
      );
    }
    this.store.refreshDegrees();
    return ids;
  }

  private queueEmbeddings(labelsOrIds: string[]): void {
    for (const x of labelsOrIds) {
      if (x) {
        this.embedQueue.add(x);
      }
    }
  }

  private async flushEmbeddingQueue(): Promise<void> {
    const pending = [...this.embedQueue];
    this.embedQueue = new Set<string>();
    const targets: string[] = [];
    for (const x of pending) {
      const ent = this.store.getEntity(x) ?? this.store.findByNormLabel(normLabel(x));
      if (ent && !this.store.getEmbedding(ent.id)) {
        targets.push(ent.id);
      }
    }
    const missing = this.store.entitiesMissingEmbeddings(128);
    const all = [...new Set([...targets, ...missing.map((m) => m.id)])];
    if (!all.length) {
      return;
    }
    const texts = all.map((id) => {
      const e = this.store.getEntity(id)!;
      return `${e.type}: ${e.label}. ${e.description ?? ''}`;
    });
    const vectors = await this.embedder.embed(texts);
    all.forEach((id, i) => this.store.setEmbedding(id, vectors[i] ?? []));
  }

  private recomputeImportance(): void {
    const top = this.store.topEntities(5000);
    for (const e of top) {
      const next = computeImportance(e);
      if (Math.abs(next - e.importance) > 0.02) {
        this.store.upsertEntity(
          {
            type: e.type, label: e.label, description: e.description,
            sourceType: e.sourceType, sourceRef: e.sourceRef, projectId: e.projectId,
            importance: next, confidence: e.confidence,
            authority: e.authority, cluster: e.cluster, evidence: e.evidence,
            validity: e.validity, supersededBy: e.supersededBy,
          },
          undefined,
        );
      }
    }
  }

  // ---- Read APIs (UI + retrieval) ---------------------------------------------

  getGraphView(limit = 400, filters?: SearchFilters): GraphView {
    const entities = this.balancedGraphEntities(limit, filters);
    const ids = new Set(entities.map((e) => e.id));
    const edges = this.store.edgesFor(ids);
    return {
      nodes: entities.map((e) => ({
        id: e.id,
        label: e.label,
        type: e.type,
        importance: e.importance,
        projectId: e.projectId,
        lastSeenAt: e.lastSeenAt,
        cluster: e.cluster,
        authority: e.authority,
        degree: e.degree,
      })),
      edges,
      truncated: this.store.countEntities() > entities.length,
    };
  }

  /**
   * Cluster-balanced sample so Architecture / Decisions / Code / Dependencies
   * all appear — never a project-dominated top-N by raw importance.
   */
  private balancedGraphEntities(limit: number, filters?: SearchFilters) {
    const caps: Array<{ type: string; max: number }> = [
      { type: 'architecture', max: Math.max(4, Math.floor(limit * 0.06)) },
      { type: 'topic', max: Math.max(6, Math.floor(limit * 0.08)) },
      { type: 'code', max: Math.max(40, Math.floor(limit * 0.35)) },
      { type: 'technology', max: Math.max(20, Math.floor(limit * 0.15)) },
      { type: 'decision', max: Math.max(12, Math.floor(limit * 0.1)) },
      { type: 'concept', max: Math.max(10, Math.floor(limit * 0.08)) },
      { type: 'learning', max: Math.max(8, Math.floor(limit * 0.06)) },
      { type: 'bug', max: Math.max(6, Math.floor(limit * 0.05)) },
      { type: 'solution', max: Math.max(6, Math.floor(limit * 0.05)) },
      { type: 'experiment', max: Math.max(6, Math.floor(limit * 0.05)) },
      { type: 'project', max: 2 },
    ];
    const picked = new Map<string, ReturnType<BrainStore['topEntities']>[number]>();
    for (const { type, max } of caps) {
      for (const e of this.store.entitiesByType(type, max)) {
        if (filters?.projectId && e.projectId && e.projectId !== filters.projectId) {
          continue;
        }
        if (filters?.types && !filters.types.includes(e.type)) {
          continue;
        }
        picked.set(e.id, e);
      }
    }
    // Fill remainder with global top importance (still soft-capping project).
    if (picked.size < limit) {
      for (const e of this.store.topEntities(limit * 2, filters)) {
        if (picked.size >= limit) {
          break;
        }
        if (e.type === 'project' && [...picked.values()].filter((x) => x.type === 'project').length >= 2) {
          continue;
        }
        picked.set(e.id, e);
      }
    }
    return [...picked.values()]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit);
  }

  getNeighborhood(id: string, depth = 1, limit = 120): GraphView {
    const ids = new Set<string>([id]);
    let frontier = [id];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const nid of frontier) {
        for (const n of this.store.neighborsOf(nid)) {
          if (!ids.has(n.entity.id) && ids.size < limit) {
            ids.add(n.entity.id);
            next.push(n.entity.id);
          }
        }
      }
      frontier = next;
    }
    const edges = this.store.edgesFor(ids);
    const nodes = [...ids]
      .map((nid) => this.store.getEntity(nid))
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
      .map((e) => ({
        id: e.id, label: e.label, type: e.type, importance: e.importance,
        projectId: e.projectId, lastSeenAt: e.lastSeenAt,
        cluster: e.cluster, authority: e.authority, degree: e.degree,
      }));
    return { nodes, edges, truncated: false };
  }

  getEntityDetail(id: string): EntityDetail | undefined {
    return this.store.detail(id);
  }

  async search(query: string, filters?: SearchFilters): Promise<SearchResult[]> {
    return brainSearch(query, { store: this.store, embed: (t) => this.embedder.embed(t) }, filters);
  }

  recentEpisodes(limit = 30): BrainEpisode[] {
    return this.store.recentEpisodes(limit);
  }

  stats(): { entities: number; episodes: number; syncedWorkspaces: number } {
    const entities = this.store.countEntities();
    const episodes = this.recentEpisodes(1000).length;
    const workspaces = new Set(this.recentEpisodes(1000).map((e) => e.workspaceRoot).filter(Boolean));
    return { entities, episodes, syncedWorkspaces: workspaces.size };
  }

  /** Compact context block for chat injection. */
  async relevantContext(query: string, tokenBudget = 700): Promise<string> {
    const ctx = await this.reasoningContext(query, tokenBudget);
    return ctx.block;
  }

  /**
   * Multi-hop agent retrieval: code + decisions + constraints + failures +
   * experiments + dependencies — not a flat similarity list.
   */
  async reasoningContext(query: string, tokenBudget = 900): Promise<ReasoningContext> {
    const all = await this.search(query, { limit: 24 });
    const take = (types: string[], n: number) =>
      all.filter((r) => types.includes(r.entity.type)).slice(0, n);

    // Expand 1-hop from top hits for multi-hop paths (decision→architecture→code).
    const expanded: SearchResult[] = [...all];
    const seen = new Set(all.map((r) => r.entity.id));
    for (const hit of all.slice(0, 6)) {
      for (const n of this.store.neighborsOf(hit.entity.id).slice(0, 4)) {
        if (seen.has(n.entity.id)) {
          continue;
        }
        seen.add(n.entity.id);
        expanded.push({ entity: n.entity, score: hit.score * 0.7, via: 'graph', snippet: n.rel.relType });
      }
    }

    const code = take(['code', 'repository', 'service', 'layer'], 6);
    const decisions = [...take(['decision', 'tradeoff', 'assumption'], 5), ...expanded.filter((r) => r.entity.type === 'decision' && !take(['decision'], 5).some((x) => x.entity.id === r.entity.id))].slice(0, 5);
    const constraints = take(['constraint', 'requirement'], 4);
    const failures = take(['bug', 'lesson'], 4);
    const experiments = take(['experiment', 'hypothesis', 'outcome'], 4);
    const evaluations = take(['evaluation'], 3);
    const dependencies = take(['technology'], 5);
    const observations = take(['observation', 'learning', 'fact', 'concept'], 4);

    const sections: Array<[string, SearchResult[]]> = [
      ['Code', code],
      ['Decisions', decisions],
      ['Constraints', constraints],
      ['Failures / lessons', failures],
      ['Experiments', experiments],
      ['Evaluations', evaluations],
      ['Dependencies', dependencies],
      ['Observations', observations],
    ];
    const lines: string[] = ['Singularity Brain (multi-hop engineering memory):'];
    let budget = tokenBudget;
    for (const [title, rows] of sections) {
      if (!rows.length) {
        continue;
      }
      const header = `${title}:`;
      if (header.length > budget) {
        break;
      }
      lines.push(header);
      budget -= header.length;
      for (const r of rows) {
        const e = r.entity;
        const hop = r.via === 'graph' && r.snippet ? ` ⟶${r.snippet}` : '';
        const line = `  - [${e.type}] ${e.label}${e.description ? `: ${clip(e.description, 120)}` : ''}${hop}`;
        if (line.length > budget) {
          break;
        }
        budget -= line.length;
        lines.push(line);
      }
    }

    return {
      query,
      code, decisions, constraints, failures, experiments, evaluations, dependencies, observations,
      block: lines.length > 1 ? lines.join('\n') : '',
    };
  }

  /** Semantic neighbors used by cross-project linking during search/expansion. */
  async relatedBySimilarity(id: string, threshold = 0.82): Promise<Array<{ entity: import('./types.js').BrainEntity; similarity: number }>> {
    const emb = this.store.getEmbedding(id);
    if (!emb) {
      return [];
    }
    const out: Array<{ entity: import('./types.js').BrainEntity; similarity: number }> = [];
    for (const { entity, embedding } of this.store.allEntitiesWithEmbeddings()) {
      if (entity.id === id) {
        continue;
      }
      const sim = cosine(emb, embedding);
      if (sim >= threshold) {
        out.push({ entity, similarity: sim });
      }
    }
    return out.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
  }

  close(): void {
    this.runtime.stop();
    this.store.flushJsonFallback();
    this.store.close();
  }
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** Top-level folder (or "(root)") used as the module cluster for a relative path. */
function moduleOfPath(rel: string): string {
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 1) {
    return '(root)';
  }
  return parts[0]!;
}

/** Pull local import/require targets from a source file (no network, no LLM). */
function extractImportTargets(content: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const raw = m[1]!;
      if (!raw.startsWith('.') && !raw.startsWith('/') && !raw.startsWith('@')) {
        // Package name → technology-ish short label.
        const pkg = raw.startsWith('@') ? raw.split('/').slice(0, 2).join('/') : raw.split('/')[0]!;
        if (pkg && pkg.length < 60) {
          out.add(pkg);
        }
        continue;
      }
      // Relative → basename without extension.
      const base = raw.split('/').pop()?.replace(/\.[jt]sx?$/, '') ?? '';
      if (base && base !== '.' && base !== '..' && base.length < 60) {
        out.add(base);
      }
    }
  }
  return [...out].slice(0, 24);
}

const TECH_KEYWORDS = [
  'TypeScript', 'JavaScript', 'Python', 'Rust', 'Go', 'React', 'Vue', 'Svelte',
  'Node', 'SQLite', 'Postgres', 'Redis', 'Docker', 'Kubernetes', 'GraphQL',
  'Prisma', 'Vite', 'Webpack', 'esbuild', 'Electron', 'Sigma', 'Graphology',
];

function detectTechInText(text: string): string[] {
  const hits: string[] = [];
  for (const t of TECH_KEYWORDS) {
    if (new RegExp(`\\b${t}\\b`, 'i').test(text)) {
      hits.push(t);
    }
  }
  return hits;
}

const DECISION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:we|let'?s|i)?\s*(?:decided|decide|chose|choose|switched|moved|migrating|going)\s+(?:to|with|from)\s+([^.!?\n]{3,80})/i, 'decision'],
  [/\buse\s+([A-Za-z0-9_.\-/]{2,40})\s+(?:instead of|rather than|over)\s+([A-Za-z0-9_.\-/]{2,40})/i, 'decision'],
  [/\blearned that\b\s*([^.!?\n]{6,100})/i, 'learning'],
  [/\bturns out\b\s*([^.!?\n]{6,100})/i, 'learning'],
];

/** Deterministic fallback so chat turns teach the Brain even with no LLM configured. */
function heuristicChatExtraction(text: string): ExtractionResult {
  const entities: ExtractionResult['entities'] = [];
  const relationships: UpsertRelationshipInput[] = [];
  let matched = false;

  for (const [pattern, kind] of DECISION_PATTERNS) {
    const m = text.match(pattern);
    if (!m) {
      continue;
    }
    matched = true;
    if (kind === 'decision' && m[1] && m[2]) {
      // "use X instead of Y"
      entities.push({ type: 'technology', label: titleCase(m[1]), confidence: 0.55, sourceType: 'brain.chat.heuristic' });
      entities.push({ type: 'technology', label: titleCase(m[2]), confidence: 0.5, sourceType: 'brain.chat.heuristic' });
      relationships.push({
        sourceLabel: titleCase(m[1]), sourceType: 'technology',
        targetLabel: titleCase(m[2]), targetType: 'technology',
        relType: 'replaced_by', confidence: 0.55,
      });
      const decisionLabel = `Use ${titleCase(m[1])} over ${titleCase(m[2])}`;
      entities.push({
        type: 'decision', label: decisionLabel, confidence: 0.55,
        sourceType: 'brain.chat.heuristic', authority: 'decision', cluster: 'decisions',
      });
      relationships.push({
        sourceLabel: decisionLabel, sourceType: 'decision',
        targetLabel: titleCase(m[1]), targetType: 'technology',
        relType: 'decided', confidence: 0.5,
      });
    } else {
      const label = clip(m[1]?.trim() ?? '', 80).replace(/\s+/g, ' ');
      if (label) {
        entities.push({
          type: kind === 'decision' ? 'decision' : 'learning',
          label: label.charAt(0).toUpperCase() + label.slice(1),
          confidence: 0.5,
          sourceType: 'brain.chat.heuristic',
          authority: kind === 'decision' ? 'decision' : 'observation',
          cluster: kind === 'decision' ? 'decisions' : 'solutions',
        });
      }
    }
  }

  for (const t of ['TypeScript', 'Python', 'Rust', 'React', 'Node', 'SQLite', 'Postgres', 'Redis', 'Docker', 'Kubernetes']) {
    if (new RegExp(`\\b${t}\\b`, 'i').test(text)) {
      entities.push({ type: 'technology', label: t, confidence: 0.5, sourceType: 'brain.chat.heuristic' });
    }
  }

  return { durable: matched || entities.length > 0, entities: entities.slice(0, 12), relationships };
}

function titleCase(s: string): string {
  return s.trim().replace(/\s+/g, ' ').slice(0, 60).replace(/^./, (c) => c.toUpperCase());
}

/** Deterministic fallback so Sync Everything produces a useful graph without an LLM. */
function heuristicModuleExtraction(moduleName: string, files: string[], digest: string): ExtractionResult {
  const entities: ExtractionResult['entities'] = [
    {
      type: moduleName.startsWith('(') ? 'code' : 'code',
      label: moduleName,
      description: `Module with ${files.length} files (heuristic extraction)`,
      confidence: 0.6,
      sourceType: 'brain.sync.heuristic',
    },
  ];
  const relationships: UpsertRelationshipInput[] = [];
  const techHits = new Set<string>();
  for (const t of ['typescript', 'python', 'rust', 'react', 'node', 'sqlite', 'postgres', 'redis', 'docker', 'kubernetes']) {
    if (digest.toLowerCase().includes(t)) {
      techHits.add(t[0]!.toUpperCase() + t.slice(1));
    }
  }
  for (const t of techHits) {
    entities.push({ type: 'technology', label: t, confidence: 0.55, sourceType: 'brain.sync.heuristic' });
    relationships.push({ sourceLabel: moduleName, sourceType: 'code', targetLabel: t, targetType: 'technology', relType: 'uses', confidence: 0.55 });
  }
  return { durable: true, entities, relationships };
}
