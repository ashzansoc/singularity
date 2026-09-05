import { basename, extname, isAbsolute, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { WikiStore } from './store.js';
import { extractHeadings, extractWikilinks } from './search.js';
import { slugify, todayDate, titleCase, isStopWord } from './slug.js';
import type {
  IngestSourceInput,
  WikiIngestPlanItem,
  WikiIngestResult,
  WikiPageCategory,
} from './types.js';
import { redactSecrets } from './redact.js';

const ENTITY_STOP = new Set([
  'the',
  'this',
  'that',
  'these',
  'those',
  'when',
  'after',
  'before',
  'however',
  'therefore',
  'chapter',
  'section',
  'introduction',
  'conclusion',
  'overview',
  'abstract',
  'references',
  'appendix',
]);

export function ingestSource(
  store: WikiStore,
  input: IngestSourceInput,
): WikiIngestResult {
  const resolved = resolveSourceText(store.workspaceRoot, input);
  if (!resolved.ok) {
    return {
      skipped: true,
      reason: resolved.reason,
      takeaways: [],
      entities: [],
      concepts: [],
      pagesTouched: [],
      plan: [],
      logLine: '',
    };
  }

  const text = redactSecrets(resolved.text);
  const title =
    input.title?.trim() ||
    firstHeading(text) ||
    stemFilename(resolved.filename) ||
    'Untitled source';
  const slug = slugify(title);
  const ext = extname(resolved.filename || '') || '.md';

  let rawRelPath: string;
  if (resolved.absPath && existsSync(resolved.absPath)) {
    rawRelPath = store.copyRawFile(resolved.absPath, slug).relPath;
  } else {
    rawRelPath = store.writeRaw(slug, text, ext).relPath;
  }

  const takeaways = extractTakeaways(text);
  const headings = extractHeadings(text);
  const wikilinks = extractWikilinks(text);
  const entities = unique([
    ...wikilinks.filter((w) => looksLikeEntity(w)),
    ...extractEntityCandidates(text),
    ...headings.filter((h) => looksLikeEntity(h)),
  ]).slice(0, 12);
  const concepts = unique([
    ...wikilinks.filter((w) => !looksLikeEntity(w)),
    ...headings.filter((h) => !looksLikeEntity(h) && h.length > 3),
  ]).slice(0, 12);

  const pagesTouched: string[] = [];
  const plan: WikiIngestPlanItem[] = [];
  const date = todayDate();

  const sourceRel = `sources/${slug}.md`;
  const existingSource = store.readPage(sourceRel);
  const sourceBody = renderSourcePage({
    title,
    text,
    takeaways,
    entities,
    concepts,
    rawRelPath,
    url: input.url,
    notes: input.notes,
    previous: existingSource,
  });
  store.writePage(
    sourceRel,
    {
      title,
      category: 'source',
      about: title,
      derived_from: [rawRelPath],
      origin: 'asserted',
      status: 'active',
      updated: date,
      source_count: 1,
      summary: takeaways[0] || firstSentence(text) || `Summary of ${title}`,
      tags: ['source'],
    },
    sourceBody,
  );
  pagesTouched.push(sourceRel);
  plan.push({
    relPath: sourceRel,
    action: existingSource ? 'update' : 'create',
    title,
    category: 'source',
    reason: 'Source summary from ingest',
  });

  for (const name of entities) {
    touchNamedPage(store, {
      name,
      category: 'entity',
      rawRelPath,
      sourceTitle: title,
      takeaways,
      date,
      pagesTouched,
      plan,
    });
  }
  for (const name of concepts) {
    touchNamedPage(store, {
      name,
      category: 'concept',
      rawRelPath,
      sourceTitle: title,
      takeaways,
      date,
      pagesTouched,
      plan,
    });
  }

  bumpHubPage(store, 'overview.md', 'overview', 'Overview', rawRelPath, title, date);
  bumpHubPage(store, 'synthesis.md', 'synthesis', 'Synthesis', rawRelPath, title, date);
  pagesTouched.push('overview.md', 'synthesis.md');

  const logLine = `Copied to \`${rawRelPath}\`. Source page \`${sourceRel}\`. Entities: ${
    entities.map((e) => `[[${e}]]`).join(', ') || 'none'
  }. Concepts: ${concepts.map((c) => `[[${c}]]`).join(', ') || 'none'}.`;

  return {
    skipped: false,
    rawRelPath,
    sourcePageRelPath: sourceRel,
    takeaways,
    entities,
    concepts,
    pagesTouched: unique(pagesTouched),
    plan,
    logLine,
  };
}

function resolveSourceText(
  workspaceRoot: string,
  input: IngestSourceInput,
):
  | { ok: true; text: string; filename?: string; absPath?: string }
  | { ok: false; reason: string } {
  if (input.sourcePath) {
    const abs = isAbsolute(input.sourcePath)
      ? input.sourcePath
      : join(workspaceRoot, input.sourcePath);
    if (!existsSync(abs)) {
      return { ok: false, reason: `source_not_found:${input.sourcePath}` };
    }
    try {
      const buf = readFileSync(abs);
      if (buf.includes(0)) {
        return { ok: false, reason: 'binary_source' };
      }
      return {
        ok: true,
        text: buf.toString('utf8'),
        filename: basename(abs),
        absPath: abs,
      };
    } catch {
      return { ok: false, reason: 'unreadable_source' };
    }
  }
  if (input.text?.trim()) {
    return {
      ok: true,
      text: input.text,
      filename: input.filename,
    };
  }
  return { ok: false, reason: 'missing_source' };
}

function renderSourcePage(args: {
  title: string;
  text: string;
  takeaways: string[];
  entities: string[];
  concepts: string[];
  rawRelPath: string;
  url?: string;
  notes?: string;
  previous?: { body: string };
}): string {
  const entityLinks = args.entities.map((e) => `[[${e}]]`).join(', ') || '_(none detected)_';
  const conceptLinks = args.concepts.map((c) => `[[${c}]]`).join(', ') || '_(none detected)_';
  const takeawayBlock = args.takeaways.length
    ? args.takeaways.map((t) => `- ${t}`).join('\n')
    : `- See raw source (\`${args.rawRelPath}\`).`;
  const meta: string[] = [`Raw: \`${args.rawRelPath}\``];
  if (args.url) {
    meta.push(`URL: ${args.url}`);
  }
  if (args.notes) {
    meta.push(`Notes: ${args.notes}`);
  }
  const excerpt = firstSentence(args.text);
  return [
    `# ${args.title}`,
    '',
    meta.join(' · '),
    '',
    '## Key takeaways',
    '',
    takeawayBlock,
    '',
    '## Entities',
    '',
    entityLinks,
    '',
    '## Concepts',
    '',
    conceptLinks,
    '',
    '## Excerpt',
    '',
    `> ${excerpt}`,
    '',
    args.previous?.body.includes('## Agent notes')
      ? args.previous.body.split('## Agent notes')[1] ?? ''
      : '',
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');
}

function touchNamedPage(
  store: WikiStore,
  args: {
    name: string;
    category: 'entity' | 'concept';
    rawRelPath: string;
    sourceTitle: string;
    takeaways: string[];
    date: string;
    pagesTouched: string[];
    plan: WikiIngestPlanItem[];
  },
): void {
  const slug = slugify(args.name);
  const rel = `${args.category === 'entity' ? 'entities' : 'concepts'}/${slug}.md`;
  const existing = store.readPage(rel);
  const derived = unique([
    ...(existing?.frontmatter.derived_from ?? []),
    args.rawRelPath,
  ]);
  const section = `## From [[${args.sourceTitle}]]\n\n${
    args.takeaways
      .slice(0, 3)
      .map((t) => `- ${t}`)
      .join('\n') || `- Mentioned in [[${args.sourceTitle}]] (\`${args.rawRelPath}\`).`
  }\n`;
  let body: string;
  if (existing) {
    if (existing.body.includes(`## From [[${args.sourceTitle}]]`)) {
      body = existing.body;
    } else {
      body = `${existing.body.trim()}\n\n${section}`;
    }
  } else {
    body = `# ${args.name}\n\n${section}`;
  }
  store.writePage(
    rel,
    {
      title: args.name,
      category: args.category,
      about: args.name,
      derived_from: derived,
      origin: existing ? 'inferred' : 'asserted',
      status: existing ? 'active' : 'stub',
      updated: args.date,
      source_count: derived.length,
      summary:
        existing?.frontmatter.summary ||
        args.takeaways[0] ||
        `${args.category === 'entity' ? 'Entity' : 'Concept'} appearing in ingested sources`,
    },
    body,
  );
  args.pagesTouched.push(rel);
  args.plan.push({
    relPath: rel,
    action: existing ? 'update' : 'create',
    title: args.name,
    category: args.category,
    reason: `Mentioned in ${args.sourceTitle}`,
  });
}

function bumpHubPage(
  store: WikiStore,
  relPath: string,
  category: WikiPageCategory,
  title: string,
  rawRelPath: string,
  sourceTitle: string,
  date: string,
): void {
  const existing = store.readPage(relPath);
  if (!existing) {
    return;
  }
  const derived = unique([...existing.frontmatter.derived_from, rawRelPath]);
  const bullet = `- Ingested [[${sourceTitle}]] (\`${rawRelPath}\`)`;
  const body = existing.body.includes(bullet)
    ? existing.body
    : `${existing.body.trim()}\n\n${bullet}\n`;
  store.writePage(
    relPath,
    {
      ...existing.frontmatter,
      category,
      title: existing.frontmatter.title || title,
      derived_from: derived,
      updated: date,
      source_count: derived.length,
      status: derived.length ? 'active' : existing.frontmatter.status,
    },
    body,
  );
}

function extractTakeaways(text: string): string[] {
  const paras = text
    .replace(/^#+\s+.+$/gm, '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 40 && p.length < 400 && !p.startsWith('```'));
  return paras.slice(0, 5);
}

function extractEntityCandidates(text: string): string[] {
  const out: string[] = [];
  const re = /\b([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+){0,3})\b/g;
  for (const m of text.matchAll(re)) {
    const phrase = m[1]?.trim() ?? '';
    const first = phrase.split(/\s+/)[0] ?? '';
    if (!phrase || ENTITY_STOP.has(first.toLowerCase()) || isStopWord(first)) {
      continue;
    }
    if (phrase.length < 3 || phrase.length > 60) {
      continue;
    }
    out.push(phrase);
  }
  return unique(out).slice(0, 20);
}

function looksLikeEntity(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (!words.length || words.length > 4) {
    return false;
  }
  return words.every((w) => /^[A-Z0-9]/.test(w) && !ENTITY_STOP.has(w.toLowerCase()));
}

function firstHeading(text: string): string | undefined {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function firstSentence(text: string): string {
  const plain = text.replace(/^#+\s+.+$/gm, '').replace(/\s+/g, ' ').trim();
  return (plain.match(/^[^.!?]{12,180}[.!?]?/)?.[0] ?? plain.slice(0, 160)).trim();
}

function stemFilename(name?: string): string | undefined {
  if (!name) {
    return undefined;
  }
  return titleCase(
    basename(name, extname(name)).replace(/[-_]+/g, ' '),
  );
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

/** @internal used by query filing */
export function uniqueStrings(items: string[]): string[] {
  return unique(items);
}

export function firstHeadingOf(text: string): string | undefined {
  return firstHeading(text);
}
