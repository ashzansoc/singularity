import type { MemoryCandidate } from '../../domain/memory.js';

export interface MemoryIntelligenceProvider {
  extract(text: string, meta: { project_id: string; event_id: string }): Promise<MemoryCandidate | undefined>;
  consolidate(texts: string[]): Promise<string>;
  search(query: string, memories: string[]): Promise<string[]>;
}

export class LocalMemoryProvider implements MemoryIntelligenceProvider {
  async extract(
    _text: string,
    _meta: { project_id: string; event_id: string },
  ): Promise<MemoryCandidate | undefined> {
    return undefined;
  }

  async consolidate(texts: string[]): Promise<string> {
    const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
    if (uniq.length <= 1) {
      return uniq[0] ?? '';
    }
    return uniq.slice(0, 8).join(' ').slice(0, 800);
  }

  async search(query: string, memories: string[]): Promise<string[]> {
    const q = query.toLowerCase();
    return memories.filter((m) => m.toLowerCase().includes(q)).slice(0, 8);
  }
}

export class Mem0MemoryProvider implements MemoryIntelligenceProvider {
  constructor(
    private readonly apiKey?: string,
    private readonly baseUrl = 'https://api.mem0.ai',
  ) {}

  private readonly local = new LocalMemoryProvider();

  async extract(
    text: string,
    meta: { project_id: string; event_id: string },
  ): Promise<MemoryCandidate | undefined> {
    if (!this.apiKey) {
      return this.local.extract(text, meta);
    }
    try {
      await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/memories`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Token ${this.apiKey}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: text.slice(0, 4000) }],
          user_id: meta.project_id,
          metadata: { event_id: meta.event_id },
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      /* optional */
    }
    return this.local.extract(text, meta);
  }

  async consolidate(texts: string[]): Promise<string> {
    return this.local.consolidate(texts);
  }

  async search(query: string, memories: string[]): Promise<string[]> {
    if (!this.apiKey) {
      return this.local.search(query, memories);
    }
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/v1/memories/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Token ${this.apiKey}`,
        },
        body: JSON.stringify({ query, user_id: 'project' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return this.local.search(query, memories);
      }
      const json = (await res.json()) as { results?: Array<{ memory?: string }> };
      const hits = (json.results ?? []).map((r) => r.memory).filter((x): x is string => Boolean(x));
      return hits.length ? hits : this.local.search(query, memories);
    } catch {
      return this.local.search(query, memories);
    }
  }
}
