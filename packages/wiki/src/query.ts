import type { WikiPage, WikiQueryResult } from './types.js';
import { searchPages } from './search.js';

const CONFIDENT_SCORE = 2.5;

export function queryWiki(
  pages: WikiPage[],
  question: string,
  limit = 6,
): WikiQueryResult {
  const hits = searchPages(pages, question, limit);
  const noConfidentAnswer =
    hits.length === 0 || (hits[0]?.score ?? 0) < CONFIDENT_SCORE;
  const citations = hits.map((h) => h.relPath);
  const draft = noConfidentAnswer
    ? buildNoAnswer(question, hits)
    : buildDraft(question, pages, hits);
  return {
    question,
    hits,
    draft,
    citations,
    noConfidentAnswer,
  };
}

function buildDraft(
  question: string,
  pages: WikiPage[],
  hits: WikiQueryResult['hits'],
): string {
  const lines = [
    `## Query`,
    '',
    `**${question.trim()}**`,
    '',
    `Grounded in ${hits.length} wiki page${hits.length === 1 ? '' : 's'}:`,
    '',
  ];
  for (const hit of hits) {
    const page = pages.find((p) => p.relPath === hit.relPath);
    const derived = page?.frontmatter.derived_from?.length
      ? ` · raw: ${page.frontmatter.derived_from.map((d) => `\`${d}\``).join(', ')}`
      : '';
    lines.push(`### [[${hit.title}]] (\`${hit.relPath}\`)`);
    lines.push('');
    lines.push(hit.excerpt || page?.frontmatter.summary || '_(no excerpt)_');
    lines.push('');
    lines.push(`_category: ${hit.category}${derived}_`);
    lines.push('');
  }
  lines.push(
    '_Agent: synthesize a cited answer from these pages. File it back only if grounded._',
  );
  return lines.join('\n');
}

function buildNoAnswer(
  question: string,
  hits: WikiQueryResult['hits'],
): string {
  const lines = [
    `No confident wiki answer for: **${question.trim()}**.`,
    '',
    'The wiki does not yet have enough grounded coverage. Do not invent an answer or file one back.',
  ];
  if (hits.length) {
    lines.push('', 'Weak matches (below threshold):');
    for (const h of hits.slice(0, 4)) {
      lines.push(`- [[${h.title}]] (\`${h.relPath}\`, score ${h.score})`);
    }
  }
  lines.push('', 'Suggest ingesting a source that covers this question.');
  return lines.join('\n');
}
