/**
 * Optional SCIP / LSIF dump ingest → CALLS / REFERENCES / DEFINED_IN edges.
 */

import { readFileSync } from 'node:fs';
import { InMemoryContextGraph } from '@singularity/prompt';
import type { GraphStore } from './types.js';
import { fileIdFromUri } from './hash.js';

export interface ScipOccurrence {
  symbol?: string;
  symbol_roles?: number;
  range?: number[];
}

export interface ScipDocument {
  relative_path?: string;
  relativePath?: string;
  occurrences?: ScipOccurrence[];
  symbols?: Array<{ symbol?: string; documentation?: string[] }>;
}

export interface ScipIndex {
  documents?: ScipDocument[];
  metadata?: { project_root?: string };
}

const ROLE_DEFINITION = 1;
const ROLE_REFERENCE = 8;

export function parseScipJson(raw: string): ScipIndex {
  return JSON.parse(raw) as ScipIndex;
}

export function ingestScipDump(store: GraphStore, index: ScipIndex, workspaceRoot?: string): number {
  const docs = index.documents ?? [];
  let edges = 0;
  const defBySymbol = new Map<string, { fileId: string; uri: string }>();

  for (const doc of docs) {
    const rel = doc.relative_path ?? doc.relativePath ?? '';
    const uri = workspaceRoot
      ? `file://${workspaceRoot.replace(/\/$/, '')}/${rel}`
      : `file://${rel}`;
    const fileId = fileIdFromUri(uri);
    for (const occ of doc.occurrences ?? []) {
      const sym = occ.symbol;
      if (!sym) {
        continue;
      }
      const roles = occ.symbol_roles ?? 0;
      if (roles & ROLE_DEFINITION) {
        defBySymbol.set(sym, { fileId, uri });
      }
    }
  }

  for (const doc of docs) {
    const rel = doc.relative_path ?? doc.relativePath ?? '';
    const uri = workspaceRoot
      ? `file://${workspaceRoot.replace(/\/$/, '')}/${rel}`
      : `file://${rel}`;
    const fileId = fileIdFromUri(uri);
    for (const occ of doc.occurrences ?? []) {
      const sym = occ.symbol;
      if (!sym) {
        continue;
      }
      const def = defBySymbol.get(sym);
      if (!def || def.fileId === fileId) {
        continue;
      }
      const roles = occ.symbol_roles ?? 0;
      const kind = roles & ROLE_DEFINITION ? 'defined_in' : 'references';
      if (roles & ROLE_REFERENCE || !(roles & ROLE_DEFINITION)) {
        store.upsertEdges([
          {
            id: `e:scip:${fileId}->${def.fileId}:${sym.slice(0, 80)}`,
            from: fileId,
            to: def.fileId,
            kind: kind === 'defined_in' ? 'defined_in' : 'references',
            weight: 1,
          },
        ]);
        edges++;
      }
    }
  }

  if (!store.getNode('scip:index')) {
    store.upsertNodes([
      InMemoryContextGraph.makeNode({
        id: 'scip:index',
        kind: 'summary',
        label: 'SCIP index',
        content: `documents=${docs.length} edges=${edges}`,
      }),
    ]);
  }
  return edges;
}

export function ingestScipFile(store: GraphStore, path: string, workspaceRoot?: string): number {
  const raw = readFileSync(path, 'utf8');
  return ingestScipDump(store, parseScipJson(raw), workspaceRoot);
}

export function applyLspRelations(
  store: GraphStore,
  relations: Array<{
    fromUri: string;
    toUri: string;
    kind: 'calls' | 'references' | 'defined_in' | 'implements' | 'extends';
    fromName?: string;
    toName?: string;
  }>,
): number {
  let n = 0;
  for (const r of relations) {
    const from = fileIdFromUri(r.fromUri);
    const to = fileIdFromUri(r.toUri);
    store.upsertEdges([
      {
        id: `e:lsp:${r.kind}:${from}:${r.fromName ?? ''}->${to}:${r.toName ?? ''}`,
        from,
        to,
        kind: r.kind,
        weight: 1,
      },
    ]);
    n++;
  }
  return n;
}
