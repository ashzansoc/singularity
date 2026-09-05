import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DESIGN_SOURCES, sourcesForQuery } from './catalog.js';
import type { DesignSource } from './types.js';

/** esbuild CJS bundles replace import.meta.url with `{}` — guard before new URL(). */
function resolvePackageRoot(): string {
	try {
		const metaUrl = import.meta.url;
		if (typeof metaUrl === 'string' && metaUrl.length > 0 && URL.canParse(metaUrl)) {
			return join(fileURLToPath(new URL('.', metaUrl)), '..');
		}
	} catch {
		/* bundled without import.meta */
	}
	try {
		const req = createRequire(__filename);
		return dirname(req.resolve('@singularity/design/package.json'));
	} catch {
		/* not installed as a package */
	}
	if (typeof __dirname === 'string') {
		const extRoot = join(__dirname, '..');
		if (existsSync(join(extRoot, 'knowledge'))) {
			return extRoot;
		}
	}
	return join(process.cwd(), 'packages', 'design');
}

const PACKAGE_ROOT = resolvePackageRoot();

export function designPackageRoot(): string {
  return PACKAGE_ROOT;
}

export function knowledgeDir(): string {
  return join(PACKAGE_ROOT, 'knowledge');
}

export function refsDir(): string {
  return join(PACKAGE_ROOT, 'refs');
}

export interface KnowledgeHit {
  sourceId: string;
  sourceName: string;
  path: string;
  snippet: string;
  kind: 'curated' | 'ref';
}

/**
 * Build a retrieval block for Qwen: curated knowledge + optional live ref snippets.
 */
export function retrieveDesignKnowledge(
  query: string,
  options: { limit?: number; maxChars?: number } = {},
): { sources: DesignSource[]; block: string; hits: KnowledgeHit[] } {
  const limit = options.limit ?? 4;
  const sources = sourcesForQuery(query, limit);
  return retrieveDesignKnowledgeForSources(
    sources.map((s) => s.id),
    { query, maxChars: options.maxChars ?? 10_000 },
  );
}

/** Retrieve knowledge for an explicit set of catalog source ids (active design tools). */
export function retrieveDesignKnowledgeForSources(
  sourceIds: string[],
  options: { query?: string; maxChars?: number } = {},
): { sources: DesignSource[]; block: string; hits: KnowledgeHit[] } {
  const maxChars = options.maxChars ?? 10_000;
  const query = options.query ?? sourceIds.join(' ');
  const sources = sourceIds
    .map((id) => DESIGN_SOURCES.find((s) => s.id === id))
    .filter(Boolean) as DesignSource[];
  const hits: KnowledgeHit[] = [];

  for (const source of sources) {
    if (source.knowledgeFile) {
      const curatedPath = join(knowledgeDir(), source.knowledgeFile);
      if (existsSync(curatedPath)) {
        const text = readFileSync(curatedPath, 'utf8');
        hits.push({
          sourceId: source.id,
          sourceName: source.name,
          path: relative(PACKAGE_ROOT, curatedPath),
          snippet: truncate(text, 2_400),
          kind: 'curated',
        });
      }
    }

    const refRoot = join(refsDir(), source.refDir);
    if (existsSync(refRoot)) {
      // Three.js: prefer examples; others: components/ui
      const fileLimit = source.id === 'threejs' ? 8 : 6;
      const files = listInterestingFiles(refRoot, fileLimit, source.id === 'threejs');
      for (const file of files) {
        try {
          const content = readFileSync(file, 'utf8');
          if (content.length < 40) continue;
          hits.push({
            sourceId: source.id,
            sourceName: source.name,
            path: relative(PACKAGE_ROOT, file),
            snippet: truncate(pickRelevantSlice(content, query), 1_200),
            kind: 'ref',
          });
        } catch {
          /* skip unreadable */
        }
      }
    }
  }

  let used = 0;
  const selected: KnowledgeHit[] = [];
  for (const hit of hits) {
    if (used >= maxChars) break;
    selected.push(hit);
    used += hit.snippet.length;
  }

  const catalogLines = [
    'Design Knowledge — active sources for this task',
    ...sources.map((s) => `- ${s.name}: ${s.bestUsedFor}`),
    '',
    'Retrieved references:',
  ];

  const body = selected
    .map(
      (h) =>
        `### ${h.sourceName} (${h.kind}) — ${h.path}\n\`\`\`\n${h.snippet}\n\`\`\``,
    )
    .join('\n\n');

  return {
    sources,
    hits: selected,
    block: `${catalogLines.join('\n')}\n\n${body}`.trim(),
  };
}

function listInterestingFiles(root: string, limit: number, preferThreeExamples = false): string[] {
  const out: string[] = [];
  const stack = [root];
  const interesting =
    /\.(tsx|ts|jsx|js|css|md)$/i;
  const skip = /node_modules|\.git|dist|build|coverage|\.next|storybook-static/;

  while (stack.length && out.length < limit) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    // Prefer three.js examples dirs when requested
    if (preferThreeExamples) {
      entries = [...entries].sort((a, b) => {
        const score = (n: string) =>
          /examples|webgl|jsm|fibers|canvas/i.test(n) ? 0 : 1;
        return score(a) - score(b);
      });
    }
    for (const name of entries) {
      if (out.length >= limit) break;
      const full = join(dir, name);
      if (skip.test(full)) continue;
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (/components|examples|apps|registry|ui|src|jsm/i.test(name) || st.mtimeMs) {
          stack.push(full);
        }
      } else if (interesting.test(name) && st.size < 80_000) {
        out.push(full);
      }
    }
  }
  return out;
}

function pickRelevantSlice(content: string, query: string): string {
  const lower = content.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3)
    .slice(0, 8);
  let bestIdx = 0;
  let bestScore = -1;
  for (const token of tokens) {
    const idx = lower.indexOf(token);
    if (idx >= 0 && (bestScore < 0 || idx < bestScore)) {
      bestScore = idx;
      bestIdx = Math.max(0, idx - 120);
    }
  }
  return content.slice(bestIdx, bestIdx + 1_800);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n…[truncated]`;
}
