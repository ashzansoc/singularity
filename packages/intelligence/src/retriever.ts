import type { GraphNode } from '@singularity/prompt';
import { fileIdFromUri, tokenize, uriToPath } from './hash.js';
import type {
  ContextItem,
  ContextResponse,
  GraphStore,
  ImpactResponse,
  LiveSourceProvider,
  StageStatus,
  SymbolHit,
} from './types.js';

function lexicalScore(query: string, text: string): number {
  const q = new Set(tokenize(query));
  if (!q.size) {
    return 0;
  }
  const toks = tokenize(text);
  let hit = 0;
  for (const t of toks) {
    if (q.has(t)) {
      hit++;
    }
  }
  const exact = text.toLowerCase().includes(query.toLowerCase()) ? 0.35 : 0;
  return Math.min(1, hit / q.size + exact);
}

function recencyScore(lastModified: number, now: number): number {
  const age = Math.max(0, now - lastModified);
  return Math.exp(-age / 86_400_000);
}

function materialize(node: GraphNode, live?: string): string {
  if (live) {
    return live.slice(0, 4_000);
  }
  const body = (node.content ?? '').slice(0, 3_000);
  const loc = node.meta?.uri
    ? ` // ${node.meta.uri}${node.meta.startLine != null ? `:${node.meta.startLine}` : ''}`
    : '';
  return body ? `[${node.kind}] ${node.label}${loc}\n${body}` : `[${node.kind}] ${node.label}${loc}`;
}

export interface RetrieveOptions {
  query: string;
  limit?: number;
  depth?: number;
  live?: LiveSourceProvider;
  architectureHints?: string[];
}

export function retrieveContext(store: GraphStore, opts: RetrieveOptions): ContextResponse {
  const now = Date.now();
  const limit = opts.limit ?? 16;
  const depth = opts.depth ?? 2;
  const q = opts.query;

  const symbolHits = store.findSymbols(q, { limit: 32 });
  const scored: ContextItem[] = [];
  const stale: string[] = [];
  const sources = new Set<string>();

  const consider = (node: GraphNode, extra: number) => {
    const uri = node.meta?.uri ? String(node.meta.uri) : node.kind === 'file' ? node.label : undefined;
    const fileId = uri ? fileIdFromUri(uri) : node.id;
    const meta = uri ? store.getFileMeta(uri) : undefined;
    let isStale = Boolean(meta?.stale || node.meta?.stale);
    let liveText: string | undefined;
    if (uri && opts.live) {
      const liveHash = opts.live.getContentHash(uri);
      if (liveHash && meta && liveHash !== meta.contentHash) {
        isStale = true;
        store.markStale(fileId, true);
        liveText = opts.live.getContent(uri);
        stale.push(uriToPath(uri));
      } else if (isStale) {
        liveText = opts.live.getContent(uri);
        if (uri) {
          stale.push(uriToPath(uri));
        }
      }
    }
    const symbol = lexicalScore(q, `${node.label} ${node.kind}`);
    const semantic = lexicalScore(q, `${node.label} ${node.content ?? ''}`);
    const recency = recencyScore(node.lastModified || now, now);
    const arch =
      opts.architectureHints?.some((h) =>
        `${node.label} ${node.content ?? ''}`.toLowerCase().includes(h.toLowerCase()),
      )
        ? 0.2
        : 0;
    const depBoost = extra;
    const score = symbol * 0.35 + semantic * 0.25 + recency * 0.15 + arch + depBoost;
    if (score <= 0.02 && extra <= 0) {
      return;
    }
    if (uri) {
      sources.add(uriToPath(uri));
    }
    scored.push({
      id: node.id,
      kind: node.kind,
      label: node.label,
      text: materialize(node, liveText),
      uri,
      score,
      stale: isStale,
    });
  };

  const seen = new Set<string>();
  for (const hit of symbolHits) {
    const node = store.getNode(hit.id);
    if (!node || seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    consider(node, hit.score * 0.2);
    const nb = store.neighborhood(node.id, Math.min(depth, 2), [
      'calls',
      'imports',
      'contains',
      'references',
      'depends_on',
      'tested_by',
      'affects',
    ]);
    for (const n of nb.nodes) {
      if (seen.has(n.id)) {
        continue;
      }
      seen.add(n.id);
      consider(n, 0.12);
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  const maxScore = top[0]?.score ?? 0;
  const stages = Object.fromEntries(
    store.listStages().map((s) => [s.name, s.status]),
  ) as Record<string, StageStatus | string>;
  const ast = store.getStage('ast');
  const freshness =
    ast?.status === 'complete'
      ? 'complete'
      : ast?.status === 'processing'
        ? 'partial'
        : 'bootstrap';
  const stageBoost =
    (ast?.progress ?? 0) * 0.4 + (store.getStage('scip')?.progress ?? 0) * 0.2;
  const confidence = Math.min(
    0.98,
    (maxScore > 0 ? 0.35 : 0.1) + Math.min(0.4, top.length / 12) + stageBoost,
  );

  return {
    context: top,
    confidence: Number(confidence.toFixed(3)),
    sources: [...sources].slice(0, 24),
    graph_depth: depth,
    index_freshness: freshness,
    stale: [...new Set(stale)],
    stages,
  };
}

export function impactForSymbol(store: GraphStore, symbol: string, depth = 2): ImpactResponse {
  const hits = store.findSymbols(symbol, { limit: 8 });
  const root = hits.find((h) => h.kind !== 'file') ?? hits[0];
  if (!root) {
    return { symbol, callers: [], callees: [], files: [], tests: [], depth };
  }
  const nb = store.neighborhood(root.id, depth, [
    'calls',
    'references',
    'imports',
    'tested_by',
    'contains',
    'affects',
  ]);
  const callers: SymbolHit[] = [];
  const callees: SymbolHit[] = [];
  const files = new Set<string>();
  const tests = new Set<string>();
  for (const e of nb.edges) {
    if (e.kind === 'calls' || e.kind === 'references') {
      if (e.to === root.id) {
        const n = store.getNode(e.from);
        if (n) {
          callers.push({
            id: n.id,
            name: n.label,
            kind: n.kind,
            uri: n.meta?.uri ? String(n.meta.uri) : undefined,
            score: 1,
          });
        }
      }
      if (e.from === root.id) {
        const n = store.getNode(e.to);
        if (n) {
          callees.push({
            id: n.id,
            name: n.label,
            kind: n.kind,
            uri: n.meta?.uri ? String(n.meta.uri) : undefined,
            score: 1,
          });
        }
      }
    }
  }
  for (const n of nb.nodes) {
    const uri = n.meta?.uri ? String(n.meta.uri) : n.kind === 'file' ? n.label : undefined;
    if (uri) {
      files.add(uriToPath(uri));
      if (n.kind === 'test' || /test|spec/i.test(uri)) {
        tests.add(uriToPath(uri));
      }
    }
  }
  return {
    symbol: root.name,
    callers,
    callees,
    files: [...files],
    tests: [...tests],
    depth,
  };
}

const PROMPT_BLOCK_BUDGET = 2_000;
const PROMPT_ITEM_CHARS = 500;
const PROMPT_ITEM_LIMIT = 6;

export function formatContextBlock(res: ContextResponse): string {
  if (!res.context.length) {
    return '';
  }
  const lines = [
    'Singularity Project Intelligence — compact code/graph context (precomputed, may be partial).',
    `confidence=${res.confidence} freshness=${res.index_freshness} graph_depth=${res.graph_depth}`,
    res.stale.length ? `stale_files=${res.stale.slice(0, 8).join(', ')}` : '',
    '',
  ];
  for (const item of res.context.slice(0, PROMPT_ITEM_LIMIT)) {
    lines.push(`### ${item.kind} ${item.label}${item.stale ? ' [STALE — using live source]' : ''}`);
    lines.push(item.text.slice(0, PROMPT_ITEM_CHARS));
    lines.push('');
    if (lines.join('\n').length >= PROMPT_BLOCK_BUDGET) {
      break;
    }
  }
  const block = lines.filter(Boolean).join('\n');
  return block.length > PROMPT_BLOCK_BUDGET ? block.slice(0, PROMPT_BLOCK_BUDGET) : block;
}
