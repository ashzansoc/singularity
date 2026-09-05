import type { WikiLogEntry } from './types.js';

const ENTRY_RE = /^## \[(\d{4}-\d{2}-\d{2})\] (\w+) \| (.+)$/;

export function formatLogEntry(entry: WikiLogEntry): string {
  const detail = entry.detail.trim();
  return `## [${entry.date}] ${entry.op} | ${entry.title}\n\n${detail}\n`;
}

export function parseLogEntries(text: string): WikiLogEntry[] {
  const entries: WikiLogEntry[] = [];
  const parts = text.split(/^## \[/m);
  for (const part of parts) {
    const block = part.startsWith('## [') ? part : `## [${part}`;
    const first = block.split('\n', 1)[0] ?? '';
    const m = first.match(ENTRY_RE);
    if (!m) {
      continue;
    }
    entries.push({
      date: m[1] ?? '',
      op: normalizeOp(m[2] ?? ''),
      title: (m[3] ?? '').trim(),
      detail: block.split('\n').slice(1).join('\n').trim(),
    });
  }
  return entries;
}

export function appendLog(existing: string, entry: WikiLogEntry): string {
  const base = existing.endsWith('\n') ? existing : `${existing}\n`;
  const header = base.includes('# Wiki Log')
    ? base
    : `# Wiki Log\n\nAppend-only timeline. Each entry starts with \`## [YYYY-MM-DD] <op> | <Title>\`.\n\n`;
  return `${header.replace(/\n+$/, '')}\n\n${formatLogEntry(entry)}\n`;
}

function normalizeOp(op: string): WikiLogEntry['op'] {
  switch (op) {
    case 'init':
    case 'ingest':
    case 'query':
    case 'lint':
    case 'file':
    case 'update':
      return op;
    default:
      return 'update';
  }
}
