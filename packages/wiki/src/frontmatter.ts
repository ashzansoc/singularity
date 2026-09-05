import type { WikiFrontmatter, WikiPageCategory } from './types.js';

const CATEGORIES = new Set<WikiPageCategory>([
  'overview',
  'synthesis',
  'source',
  'entity',
  'concept',
  'query',
  'contradiction',
  'other',
]);

export function parseFrontmatter(raw: string): {
  frontmatter: WikiFrontmatter;
  body: string;
} {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    const title = firstHeading(raw) || 'Untitled';
    return {
      frontmatter: {
        title,
        category: 'other',
        derived_from: [],
      },
      body: raw,
    };
  }
  const fm = parseYamlLite(m[1] ?? '');
  const title = String(fm.title ?? firstHeading(m[2] ?? '') ?? 'Untitled');
  const category = CATEGORIES.has(fm.category as WikiPageCategory)
    ? (fm.category as WikiPageCategory)
    : 'other';
  const derived = Array.isArray(fm.derived_from)
    ? fm.derived_from.map(String)
    : typeof fm.derived_from === 'string' && fm.derived_from
      ? [String(fm.derived_from)]
      : [];
  const tags = Array.isArray(fm.tags)
    ? fm.tags.map(String)
    : typeof fm.tags === 'string' && fm.tags
      ? [String(fm.tags)]
      : undefined;
  return {
    frontmatter: {
      title,
      category,
      about: fm.about ? String(fm.about) : undefined,
      derived_from: derived,
      origin:
        fm.origin === 'inferred' || fm.origin === 'asserted'
          ? fm.origin
          : undefined,
      status:
        fm.status === 'active' ||
        fm.status === 'stub' ||
        fm.status === 'review-due' ||
        fm.status === 'superseded'
          ? fm.status
          : undefined,
      updated: fm.updated ? String(fm.updated) : undefined,
      source_count:
        typeof fm.source_count === 'number'
          ? fm.source_count
          : fm.source_count
            ? Number(fm.source_count)
            : undefined,
      tags,
      summary: fm.summary ? String(fm.summary) : undefined,
    },
    body: m[2] ?? '',
  };
}

export function stringifyFrontmatter(
  fm: WikiFrontmatter,
  body: string,
): string {
  const lines = ['---', `title: ${yamlScalar(fm.title)}`, `category: ${fm.category}`];
  if (fm.about) {
    lines.push(`about: ${yamlScalar(fm.about)}`);
  }
  if (fm.derived_from.length) {
    lines.push('derived_from:');
    for (const d of fm.derived_from) {
      lines.push(`  - ${yamlScalar(d)}`);
    }
  } else {
    lines.push('derived_from: []');
  }
  if (fm.origin) {
    lines.push(`origin: ${fm.origin}`);
  }
  if (fm.status) {
    lines.push(`status: ${fm.status}`);
  }
  if (fm.updated) {
    lines.push(`updated: ${yamlScalar(fm.updated)}`);
  }
  if (fm.source_count != null && !Number.isNaN(fm.source_count)) {
    lines.push(`source_count: ${fm.source_count}`);
  }
  if (fm.tags?.length) {
    lines.push(`tags: [${fm.tags.map(yamlScalar).join(', ')}]`);
  }
  if (fm.summary) {
    lines.push(`summary: ${yamlScalar(fm.summary)}`);
  }
  lines.push('---', '', body.replace(/^\n+/, ''));
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function firstHeading(text: string): string | undefined {
  const m = text.match(/^#\s+(.+)$/m);
  return m?.[1]?.trim();
}

function yamlScalar(value: string): string {
  if (/[:#\[\]{},&*!|>'"%@`]/.test(value) || /^\s|\s$/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function parseYamlLite(block: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let listKey: string | undefined;
  const list: string[] = [];
  const flushList = () => {
    if (listKey) {
      out[listKey] = [...list];
      list.length = 0;
      listKey = undefined;
    }
  };
  for (const line of block.split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      list.push(unquote(item[1] ?? ''));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) {
      continue;
    }
    flushList();
    const key = kv[1] ?? '';
    const rawVal = (kv[2] ?? '').trim();
    if (rawVal === '' || rawVal === '[]') {
      if (rawVal === '[]') {
        out[key] = [];
      } else {
        listKey = key;
      }
      continue;
    }
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      out[key] = rawVal
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
      continue;
    }
    if (/^-?\d+(\.\d+)?$/.test(rawVal)) {
      out[key] = Number(rawVal);
      continue;
    }
    out[key] = unquote(rawVal);
  }
  flushList();
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    try {
      return JSON.parse(t.startsWith("'") ? `"${t.slice(1, -1).replace(/"/g, '\\"')}"` : t);
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}
