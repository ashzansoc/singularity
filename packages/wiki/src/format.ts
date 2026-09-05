import type { WikiIndexEntry, WikiSearchHit, WikiStatus } from './types.js';

export function formatWikiContextBlock(args: {
  status: WikiStatus;
  indexEntries: WikiIndexEntry[];
  relevant?: WikiSearchHit[];
  schemaRelPath: string;
}): string {
  const lines = [
    'SINGULARITY LLM WIKI (persistent compounding knowledge base)',
    '─'.repeat(28),
    `Root: ${args.status.wikiRoot} · pages ${args.status.pageCount} · sources ${args.status.sourceCount}`,
    `Schema: ${args.schemaRelPath}`,
    'Read wiki/index.md first. Never modify raw/. File good grounded answers back.',
  ];

  const byCat = new Map<string, WikiIndexEntry[]>();
  for (const e of args.indexEntries) {
    const list = byCat.get(e.category) ?? [];
    list.push(e);
    byCat.set(e.category, list);
  }
  for (const category of [
    'overview',
    'synthesis',
    'source',
    'entity',
    'concept',
    'query',
    'contradiction',
  ]) {
    const group = byCat.get(category);
    if (!group?.length) {
      continue;
    }
    lines.push(`${category.toUpperCase()}:`);
    for (const e of group.slice(0, 12)) {
      lines.push(`- [[${e.title}]] (${e.relPath}) — ${e.summary}`);
    }
    if (group.length > 12) {
      lines.push(`- … ${group.length - 12} more`);
    }
  }

  if (args.relevant?.length) {
    lines.push('RELEVANT TO CURRENT TASK:');
    for (const h of args.relevant.slice(0, 6)) {
      lines.push(`- [[${h.title}]] (${h.relPath}, score ${h.score}) ${h.excerpt}`);
    }
  }

  return lines.join('\n');
}

export function formatLintReport(result: {
  pageCount: number;
  sourceCount: number;
  issues: Array<{ kind: string; relPath?: string; target?: string; detail: string }>;
  suggestions: string[];
}): string {
  const lines = [
    `# Wiki lint`,
    '',
    `${result.pageCount} pages · ${result.sourceCount} raw sources · ${result.issues.length} issues`,
    '',
  ];
  if (!result.issues.length) {
    lines.push('No issues found.');
  } else {
    for (const issue of result.issues.slice(0, 80)) {
      const loc = issue.relPath ? `\`${issue.relPath}\`` : issue.target ? `[[${issue.target}]]` : '';
      lines.push(`- **${issue.kind}** ${loc} — ${issue.detail}`);
    }
  }
  if (result.suggestions.length) {
    lines.push('', '## Suggestions', '');
    for (const s of result.suggestions) {
      lines.push(`- ${s}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
