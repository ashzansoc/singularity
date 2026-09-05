import type {
  ArchitectureResponse,
  ContextResponse,
  ImpactResponse,
  ProjectStatusResponse,
  SymbolHit,
} from './types.js';

export interface IntelligenceClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export class IntelligenceClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: IntelligenceClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 50;
  }

  async context(query: string): Promise<(ContextResponse & { prompt_block?: string }) | undefined> {
    try {
      const res = await timedFetch(
        `${this.baseUrl}/context?q=${encodeURIComponent(query)}`,
        { method: 'GET' },
        this.timeoutMs,
      );
      if (!res.ok) {
        return undefined;
      }
      return (await res.json()) as ContextResponse & { prompt_block?: string };
    } catch {
      return undefined;
    }
  }

  async search(query: string, limit?: number): Promise<SymbolHit[]> {
    try {
      const res = await timedFetch(
        `${this.baseUrl}/search`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query, limit }),
        },
        this.timeoutMs,
      );
      if (!res.ok) {
        return [];
      }
      const body = (await res.json()) as { hits?: SymbolHit[] };
      return body.hits ?? [];
    } catch {
      return [];
    }
  }

  async symbols(query: string, limit?: number): Promise<SymbolHit[]> {
    try {
      const res = await timedFetch(
        `${this.baseUrl}/symbols`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query, limit }),
        },
        this.timeoutMs,
      );
      if (!res.ok) {
        return [];
      }
      const body = (await res.json()) as { symbols?: SymbolHit[] };
      return body.symbols ?? [];
    } catch {
      return [];
    }
  }

  async impact(symbol: string, depth?: number): Promise<ImpactResponse | undefined> {
    try {
      const res = await timedFetch(
        `${this.baseUrl}/impact`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ symbol, depth }),
        },
        Math.max(this.timeoutMs, 80),
      );
      if (!res.ok) {
        return undefined;
      }
      return (await res.json()) as ImpactResponse;
    } catch {
      return undefined;
    }
  }

  async dependencies(symbol: string): Promise<ImpactResponse | undefined> {
    try {
      const res = await timedFetch(
        `${this.baseUrl}/dependencies?symbol=${encodeURIComponent(symbol)}`,
        { method: 'GET' },
        this.timeoutMs,
      );
      if (!res.ok) {
        return undefined;
      }
      return (await res.json()) as ImpactResponse;
    } catch {
      return undefined;
    }
  }

  async architecture(): Promise<ArchitectureResponse | undefined> {
    try {
      const res = await timedFetch(`${this.baseUrl}/architecture`, { method: 'GET' }, this.timeoutMs);
      if (!res.ok) {
        return undefined;
      }
      return (await res.json()) as ArchitectureResponse;
    } catch {
      return undefined;
    }
  }

  async projectStatus(): Promise<ProjectStatusResponse | undefined> {
    try {
      const res = await timedFetch(
        `${this.baseUrl}/project-status`,
        { method: 'GET' },
        Math.max(this.timeoutMs, 100),
      );
      if (!res.ok) {
        return undefined;
      }
      return (await res.json()) as ProjectStatusResponse;
    } catch {
      return undefined;
    }
  }

  async notifyFile(
    kind: 'FILE_CREATED' | 'FILE_MODIFIED' | 'FILE_DELETED',
    uri: string,
    referenced?: string[],
  ): Promise<void> {
    try {
      await timedFetch(
        `${this.baseUrl}/events`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, uri, referenced }),
        },
        this.timeoutMs,
      );
    } catch {
      /* never block */
    }
  }

  async applyLsp(
    relations: Array<{
      fromUri: string;
      toUri: string;
      kind: 'calls' | 'references' | 'defined_in' | 'implements' | 'extends';
      fromName?: string;
      toName?: string;
    }>,
  ): Promise<void> {
    if (!relations.length) {
      return;
    }
    try {
      await timedFetch(
        `${this.baseUrl}/lsp`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ relations }),
        },
        Math.max(this.timeoutMs, 200),
      );
    } catch {
      /* never block */
    }
  }

  async bootstrap(scope: 'full' | 'recent' = 'recent', paths?: string[]): Promise<number> {
    try {
      const res = await timedFetch(
        `${this.baseUrl}/bootstrap`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ scope, paths }),
        },
        scope === 'full' ? 120_000 : 30_000,
      );
      if (!res.ok) {
        return 0;
      }
      const body = (await res.json()) as { files?: number };
      return body.files ?? 0;
    } catch {
      return 0;
    }
  }

  async postCodingEvent(payload: {
    event_type: string;
    project_id?: string;
    changed_files?: string[];
    text?: string;
    session_id?: string;
    task_id?: string;
    commit_id?: string;
    mission_id?: string;
  }): Promise<void> {
    try {
      await timedFetch(
        `${this.baseUrl}/plane/coding-event`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
        this.timeoutMs,
      );
    } catch {
      /* never block */
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await timedFetch(`${this.baseUrl}/health`, { method: 'GET' }, 800);
      return res.ok;
    } catch {
      return false;
    }
  }

  async memorySnapshot(projectId: string): Promise<{ prompt_block?: string } | undefined> {
    try {
      const res = await timedFetch(
        `${this.baseUrl}/projects/${encodeURIComponent(projectId)}/memory/snapshot`,
        { method: 'GET' },
        Math.max(this.timeoutMs, 120),
      );
      if (!res.ok) {
        return undefined;
      }
      return (await res.json()) as { prompt_block?: string };
    } catch {
      return undefined;
    }
  }

  async listMemories(
    projectId: string,
    limit = 100,
  ): Promise<
    Array<{
      id: string;
      type?: string;
      title: string;
      content?: string;
      confidence?: number;
      source_type?: string;
      source_id?: string;
      created_at?: string;
      updated_at?: string;
      entities?: string[];
    }>
  > {
    try {
      const res = await timedFetch(
        `${this.baseUrl}/projects/${encodeURIComponent(projectId)}/memories?limit=${limit}`,
        { method: 'GET' },
        Math.max(this.timeoutMs, 200),
      );
      if (!res.ok) {
        return [];
      }
      const body = (await res.json()) as {
        memories?: Array<{
          id: string;
          type?: string;
          title: string;
          content?: string;
          confidence?: number;
          source_type?: string;
          source_id?: string;
          created_at?: string;
          updated_at?: string;
          entities?: string[];
        }>;
      };
      return body.memories ?? [];
    } catch {
      return [];
    }
  }

  async searchMemories(
    projectId: string,
    query: string,
    limit = 10,
  ): Promise<
    Array<{
      id: string;
      type?: string;
      title: string;
      content?: string;
      confidence?: number;
      score?: number;
      source_type?: string;
      source_id?: string;
      created_at?: string;
      updated_at?: string;
      entities?: string[];
    }>
  > {
    try {
      const res = await timedFetch(
        `${this.baseUrl}/projects/${encodeURIComponent(projectId)}/memories/search`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query, limit }),
        },
        Math.max(this.timeoutMs, 250),
      );
      if (!res.ok) {
        return [];
      }
      const body = (await res.json()) as {
        hits?: Array<{
          id: string;
          type?: string;
          title: string;
          content?: string;
          confidence?: number;
          score?: number;
          source_type?: string;
          source_id?: string;
          created_at?: string;
          updated_at?: string;
          entities?: string[];
        }>;
      };
      return body.hits ?? [];
    } catch {
      return [];
    }
  }

  async architectureGraph(
    entity = 'workspace',
    depth = 2,
  ): Promise<{
    nodes?: Array<{ id: string; label?: string; kind?: string }>;
    edges?: Array<{ id: string; from?: string; to?: string; kind?: string }>;
  } | undefined> {
    try {
      const res = await timedFetch(
        `${this.baseUrl}/architecture/graph?entity=${encodeURIComponent(entity)}&depth=${depth}`,
        { method: 'GET' },
        Math.max(this.timeoutMs, 200),
      );
      if (!res.ok) {
        return undefined;
      }
      const body = (await res.json()) as {
        nodes?: Array<{ id: string; label?: string; kind?: string }>;
        edges?: Array<{ id: string; from?: string; to?: string; kind?: string }>;
      };
      return body;
    } catch {
      return undefined;
    }
  }

  async architectureDecisions(): Promise<
    Array<{
      id: string;
      title: string;
      status?: string;
      decision?: { summary?: string };
      timestamps?: { updated_at?: string };
    }>
  > {
    try {
      const res = await timedFetch(`${this.baseUrl}/architecture/decisions`, { method: 'GET' }, Math.max(this.timeoutMs, 200));
      if (!res.ok) {
        return [];
      }
      const body = (await res.json()) as {
        decisions?: Array<{
          id: string;
          title: string;
          status?: string;
          decision?: { summary?: string };
          timestamps?: { updated_at?: string };
        }>;
      };
      return body.decisions ?? [];
    } catch {
      return [];
    }
  }

  async architectureDrifts(): Promise<Array<{ id: string; kind?: string; reason?: string; adr_id?: string }>> {
    try {
      const res = await timedFetch(`${this.baseUrl}/architecture/drift`, { method: 'GET' }, Math.max(this.timeoutMs, 200));
      if (!res.ok) {
        return [];
      }
      const body = (await res.json()) as {
        drifts?: Array<{ id: string; kind?: string; reason?: string; adr_id?: string }>;
      };
      return body.drifts ?? [];
    } catch {
      return [];
    }
  }

  async architectureConflicts(): Promise<Array<{ id: string; reason?: string; adr_id?: string }>> {
    try {
      const res = await timedFetch(`${this.baseUrl}/architecture/conflicts`, { method: 'GET' }, Math.max(this.timeoutMs, 200));
      if (!res.ok) {
        return [];
      }
      const body = (await res.json()) as {
        conflicts?: Array<{ id: string; reason?: string; adr_id?: string }>;
      };
      return body.conflicts ?? [];
    } catch {
      return [];
    }
  }
}
