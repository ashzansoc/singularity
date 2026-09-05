import type { IntelligenceEngine } from './engine.js';
import { impactForSymbol } from './retriever.js';
import type { CodeImpactSlice } from '@singularity/architecture';
import { emptyCodeImpact, mergeCodeImpact } from '@singularity/architecture';

function sliceFromSymbol(engine: IntelligenceEngine, symbol: string, depth: number): CodeImpactSlice {
  const hit = impactForSymbol(engine.store, symbol, depth);
  return {
    symbols: hit.symbol ? [hit.symbol] : [symbol],
    callers: hit.callers.map((c) => c.name),
    callees: hit.callees.map((c) => c.name),
    files: hit.files,
    tests: hit.tests,
  };
}

/**
 * Intelligence-plane adapter. Architecture workers call this; coding never does.
 */
export function codeImpactFromEngine(engine: IntelligenceEngine) {
  return {
    impactForSymbols(symbols: string[], depth = 2): CodeImpactSlice {
      if (!symbols.length) {
        return emptyCodeImpact();
      }
      return mergeCodeImpact(symbols.map((s) => sliceFromSymbol(engine, s, depth)));
    },
    impactForFiles(files: string[], depth = 2): CodeImpactSlice {
      const names = new Set<string>();
      for (const f of files) {
        const base = f.replace(/\\/g, '/').split('/').pop() ?? f;
        const stem = base.replace(/\.[^.]+$/, '');
        for (const hit of engine.store.findSymbols(stem, { limit: 24 })) {
          const uri = hit.uri ?? '';
          if (uri.includes(f) || f.includes(uri) || hit.id.includes(f)) {
            names.add(hit.name);
          }
        }
        for (const n of engine.store.listNodes()) {
          const uri = n.meta?.uri ? String(n.meta.uri) : '';
          if (
            (uri.includes(f) || f.includes(uri)) &&
            (n.kind === 'function' || n.kind === 'class' || n.kind === 'method')
          ) {
            names.add(n.label);
          }
        }
      }
      const inner = names.size
        ? mergeCodeImpact([...names].slice(0, 32).map((s) => sliceFromSymbol(engine, s, depth)))
        : emptyCodeImpact();
      return { ...inner, files: [...new Set([...inner.files, ...files])] };
    },
  };
}
