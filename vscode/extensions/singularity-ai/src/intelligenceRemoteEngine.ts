/**
 * Thin facade so existing code can treat the remote worker like an in-process
 * IntelligenceEngine for read paths (context, symbols, status).
 */

import {
  IntelligenceClient,
  formatContextBlock,
  type ContextResponse,
  type GraphStore,
  type ImpactResponse,
  type IntelligenceJob,
  type ProjectStatusResponse,
  type SymbolHit,
} from '@singularity/intelligence';

const EMPTY_STATUS: ProjectStatusResponse = {
  percent: 0,
  stages: [],
  fileCount: 0,
  symbolCount: 0,
  jobQueueDepth: 0,
};

/** Minimal store stub — Neural Relay falls back to FilesystemRepoIndex when empty. */
const REMOTE_STORE = {
  listNodes(_kind?: string) {
    return [];
  },
} as unknown as GraphStore;

const EMPTY_CONTEXT: ContextResponse = {
  context: [],
  confidence: 0,
  sources: [],
  graph_depth: 0,
  index_freshness: '',
  stale: [],
  stages: {},
};

const EMPTY_IMPACT: ImpactResponse = {
  symbol: '',
  callers: [],
  callees: [],
  files: [],
  tests: [],
  depth: 0,
};

export class RemoteIntelligenceEngine {
  readonly store = REMOTE_STORE;
  private statusCache: ProjectStatusResponse = EMPTY_STATUS;
  private statusAt = 0;

  constructor(
    readonly workspaceRoot: string,
    private readonly client: IntelligenceClient,
  ) {}

  getContext(_query: string, opts?: { limit?: number; depth?: number }): ContextResponse {
    void opts;
    return EMPTY_CONTEXT;
  }

  async getContextAsync(
    query: string,
    opts?: { limit?: number; depth?: number },
  ): Promise<ContextResponse> {
    void opts;
    const res = await this.client.context(query);
    return res ?? EMPTY_CONTEXT;
  }

  status(): ProjectStatusResponse {
    return this.statusCache;
  }

  async refreshStatus(): Promise<ProjectStatusResponse> {
    const now = Date.now();
    if (now - this.statusAt < 4_000) {
      return this.statusCache;
    }
    const s = await this.client.projectStatus();
    this.statusCache = s ?? EMPTY_STATUS;
    this.statusAt = now;
    return this.statusCache;
  }

  symbols(query: string, limit = 24): SymbolHit[] {
    void query;
    void limit;
    return [];
  }

  async symbolsAsync(query: string, limit = 24): Promise<SymbolHit[]> {
    return this.client.symbols(query, limit);
  }

  search(query: string, limit = 24): SymbolHit[] {
    void query;
    void limit;
    return [];
  }

  async searchAsync(query: string, limit = 24): Promise<SymbolHit[]> {
    return this.client.search(query, limit);
  }

  notifyFileEvent(
    kind: 'FILE_CREATED' | 'FILE_MODIFIED' | 'FILE_DELETED',
    uri: string,
    referenced: string[] = [],
  ): void {
    void this.client.notifyFile(kind, uri, referenced);
  }

  bumpActiveFile(uri: string, referenced: string[] = []): void {
    void this.client.notifyFile('FILE_MODIFIED', uri, referenced);
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
    void this.client.applyLsp(relations);
    return relations.length;
  }

  takeLspJobs(_max = 8): IntelligenceJob[] {
    return [];
  }

  completeJob(_id: string, _error?: string): void {
    /* LSP enrichment is driven from the extension host for the active file */
  }

  stop(): void {
    /* worker lifecycle owned by intelligenceWorkerProcess */
  }

  impact(symbol: string, depth = 2): ImpactResponse {
    void symbol;
    void depth;
    return EMPTY_IMPACT;
  }

  dependencies(symbol: string, depth = 2): ImpactResponse {
    void symbol;
    void depth;
    return EMPTY_IMPACT;
  }

  architecture(): { summary: string; constraints: Array<{ text: string; source: string }> } {
    return { summary: '', constraints: [] };
  }
}

export function formatRemoteContextBlock(
  res: ContextResponse | undefined,
): string {
  if (!res) {
    return '';
  }
  return formatContextBlock(res);
}
