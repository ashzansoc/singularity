import type { WikiLintIssue, WikiLintResult, WikiPage } from './types.js';
import { extractWikilinks } from './search.js';
import { slugify } from './slug.js';

export function lintWiki(
  pages: WikiPage[],
  sourceCount: number,
): WikiLintResult {
  const contentPages = pages.filter(
    (p) => p.relPath !== 'index.md' && p.relPath !== 'log.md',
  );
  const byTitle = new Map<string, WikiPage>();
  for (const p of contentPages) {
    byTitle.set(p.frontmatter.title.trim().toLowerCase(), p);
  }

  const inbound = new Map<string, number>();
  for (const p of contentPages) {
    inbound.set(p.relPath, inbound.get(p.relPath) ?? 0);
  }

  const issues: WikiLintIssue[] = [];
  const missing = new Set<string>();

  for (const p of contentPages) {
    if (p.relPath !== 'overview.md' && p.relPath !== 'synthesis.md') {
      if (!p.frontmatter.about) {
        issues.push({
          kind: 'missing-frontmatter',
          relPath: p.relPath,
          detail: 'Missing `about` in frontmatter',
        });
      }
      if (
        p.frontmatter.category !== 'overview' &&
        p.frontmatter.category !== 'synthesis' &&
        p.frontmatter.category !== 'contradiction' &&
        (!p.frontmatter.derived_from || p.frontmatter.derived_from.length === 0)
      ) {
        issues.push({
          kind: 'missing-frontmatter',
          relPath: p.relPath,
          detail: 'Missing `derived_from` (every claim needs a raw source)',
        });
      }
    }

    const derived = p.frontmatter.derived_from ?? [];
    const onlyWiki = derived.length > 0 && derived.every((d) => isWikiDerived(d));
    if (onlyWiki) {
      issues.push({
        kind: 'self-grounding',
        relPath: p.relPath,
        detail: `derived_from only points at wiki pages: ${derived.join(', ')}`,
      });
    }

    if (p.frontmatter.status === 'stub') {
      issues.push({
        kind: 'stub',
        relPath: p.relPath,
        detail: `Stub page [[${p.frontmatter.title}]] — expand from its sources or leave as a gap`,
      });
    }

    for (const link of extractWikilinks(`${p.frontmatter.title}\n${p.body}`)) {
      const target = byTitle.get(link.trim().toLowerCase());
      if (!target) {
        missing.add(link.trim());
        issues.push({
          kind: 'broken-link',
          relPath: p.relPath,
          target: link.trim(),
          detail: `Wikilink [[${link.trim()}]] has no page`,
        });
        continue;
      }
      if (target.relPath !== p.relPath) {
        inbound.set(target.relPath, (inbound.get(target.relPath) ?? 0) + 1);
      }
    }
  }

  for (const p of contentPages) {
    const count = inbound.get(p.relPath) ?? 0;
    if (
      count === 0 &&
      p.relPath !== 'overview.md' &&
      p.relPath !== 'synthesis.md' &&
      p.relPath !== 'contradictions.md'
    ) {
      issues.push({
        kind: 'orphan',
        relPath: p.relPath,
        detail: `No inbound wikilinks to [[${p.frontmatter.title}]]`,
      });
    }
  }

  for (const title of missing) {
    issues.push({
      kind: 'missing-page',
      target: title,
      detail: `Important concept [[${title}]] is linked but has no page (suggested: ${slugify(title)}.md)`,
    });
  }

  const contradictions = contentPages.find(
    (p) => p.relPath === 'contradictions.md',
  );
  if (contradictions) {
    const bullets = (contradictions.body.match(/^[-*]\s+/gm) ?? []).length;
    if (bullets > 0) {
      issues.push({
        kind: 'contradiction',
        relPath: 'contradictions.md',
        detail: `${bullets} open contradiction bullet${bullets === 1 ? '' : 's'} — do not auto-resolve`,
      });
    }
  }

  const suggestions: string[] = [];
  if (sourceCount === 0) {
    suggestions.push('Ingest a first source (article, notes, transcript, paper).');
  }
  if (contentPages.filter((p) => p.frontmatter.category === 'entity').length === 0) {
    suggestions.push('No entity pages yet — ingest a source that names people, products, or systems.');
  }
  if (issues.some((i) => i.kind === 'orphan')) {
    suggestions.push('Link orphan pages from overview.md or related entity/concept pages.');
  }
  if (issues.some((i) => i.kind === 'stub')) {
    suggestions.push('Expand stub pages on the next ingest, or mark them review-due.');
  }
  if (!issues.some((i) => i.kind === 'contradiction') && sourceCount >= 2) {
    suggestions.push('After several sources, scan for disagreements and file them on contradictions.md.');
  }

  return {
    pageCount: contentPages.length,
    sourceCount,
    issues,
    suggestions,
  };
}

function isWikiDerived(ref: string): boolean {
  const n = ref.replace(/\\/g, '/');
  return (
    n.includes('/wiki/') ||
    n.startsWith('wiki/') ||
    n.startsWith('entities/') ||
    n.startsWith('concepts/') ||
    n.startsWith('sources/') ||
    n.startsWith('queries/')
  );
}
