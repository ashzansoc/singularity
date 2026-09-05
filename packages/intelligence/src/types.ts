/**
 * Context Intelligence Layer — public types.
 */

import type { EdgeKind, GraphEdge, GraphNode, NodeKind } from '@singularity/prompt';

export type { EdgeKind, GraphEdge, GraphNode, NodeKind };

export type StageName =
  | 'tree'
  | 'ast'
  | 'scip'
  | 'docs'
  | 'embeddings'
  | 'architecture';

export type StageStatus = 'pending' | 'processing' | 'complete' | 'error';

export interface StageProgress {
  name: StageName;
  status: StageStatus;
  progress: number;
  detail?: string;
  updatedAt: number;
}

export type JobKind =
  | 'INDEX_FILE'
  | 'INDEX_DOC'
  | 'LSP_ENRICH'
  | 'SCIP_INGEST'
  | 'SUMMARY'
  | 'BOOTSTRAP_TREE';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export const JOB_PRIORITY = {
  active_file: 100,
  referenced_by_active: 80,
  recent_git: 50,
  rest: 10,
} as const;

export type JobPriorityName = keyof typeof JOB_PRIORITY;

export interface IntelligenceJob {
  id: string;
  kind: JobKind;
  uri?: string;
  priority: number;
  payload?: Record<string, unknown>;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface FileIndexMeta {
  uri: string;
  fileId: string;
  contentHash: string;
  lastIndexedAt: number;
  gitCommit?: string;
  branch?: string;
  languageId?: string;
  stale?: boolean;
}

export interface SymbolHit {
  id: string;
  name: string;
  kind: NodeKind;
  uri?: string;
  startLine?: number;
  score: number;
}

export interface ContextItem {
  id: string;
  kind: NodeKind;
  label: string;
  text: string;
  uri?: string;
  score: number;
  stale?: boolean;
}

export interface ContextResponse {
  context: ContextItem[];
  confidence: number;
  sources: string[];
  graph_depth: number;
  index_freshness: string;
  stale: string[];
  stages: Record<string, StageStatus | string>;
}

export interface ImpactResponse {
  symbol: string;
  callers: SymbolHit[];
  callees: SymbolHit[];
  files: string[];
  tests: string[];
  depth: number;
}

export interface ArchitectureResponse {
  summary: string;
  constraints: Array<{ text: string; source?: string }>;
  technologies: string[];
}

export interface ProjectStatusResponse {
  percent: number;
  stages: StageProgress[];
  fileCount: number;
  symbolCount: number;
  jobQueueDepth: number;
}

export interface Subgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface LspRelation {
  fromId: string;
  toId: string;
  kind: EdgeKind;
  fromUri?: string;
  toUri?: string;
  fromName?: string;
  toName?: string;
}

export interface LiveSourceProvider {
  getContentHash(uri: string): string | undefined;
  getContent(uri: string): string | undefined;
}

export interface GraphStore {
  upsertNodes(nodes: GraphNode[]): void;
  upsertEdges(edges: GraphEdge[]): void;
  removeNode(id: string): void;
  removeFileNeighborhood(fileId: string): void;
  getNode(id: string): GraphNode | undefined;
  listNodes(kind?: NodeKind): GraphNode[];
  neighborhood(id: string, depth: number, rels?: EdgeKind[]): Subgraph;
  findSymbols(query: string, opts?: { limit?: number }): SymbolHit[];
  markStale(fileId: string, stale?: boolean): void;
  getFileMeta(uri: string): FileIndexMeta | undefined;
  setFileMeta(meta: FileIndexMeta): void;
  listFileMeta(): FileIndexMeta[];
  getStage(name: StageName): StageProgress | undefined;
  setStage(progress: StageProgress): void;
  listStages(): StageProgress[];
  setMeta(key: string, value: string): void;
  getMeta(key: string): string | undefined;
  snapshot(): Subgraph;
  close(): void;
}
