import type { WikiPage, WikiSearchHit } from './types.js';

const TOKEN_RE = /[a-z0-9]{2,}/g;

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN_RE) ?? []).filter((t) => t.length > 1);
}

export function searchPages(
  pages: WikiPage[],
  query: string,
  limit = 8,
): WikiSearchHit[] {
  const qTokens = tokenize(query);
  if (!qTokens.length) {
    return [];
  }
  const df = new Map<string, number>();
  const docs = pages
    .filter((p) => p.relPath !== 'index.md' && p.relPath !== 'log.md')
    .map((p) => {
      const titleTokens = tokenize(p.frontmatter.title);
      const headingTokens = tokenize(extractHeadings(p.body).join(' '));
      const bodyTokens = tokenize(`${p.frontmatter.summary ?? ''} ${p.body}`);
      const seen = new Set([...titleTokens, ...headingTokens, ...bodyTokens]);
      for (const t of seen) {
        df.set(t, (df.get(t) ?? 0) + 1);
      }
      return { page: p, titleTokens, headingTokens, bodyTokens };
    });
  const n = Math.max(docs.length, 1);
  const scored: WikiSearchHit[] = [];
  for (const doc of docs) {
    let score = 0;
    const tf = (tokens: string[], tok: string) =>
      tokens.reduce((a, t) => a + (t === tok ? 1 : 0), 0);
    for (const tok of qTokens) {
      const idf = Math.log(1 + n / (1 + (df.get(tok) ?? 0)));
      score += 5 * tf(doc.titleTokens, tok) * idf;
      score += 3 * tf(doc.headingTokens, tok) * idf;
      score += tf(doc.bodyTokens, tok) * idf;
    }
    if (score <= 0) {
      continue;
    }
    scored.push({
      relPath: doc.page.relPath,
      title: doc.page.frontmatter.title,
      category: doc.page.frontmatter.category,
      score: Number(score.toFixed(3)),
      excerpt: excerptAround(doc.page.body, qTokens),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function extractHeadings(body: string): string[] {
  return [...body.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1]?.trim() ?? '');
}

export function extractWikilinks(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    const title = m[1]?.trim();
    if (title) {
      out.add(title);
    }
  }
  return [...out];
}

function excerptAround(body: string, tokens: string[], radius = 90): string {
  const plain = body.replace(/\s+/g, ' ').trim();
  if (!plain) {
    return '';
  }
  const lower = plain.toLowerCase();
  let idx = -1;
  for (const t of tokens) {
    idx = lower.indexOf(t);
    if (idx >= 0) {
      break;
    }
  }
  if (idx < 0) {
    return plain.slice(0, radius * 2);
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(plain.length, idx + radius);
  return `${start > 0 ? '…' : ''}${plain.slice(start, end)}${end < plain.length ? '…' : ''}`;
}
