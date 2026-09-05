/**
 * Singularity Context Engine — facade for extract → merge → store → retrieve.
 */

import type { ContextExtractor } from './extractor.js';
import { NoopContextExtractor } from './extractor.js';
import {
  HeuristicContextExtractor,
} from './heuristicExtractor.js';
import { LangExtractContextExtractor } from './langextractExtractor.js';
import {
  readContextEngineFlags,
  type ContextEngineFlags,
  isContextEngineActive,
} from './flags.js';
import {
  applyUserOverride,
  emptyProjectState,
  mergeDelta,
  removeItem,
} from './merge.js';
import { MetricsCollector, estimateTokens } from './metrics.js';
import { preferSyncExtraction, shouldExtract } from './relevance.js';
import {
  estimateFullStateTokens,
  getRelevantContext,
  type RetrieveOptions,
} from './retrieval.js';
import { ProjectStateStore } from './store.js';
import { redactSecrets } from './redact.js';
import type {
  ExtractionCostReport,
  ExtractionResult,
  ProjectState,
  RelevantContext,
  SourceMetadata,
} from './types.js';

export interface ContextEngineOptions {
  workspaceRoot: string;
  projectId?: string;
  flags?: Partial<ContextEngineFlags>;
  extractor?: ContextExtractor;
  /** Prefer heuristic only (tests / no Python). */
  heuristicOnly?: boolean;
}

export interface IngestMessageResult {
  skipped: boolean;
  reason?: string;
  extraction?: ExtractionResult;
  state?: ProjectState;
  cost?: ExtractionCostReport;
}

export class ContextEngine {
  readonly flags: ContextEngineFlags;
  readonly store: ProjectStateStore;
  readonly metrics = new MetricsCollector();
  private readonly extractor: ContextExtractor;
  private readonly projectId: string;
  private state: ProjectState;

  constructor(options: ContextEngineOptions) {
    this.flags = readContextEngineFlags(options.flags);
    this.store = new ProjectStateStore(options.workspaceRoot);
    this.projectId = options.projectId ?? 'default';
    this.state = this.store.load(this.projectId);

    if (options.extractor) {
      this.extractor = options.extractor;
    } else if (!this.flags.context_engine_enabled) {
      this.extractor = new NoopContextExtractor();
    } else if (options.heuristicOnly || !this.flags.langextract_enabled) {
      this.extractor = new HeuristicContextExtractor();
    } else {
      this.extractor = new LangExtractContextExtractor();
    }
  }

  getState(): ProjectState {
    return this.state;
  }

  reload(): ProjectState {
    this.state = this.store.load(this.projectId);
    return this.state;
  }

  /**
   * Ingest a conversation message (relevance-gated, incremental).
   */
  async ingestMessage(
    text: string,
    source?: SourceMetadata,
    opts?: { force?: boolean; sync?: boolean },
  ): Promise<IngestMessageResult> {
    if (!isContextEngineActive(this.flags)) {
      return { skipped: true, reason: 'disabled' };
    }
    const cleaned = redactSecrets(text);
    if (!opts?.force && !shouldExtract(cleaned)) {
      return { skipped: true, reason: 'not_relevant' };
    }

    // sync preference is advisory for callers; we always await here
    void (opts?.sync ?? preferSyncExtraction(cleaned));

    const extraction = await this.extractor.extract({
      text: cleaned,
      source_metadata: source ?? { type: 'conversation' },
      existing_state: this.state,
      complexity: cleaned.length > 4000 ? 'large_document' : 'simple',
    });

    this.metrics.recordExtraction({
      ok: !extraction.error || Boolean(extraction.delta),
      latency_ms: extraction.latency_ms,
      input_tokens: extraction.input_tokens,
      output_tokens: extraction.output_tokens,
    });

    const { state, stats } = mergeDelta(this.state, extraction.delta);
    this.state = state;
    this.store.save(this.state);
    this.metrics.recordMerge(stats);

    const cost: ExtractionCostReport = {
      provider: extraction.provider ?? 'unknown',
      model: extraction.model ?? 'unknown',
      input_tokens: extraction.input_tokens ?? 0,
      output_tokens: extraction.output_tokens ?? 0,
      latency_ms: extraction.latency_ms,
    };

    return {
      skipped: false,
      extraction,
      state: this.state,
      cost,
    };
  }

  /**
   * Extract from a document (PRD etc.).
   */
  async ingestDocument(
    text: string,
    source: SourceMetadata,
  ): Promise<IngestMessageResult> {
    return this.ingestMessage(text, { ...source, type: source.type || 'document' }, {
      force: true,
    });
  }

  getRelevant(task: string, options?: Omit<RetrieveOptions, 'task'>): RelevantContext {
    if (
      !isContextEngineActive(this.flags) ||
      !this.flags.context_retrieval_enabled
    ) {
      return {
        requirements: [],
        constraints: [],
        prohibitions: [],
        technologies: [],
        decisions: [],
        preferences: [],
        goals: [],
        open_questions: [],
        files: [],
        prompt_block: '',
        estimated_tokens: 0,
      };
    }
    const t0 = Date.now();
    const relevant = getRelevantContext(this.state, { task, ...options });
    const raw = estimateFullStateTokens(this.state);
    this.metrics.recordRetrieval({
      latency_ms: Date.now() - t0,
      raw_tokens: raw,
      retrieved_tokens: relevant.estimated_tokens,
    });
    return relevant;
  }

  override(
    kind:
      | 'requirement'
      | 'constraint'
      | 'prohibition'
      | 'technology'
      | 'decision'
      | 'preference',
    content: string,
    extra?: { category?: string; replaceId?: string },
  ): ProjectState {
    this.state = applyUserOverride(this.state, kind, content, extra);
    this.store.save(this.state);
    return this.state;
  }

  remove(id: string, mode: 'archive' | 'delete' = 'archive'): ProjectState {
    this.state = removeItem(this.state, id, mode);
    this.store.save(this.state);
    return this.state;
  }

  /** Compact facts suitable for ProjectMemoryStore upserts. */
  memoryFacts(): Array<{ id: string; kind: string; text: string }> {
    const facts: Array<{ id: string; kind: string; text: string }> = [];
    for (const t of this.state.technologies.filter((x) => x.status === 'active')) {
      facts.push({
        id: t.id,
        kind: 'architecture',
        text: `Technology: ${t.name} (${t.category})`,
      });
    }
    for (const p of this.state.prohibitions.filter((x) => x.status === 'active')) {
      facts.push({
        id: p.id,
        kind: 'convention',
        text: `Prohibition: ${p.prohibition}`,
      });
    }
    for (const c of this.state.constraints.filter((x) => x.status === 'active')) {
      facts.push({
        id: c.id,
        kind: 'convention',
        text: `Constraint [${c.strength}]: ${c.constraint}`,
      });
    }
    for (const d of this.state.architecture_decisions.filter(
      (x) => x.status === 'active',
    )) {
      facts.push({
        id: d.id,
        kind: 'approach',
        text: `Decision: ${d.decision}`,
      });
    }
    for (const pref of this.state.user_preferences.filter(
      (x) => x.status === 'active',
    )) {
      facts.push({
        id: pref.id,
        kind: 'preference',
        text: pref.preference,
      });
    }
    return facts.slice(0, 40);
  }

  counts(): Record<string, number> {
    const active = <T extends { status: string }>(arr: T[]) =>
      arr.filter((x) => x.status === 'active' || x.status === 'proposed').length;
    return {
      requirements: active(this.state.requirements),
      constraints: active(this.state.constraints),
      prohibitions: active(this.state.prohibitions),
      technologies: active(this.state.technologies),
      decisions: active(this.state.architecture_decisions),
      preferences: active(this.state.user_preferences),
      goals: active(this.state.current_goals),
      open_questions: active(this.state.open_questions),
      version: this.state.meta.version,
    };
  }

  dispose(): void {
    const ext = this.extractor as { dispose?: () => void };
    ext.dispose?.();
  }
}

export function createContextEngine(
  options: ContextEngineOptions,
): ContextEngine {
  return new ContextEngine(options);
}

export { emptyProjectState, estimateTokens };
