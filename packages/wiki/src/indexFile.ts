import type { WikiIndexEntry, WikiPage, WikiPageCategory } from './types.js';

const CATEGORY_HEADINGS: Array<{ category: WikiPageCategory; heading: string }> =
  [
    { category: 'overview', heading: 'Overview' },
    { category: 'synthesis', heading: 'Synthesis' },
    { category: 'contradiction', heading: 'Contradictions' },
    { category: 'source', heading: 'Sources' },
    { category: 'entity', heading: 'Entities' },
    { category: 'concept', heading: 'Concepts' },
    { category: 'query', heading: 'Queries' },
    { category: 'other', heading: 'Other' },
  ];

export function indexEntriesFromPages(pages: WikiPage[]): WikiIndexEntry[] {
  return pages
    .filter((p) => p.relPath !== 'index.md' && p.relPath !== 'log.md')
    .map((p) => ({
      relPath: p.relPath,
      title: p.frontmatter.title,
      category: p.frontmatter.category,
      summary:
        p.frontmatter.summary?.trim() ||
        firstSentence(p.body) ||
        '_(no summary)_',
      updated: p.frontmatter.updated,
      source_count: p.frontmatter.source_count,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function renderIndexMd(entries: WikiIndexEntry[]): string {
  const lines = [
    '# Wiki Index',
    '',
    'Catalog of this LLM wiki. Updated on every ingest. Read this first when querying.',
    '',
  ];
  for (const { category, heading } of CATEGORY_HEADINGS) {
    const group = entries.filter((e) => e.category === category);
    lines.push(`## ${heading}`, '');
    if (!group.length) {
      lines.push('_(none yet)_', '');
      continue;
    }
    for (const e of group) {
      const meta: string[] = [];
      if (e.updated) {
        meta.push(e.updated);
      }
      if (e.source_count != null) {
        meta.push(`${e.source_count} source${e.source_count === 1 ? '' : 's'}`);
      }
      const suffix = meta.length ? ` (${meta.join(', ')})` : '';
      lines.push(`- [[${e.title}]] — ${e.summary}${suffix}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function firstSentence(body: string): string {
  const text = body
    .replace(/^#+\s+.+$/gm, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_]/g, '')
    .trim();
  if (!text) {
    return '';
  }
  const m = text.match(/^[^.!?\n]{8,180}[.!?]?/);
  return (m?.[0] ?? text.slice(0, 140)).replace(/\s+/g, ' ').trim();
}
