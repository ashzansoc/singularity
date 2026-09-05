/**
 * Singularity LLM Wiki — facade for init / ingest / query / lint / search / file.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENTS_MD_POINTER,
  DEFAULT_CONTRADICTIONS_MD,
  DEFAULT_INDEX_MD,
  DEFAULT_LOG_MD,
  DEFAULT_OVERVIEW_MD,
  DEFAULT_SYNTHESIS_MD,
  WIKI_SCHEMA_MD,
} from './schema.js';
import {
  isWikiEngineActive,
  readWikiEngineFlags,
  type WikiEngineFlags,
} from './flags.js';
import { parseFrontmatter } from './frontmatter.js';
import { indexEntriesFromPages, renderIndexMd } from './indexFile.js';
import { ingestSource } from './ingest.js';
import { lintWiki } from './lint.js';
import { appendLog, parseLogEntries } from './log.js';
import { relToWorkspace, wikiPaths } from './paths.js';
import { formatLintReport, formatWikiContextBlock } from './format.js';
import { queryWiki } from './query.js';
import { searchPages } from './search.js';
import { slugify, todayDate } from './slug.js';
import { emptyMeta, WikiStore } from './store.js';
import type {
  IngestSourceInput,
  WikiContextBlock,
  WikiFileAnswerInput,
  WikiFrontmatter,
  WikiIngestResult,
  WikiLintResult,
  WikiLogEntry,
  WikiPage,
  WikiQueryResult,
  WikiSearchHit,
  WikiStatus,
} from './types.js';

export interface WikiEngineOptions {
  workspaceRoot: string;
  flags?: Partial<WikiEngineFlags>;
}

export class WikiEngine {
  readonly flags: WikiEngineFlags;
  readonly store: WikiStore;
  private readonly workspaceRoot: string;

  constructor(options: WikiEngineOptions) {
    this.flags = readWikiEngineFlags(options.flags);
    this.workspaceRoot = options.workspaceRoot;
    this.store = new WikiStore(
      options.workspaceRoot,
      wikiPaths(options.workspaceRoot, this.flags.wiki_root),
    );
  }

  get wikiRootRel(): string {
    return this.flags.wiki_root;
  }

  get initialized(): boolean {
    return this.store.exists();
  }

  status(): WikiStatus {
    const pages = this.initialized ? this.store.listPages() : [];
    const content = pages.filter(
      (p) => p.relPath !== 'index.md' && p.relPath !== 'log.md',
    );
    const categories: Record<string, number> = {};
    for (const p of content) {
      const c = p.frontmatter.category;
      categories[c] = (categories[c] ?? 0) + 1;
    }
    const meta = this.store.readMeta();
    return {
      initialized: this.initialized,
      enabled: isWikiEngineActive(this.flags),
      wikiRoot: relToWorkspace(this.workspaceRoot, this.store.paths.root) || this.flags.wiki_root,
      sourceCount: this.store.listRawFiles().length,
      pageCount: content.length,
      lastUpdated: meta?.last_updated,
      categories,
    };
  }

  init(): { created: boolean; wikiRoot: string; agentsPointer: boolean } {
    const existed = this.initialized;
    this.store.ensureDirs();
    const date = todayDate();
    if (!existsSync(this.store.paths.schema)) {
      this.store.writeText(this.store.paths.schema, WIKI_SCHEMA_MD);
    }
    if (!existsSync(this.store.paths.index)) {
      this.store.writeText(this.store.paths.index, DEFAULT_INDEX_MD);
    }
    if (!existsSync(this.store.paths.log)) {
      this.store.writeText(this.store.paths.log, DEFAULT_LOG_MD);
    }
    if (!existsSync(this.store.paths.overview)) {
      this.store.writeText(
        this.store.paths.overview,
        DEFAULT_OVERVIEW_MD.replaceAll('PLACEHOLDER_DATE', date),
      );
    }
    if (!existsSync(this.store.paths.synthesis)) {
      this.store.writeText(
        this.store.paths.synthesis,
        DEFAULT_SYNTHESIS_MD.replaceAll('PLACEHOLDER_DATE', date),
      );
    }
    if (!existsSync(this.store.paths.contradictions)) {
      this.store.writeText(
        this.store.paths.contradictions,
        DEFAULT_CONTRADICTIONS_MD.replaceAll('PLACEHOLDER_DATE', date),
      );
    }
    const meta = this.store.readMeta() ?? emptyMeta(this.workspaceRoot, this.flags.wiki_root);
    meta.last_updated = date;
    meta.page_count = this.store.listPages().filter(
      (p) => p.relPath !== 'index.md' && p.relPath !== 'log.md',
    ).length;
    meta.source_count = this.store.listRawFiles().length;
    this.store.writeMeta(meta);
    if (!existed) {
      this.appendLog({
        date,
        op: 'init',
        title: 'LLM Wiki',
        detail: `Initialized wiki at \`${this.flags.wiki_root}\`. Schema: SCHEMA.md.`,
      });
    }
    this.rebuildIndex();
    const agentsPointer = this.ensureAgentsPointer();
    return {
      created: !existed,
      wikiRoot: this.status().wikiRoot,
      agentsPointer,
    };
  }

  ingest(input: IngestSourceInput): WikiIngestResult {
    if (!isWikiEngineActive(this.flags)) {
      return {
        skipped: true,
        reason: 'disabled',
        takeaways: [],
        entities: [],
        concepts: [],
        pagesTouched: [],
        plan: [],
        logLine: '',
      };
    }
    if (!this.initialized) {
      this.init();
    }
    const result = ingestSource(this.store, input);
    if (result.skipped) {
      return result;
    }
    this.rebuildIndex();
    this.appendLog({
      date: todayDate(),
      op: 'ingest',
      title: input.title?.trim() || result.sourcePageRelPath || 'source',
      detail: result.logLine,
    });
    this.touchMeta();
    return result;
  }

  query(question: string, opts?: { fileAnswer?: boolean; limit?: number }): WikiQueryResult {
    if (!this.initialized) {
      return {
        question,
        hits: [],
        draft: 'Wiki is not initialized. Call init or ingest a source first.',
        citations: [],
        noConfidentAnswer: true,
      };
    }
    const pages = this.store.listPages();
    const result = queryWiki(pages, question, opts?.limit ?? 6);
    this.appendLog({
      date: todayDate(),
      op: 'query',
      title: question.slice(0, 80),
      detail: result.noConfidentAnswer
        ? 'No confident answer. Not filed.'
        : `Hits: ${result.hits.map((h) => h.relPath).join(', ')}`,
    });
    if (opts?.fileAnswer && !result.noConfidentAnswer) {
      const filed = this.fileAnswer({
        question,
        answer: result.draft,
        citations: result.citations,
      });
      result.filedRelPath = filed.relPath;
    }
    return result;
  }

  search(query: string, limit = 10): WikiSearchHit[] {
    if (!this.initialized) {
      return [];
    }
    return searchPages(this.store.listPages(), query, limit);
  }

  lint(): WikiLintResult {
    if (!this.initialized) {
      return {
        pageCount: 0,
        sourceCount: 0,
        issues: [],
        suggestions: ['Initialize the wiki, then ingest a source.'],
      };
    }
    this.rebuildIndex();
    const pages = this.store.listPages();
    const result = lintWiki(pages, this.store.listRawFiles().length);
    this.appendLog({
      date: todayDate(),
      op: 'lint',
      title: 'health check',
      detail: `${result.issues.length} issue(s) across ${result.pageCount} pages.`,
    });
    return result;
  }

  fileAnswer(input: WikiFileAnswerInput): { relPath: string } {
    if (!this.initialized) {
      this.init();
    }
    const title =
      input.title?.trim() ||
      input.question.trim().replace(/\?+$/, '').slice(0, 80) ||
      'Untitled query';
    const slug = slugify(title);
    const relPath = `queries/${slug}.md`;
    const derived = (input.citations ?? []).filter((c) => !c.startsWith('wiki/'));
    const body = [
      `# ${title}`,
      '',
      `**Question:** ${input.question.trim()}`,
      '',
      input.answer.trim(),
      '',
      input.citations?.length
        ? `## Citations\n\n${input.citations.map((c) => `- \`${c}\``).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    this.store.writePage(
      relPath,
      {
        title,
        category: 'query',
        about: title,
        derived_from: derived.length ? derived : input.citations ?? [],
        origin: 'inferred',
        status: 'active',
        updated: todayDate(),
        source_count: derived.length || undefined,
        summary: input.question.trim().slice(0, 160),
        tags: ['query'],
      },
      body,
    );
    this.rebuildIndex();
    this.appendLog({
      date: todayDate(),
      op: 'file',
      title,
      detail: `Filed query answer at \`${relPath}\`.`,
    });
    this.touchMeta();
    return { relPath };
  }

  applyPageUpdate(args: {
    relPath: string;
    title?: string;
    category?: WikiFrontmatter['category'];
    summary?: string;
    body: string;
    derived_from?: string[];
    about?: string;
  }): WikiPage {
    if (!this.initialized) {
      this.init();
    }
    const existing = this.store.readPage(args.relPath);
    const parsed = parseFrontmatter(args.body.startsWith('---') ? args.body : `---\ntitle: x\ncategory: other\nderived_from: []\n---\n${args.body}`);
    const fm: WikiFrontmatter = {
      title: args.title || existing?.frontmatter.title || parsed.frontmatter.title,
      category:
        args.category ||
        existing?.frontmatter.category ||
        parsed.frontmatter.category,
      about: args.about || existing?.frontmatter.about || parsed.frontmatter.about,
      derived_from:
        args.derived_from ||
        existing?.frontmatter.derived_from ||
        parsed.frontmatter.derived_from,
      origin: existing?.frontmatter.origin ?? parsed.frontmatter.origin ?? 'inferred',
      status: 'active',
      updated: todayDate(),
      source_count:
        (args.derived_from || existing?.frontmatter.derived_from || parsed.frontmatter.derived_from)
          ?.length,
      summary: args.summary || existing?.frontmatter.summary || parsed.frontmatter.summary,
      tags: existing?.frontmatter.tags ?? parsed.frontmatter.tags,
    };
    const body = args.body.startsWith('---') ? parsed.body : args.body;
    const page = this.store.writePage(args.relPath, fm, body);
    this.rebuildIndex();
    this.appendLog({
      date: todayDate(),
      op: 'update',
      title: fm.title,
      detail: `Updated \`${args.relPath}\`.`,
    });
    this.touchMeta();
    return page;
  }

  listPages(): WikiPage[] {
    return this.initialized ? this.store.listPages() : [];
  }

  readIndex(): string {
    return this.store.readText(this.store.paths.index) ?? '';
  }

  readLog(limit?: number): { text: string; entries: WikiLogEntry[] } {
    const text = this.store.readText(this.store.paths.log) ?? '';
    const entries = parseLogEntries(text);
    return {
      text: limit ? entries.slice(-limit).map((e) => `## [${e.date}] ${e.op} | ${e.title}\n\n${e.detail}`).join('\n\n') : text,
      entries: limit ? entries.slice(-limit) : entries,
    };
  }

  readSchema(): string {
    return this.store.readText(this.store.paths.schema) ?? WIKI_SCHEMA_MD;
  }

  rebuildIndex(): void {
    if (!this.initialized) {
      return;
    }
    const entries = indexEntriesFromPages(this.store.listPages());
    this.store.writeText(this.store.paths.index, renderIndexMd(entries));
    this.touchMeta(entries.length);
  }

  formatContextBlock(task?: string): WikiContextBlock {
    if (!isWikiEngineActive(this.flags) || !this.flags.wiki_agent_integration_enabled) {
      return { initialized: this.initialized };
    }
    if (!this.initialized) {
      return {
        initialized: false,
        systemBlock:
          'Singularity LLM Wiki is not initialized. If the user wants a persistent knowledge wiki, call llm_wiki operation=init then ingest sources. Do not invent wiki content.',
      };
    }
    const status = this.status();
    const pages = this.store.listPages();
    const indexEntries = indexEntriesFromPages(pages);
    const relevant = task?.trim() ? searchPages(pages, task, 6) : undefined;
    const schemaRelPath = relToWorkspace(this.workspaceRoot, this.store.paths.schema);
    const systemBlock = formatWikiContextBlock({
      status,
      indexEntries,
      relevant,
      schemaRelPath,
    });
    return {
      initialized: true,
      systemBlock,
      indexPreview: this.readIndex().slice(0, 4_000),
      relevantPages: relevant,
    };
  }

  formatLint(result: WikiLintResult): string {
    return formatLintReport(result);
  }

  private appendLog(entry: WikiLogEntry): void {
    const existing = this.store.readText(this.store.paths.log) ?? DEFAULT_LOG_MD;
    this.store.writeText(this.store.paths.log, appendLog(existing, entry));
  }

  private touchMeta(pageCount?: number): void {
    const meta =
      this.store.readMeta() ?? emptyMeta(this.workspaceRoot, this.flags.wiki_root);
    meta.last_updated = todayDate();
    meta.version += 1;
    meta.source_count = this.store.listRawFiles().length;
    meta.page_count =
      pageCount ??
      this.store.listPages().filter(
        (p) => p.relPath !== 'index.md' && p.relPath !== 'log.md',
      ).length;
    this.store.writeMeta(meta);
  }

  private ensureAgentsPointer(): boolean {
    const agentsPath = join(this.workspaceRoot, 'AGENTS.md');
    const pointer = AGENTS_MD_POINTER.replaceAll(
      '.singularity/wiki/SCHEMA.md',
      `${this.flags.wiki_root}/SCHEMA.md`,
    ).replaceAll('<wiki-root>', this.flags.wiki_root);
    if (!existsSync(agentsPath)) {
      this.store.writeText(
        agentsPath,
        `# AGENTS\n\n${pointer}\n`,
      );
      return true;
    }
    try {
      const existing = readFileSync(agentsPath, 'utf8');
      if (/LLM Wiki/i.test(existing) || /SCHEMA\.md/.test(existing)) {
        return false;
      }
      this.store.writeText(agentsPath, `${existing.replace(/\n+$/, '')}\n\n${pointer}\n`);
      return true;
    } catch {
      return false;
    }
  }
}

export function createWikiEngine(options: WikiEngineOptions): WikiEngine {
  return new WikiEngine(options);
}
