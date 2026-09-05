import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWikiEngine,
  extractWikilinks,
  parseFrontmatter,
  slugify,
  tokenize,
} from '../src/index.js';

const dirs: string[] = [];

function tmpWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'singularity-wiki-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('slugify + tokenize + wikilinks', () => {
  it('slugs titles', () => {
    expect(slugify('Connection Pooling')).toBe('connection-pooling');
    expect(slugify("Karpathy's LLM Wiki")).toBe('karpathys-llm-wiki');
  });

  it('extracts wikilinks', () => {
    expect(extractWikilinks('See [[PostgreSQL]] and [[Connection pooling|pools]].')).toEqual([
      'PostgreSQL',
      'Connection pooling',
    ]);
  });

  it('tokenizes for search', () => {
    expect(tokenize('PostgreSQL connection pooling')).toContain('postgresql');
  });
});

describe('frontmatter', () => {
  it('round-trips derived_from lists', () => {
    const raw = `---
title: PostgreSQL
category: entity
about: PostgreSQL
derived_from:
  - raw/using-postgres.md
origin: asserted
status: active
summary: Relational database
---

# PostgreSQL

Used by the project.
`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.title).toBe('PostgreSQL');
    expect(frontmatter.category).toBe('entity');
    expect(frontmatter.derived_from).toEqual(['raw/using-postgres.md']);
    expect(body).toMatch(/Used by the project/);
  });
});

describe('WikiEngine', () => {
  it('inits schema, index, log, and hub pages', () => {
    const root = tmpWorkspace();
    const wiki = createWikiEngine({ workspaceRoot: root });
    const init = wiki.init();
    expect(init.created).toBe(true);
    expect(wiki.initialized).toBe(true);
    expect(wiki.readSchema()).toMatch(/Never modify `raw\/`/);
    expect(wiki.readIndex()).toMatch(/# Wiki Index/);
    expect(wiki.status().pageCount).toBeGreaterThanOrEqual(3);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toMatch(/LLM Wiki/);
  });

  it('ingests a source into immutable raw + wiki pages', () => {
    const root = tmpWorkspace();
    const wiki = createWikiEngine({ workspaceRoot: root });
    const result = wiki.ingest({
      title: 'Using PostgreSQL',
      text: `# Using PostgreSQL

PostgreSQL is the primary database. Connection pooling keeps latency low.

We use PostgreSQL instead of Firebase for relational integrity.

## Connection pooling

PgBouncer sits in front of PostgreSQL.
`,
    });
    expect(result.skipped).toBe(false);
    expect(result.rawRelPath).toMatch(/raw\//);
    expect(result.sourcePageRelPath).toBe('sources/using-postgresql.md');
    expect(result.entities.some((e) => /PostgreSQL/i.test(e))).toBe(true);
    expect(result.concepts.some((c) => /pool/i.test(c))).toBe(true);
    expect(result.pagesTouched.length).toBeGreaterThan(2);

    const raw = readFileSync(join(root, result.rawRelPath!), 'utf8');
    expect(raw).toMatch(/PostgreSQL is the primary database/);

    const sourcePage = wiki.store.readPage('sources/using-postgresql.md');
    expect(sourcePage?.frontmatter.derived_from[0]).toMatch(/raw\//);
    expect(wiki.readIndex()).toMatch(/Using PostgreSQL/);
    expect(wiki.readLog().text).toMatch(/## \[.*\] ingest \| Using PostgreSQL/);
  });

  it('never overwrites a different raw source with the same slug', () => {
    const root = tmpWorkspace();
    const wiki = createWikiEngine({ workspaceRoot: root });
    wiki.ingest({ title: 'Notes', text: 'First version about AlphaTopic uniquely.' });
    const second = wiki.ingest({
      title: 'Notes',
      text: 'Second version about BetaTopic distinctly and much longer than the first.',
    });
    expect(second.rawRelPath).toMatch(/notes-/);
    expect(wiki.status().sourceCount).toBe(2);
  });

  it('queries the wiki and refuses ungrounded answers', () => {
    const root = tmpWorkspace();
    const wiki = createWikiEngine({ workspaceRoot: root });
    wiki.ingest({
      title: 'Stripe Billing',
      text: `# Stripe Billing

Stripe subscriptions bill monthly. Webhooks update invoice status.

## Webhooks

Invoice.paid marks the subscription active.
`,
    });
    const hit = wiki.query('How do Stripe webhooks update invoices?');
    expect(hit.noConfidentAnswer).toBe(false);
    expect(hit.hits[0]?.title).toMatch(/Stripe|Webhook/i);
    expect(hit.draft).toMatch(/wiki page/);

    const miss = wiki.query('xyzzyplugh quantum flux capacitor');
    expect(miss.noConfidentAnswer).toBe(true);
    expect(miss.draft).toMatch(/Do not invent/);
  });

  it('files a grounded query answer', () => {
    const root = tmpWorkspace();
    const wiki = createWikiEngine({ workspaceRoot: root });
    wiki.ingest({
      title: 'Auth Notes',
      text: `# Auth Notes\n\nGoogle login is required. Sessions last 14 days.\n`,
    });
    const filed = wiki.fileAnswer({
      question: 'How long do sessions last?',
      answer: 'Sessions last 14 days. (raw/auth-notes.md)',
      citations: ['raw/auth-notes.md'],
    });
    expect(filed.relPath).toBe('queries/how-long-do-sessions-last.md');
    expect(wiki.readIndex()).toMatch(/How long do sessions last/);
  });

  it('lints orphans, missing derived_from, and broken links', () => {
    const root = tmpWorkspace();
    const wiki = createWikiEngine({ workspaceRoot: root });
    wiki.init();
    wiki.store.writePage(
      'entities/orphan-corp.md',
      {
        title: 'Orphan Corp',
        category: 'entity',
        about: 'Orphan Corp',
        derived_from: [],
        status: 'stub',
        updated: '2026-08-12',
      },
      '# Orphan Corp\n\nSee also [[Missing Page]].\n',
    );
    const lint = wiki.lint();
    expect(lint.issues.some((i) => i.kind === 'orphan')).toBe(true);
    expect(lint.issues.some((i) => i.kind === 'broken-link')).toBe(true);
    expect(lint.issues.some((i) => i.kind === 'missing-frontmatter')).toBe(true);
    expect(wiki.formatLint(lint)).toMatch(/Wiki lint/);
  });

  it('ingests from a workspace file path', () => {
    const root = tmpWorkspace();
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(
      join(root, 'docs', 'paper.md'),
      '# Memex\n\nVannevar Bush described the Memex in 1945. Associative trails matter.\n',
      'utf8',
    );
    const wiki = createWikiEngine({ workspaceRoot: root });
    const result = wiki.ingest({ sourcePath: 'docs/paper.md' });
    expect(result.skipped).toBe(false);
    expect(result.takeaways.length).toBeGreaterThan(0);
    expect(wiki.search('Memex')[0]?.title).toMatch(/Memex/i);
  });

  it('injects a prompt context block after ingest', () => {
    const root = tmpWorkspace();
    const wiki = createWikiEngine({ workspaceRoot: root });
    wiki.ingest({
      title: 'Design Tokens',
      text: '# Design Tokens\n\nSyne is the display font. Manrope is the body font.\n',
    });
    const block = wiki.formatContextBlock('What fonts does the design system use?');
    expect(block.initialized).toBe(true);
    expect(block.systemBlock).toMatch(/SINGULARITY LLM WIKI/);
    expect(block.systemBlock).toMatch(/Design Tokens/);
  });

  it('respects disabled flag', () => {
    const root = tmpWorkspace();
    const wiki = createWikiEngine({
      workspaceRoot: root,
      flags: { wiki_enabled: false },
    });
    const result = wiki.ingest({ title: 'X', text: 'hello world this is a source about SomethingUnique' });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('disabled');
  });

  it('redacts secrets before writing raw', () => {
    const root = tmpWorkspace();
    const wiki = createWikiEngine({ workspaceRoot: root });
    const result = wiki.ingest({
      title: 'Secrets memo',
      text: '# Secrets memo\n\nRotate password=hunter2 immediately. Keep PostgreSQL online.\n',
    });
    expect(result.skipped).toBe(false);
    const rel = result.rawRelPath!;
    const abs = join(root, rel);
    const stored = readFileSync(abs, 'utf8');
    expect(stored).not.toContain('hunter2');
    expect(stored).toMatch(/REDACTED/);
  });
});
