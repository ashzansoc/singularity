export type WikiPageCategory =
  | 'overview'
  | 'synthesis'
  | 'source'
  | 'entity'
  | 'concept'
  | 'query'
  | 'contradiction'
  | 'other';

export type WikiClaimOrigin = 'asserted' | 'inferred';

export type WikiPageStatus = 'active' | 'stub' | 'review-due' | 'superseded';

export interface WikiFrontmatter {
  title: string;
  category: WikiPageCategory;
  about?: string;
  derived_from: string[];
  origin?: WikiClaimOrigin;
  status?: WikiPageStatus;
  updated?: string;
  source_count?: number;
  tags?: string[];
  summary?: string;
}

export interface WikiPage {
  /** Path relative to wiki pages dir, posix, e.g. `entities/postgresql.md`. */
  relPath: string;
  absPath: string;
  frontmatter: WikiFrontmatter;
  body: string;
  /** Full file text including frontmatter. */
  raw: string;
}

export interface WikiMeta {
  version: number;
  created: string;
  last_updated: string;
  workspace_root: string;
  wiki_root: string;
  source_count: number;
  page_count: number;
}

export interface WikiIndexEntry {
  relPath: string;
  title: string;
  category: WikiPageCategory;
  summary: string;
  updated?: string;
  source_count?: number;
}

export interface WikiLogEntry {
  date: string;
  op: 'init' | 'ingest' | 'query' | 'lint' | 'file' | 'update';
  title: string;
  detail: string;
}

export interface IngestSourceInput {
  title?: string;
  text?: string;
  /** Absolute or workspace-relative path to copy into raw/. */
  sourcePath?: string;
  filename?: string;
  url?: string;
  /** Optional extra notes from the user / agent. */
  notes?: string;
}

export interface WikiIngestPlanItem {
  relPath: string;
  action: 'create' | 'update';
  title: string;
  category: WikiPageCategory;
  reason: string;
}

export interface WikiIngestResult {
  skipped: boolean;
  reason?: string;
  rawRelPath?: string;
  sourcePageRelPath?: string;
  takeaways: string[];
  entities: string[];
  concepts: string[];
  pagesTouched: string[];
  plan: WikiIngestPlanItem[];
  logLine: string;
}

export interface WikiSearchHit {
  relPath: string;
  title: string;
  category: WikiPageCategory;
  score: number;
  excerpt: string;
}

export interface WikiQueryResult {
  question: string;
  hits: WikiSearchHit[];
  /** Draft answer assembled from wiki pages (heuristic). Agent should refine. */
  draft: string;
  citations: string[];
  filedRelPath?: string;
  noConfidentAnswer: boolean;
}

export interface WikiLintIssue {
  kind:
    | 'orphan'
    | 'broken-link'
    | 'missing-page'
    | 'missing-frontmatter'
    | 'self-grounding'
    | 'stub'
    | 'contradiction'
    | 'stale';
  relPath?: string;
  target?: string;
  detail: string;
}

export interface WikiLintResult {
  pageCount: number;
  sourceCount: number;
  issues: WikiLintIssue[];
  suggestions: string[];
}

export interface WikiFileAnswerInput {
  question: string;
  answer: string;
  title?: string;
  citations?: string[];
}

export interface WikiStatus {
  initialized: boolean;
  enabled: boolean;
  wikiRoot: string;
  sourceCount: number;
  pageCount: number;
  lastUpdated?: string;
  categories: Record<string, number>;
}

export interface WikiContextBlock {
  initialized: boolean;
  systemBlock?: string;
  indexPreview?: string;
  relevantPages?: WikiSearchHit[];
}
