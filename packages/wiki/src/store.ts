import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  copyFileSync,
  statSync,
} from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFrontmatter, stringifyFrontmatter } from './frontmatter.js';
import { relToPages, relToWorkspace, type WikiPaths } from './paths.js';
import { todayDate } from './slug.js';
import type { WikiFrontmatter, WikiMeta, WikiPage } from './types.js';

export class WikiStore {
  constructor(
    readonly workspaceRoot: string,
    readonly paths: WikiPaths,
  ) {}

  exists(): boolean {
    return existsSync(this.paths.schema) && existsSync(this.paths.pages);
  }

  ensureDirs(): void {
    for (const dir of [
      this.paths.root,
      this.paths.raw,
      this.paths.rawAssets,
      this.paths.pages,
      this.paths.sources,
      this.paths.entities,
      this.paths.concepts,
      this.paths.queries,
    ]) {
      mkdirSync(dir, { recursive: true });
    }
  }

  readMeta(): WikiMeta | undefined {
    if (!existsSync(this.paths.meta)) {
      return undefined;
    }
    try {
      return JSON.parse(readFileSync(this.paths.meta, 'utf8')) as WikiMeta;
    } catch {
      return undefined;
    }
  }

  writeMeta(meta: WikiMeta): void {
    writeFileSync(
      this.paths.meta,
      `${JSON.stringify(meta, null, 2)}\n`,
      'utf8',
    );
  }

  readText(absPath: string): string | undefined {
    if (!existsSync(absPath)) {
      return undefined;
    }
    return readFileSync(absPath, 'utf8');
  }

  writeText(absPath: string, text: string): void {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  }

  writePage(relPath: string, fm: WikiFrontmatter, body: string): WikiPage {
    const abs = join(this.paths.pages, ...relPath.split('/'));
    const raw = stringifyFrontmatter(fm, body);
    this.writeText(abs, raw);
    return {
      relPath,
      absPath: abs,
      frontmatter: fm,
      body,
      raw,
    };
  }

  readPage(relPath: string): WikiPage | undefined {
    const abs = join(this.paths.pages, ...relPath.split('/'));
    const raw = this.readText(abs);
    if (raw == null) {
      return undefined;
    }
    const { frontmatter, body } = parseFrontmatter(raw);
    return { relPath, absPath: abs, frontmatter, body, raw };
  }

  listPageFiles(): string[] {
    if (!existsSync(this.paths.pages)) {
      return [];
    }
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('.')) {
          continue;
        }
        const abs = join(dir, name);
        const st = statSync(abs);
        if (st.isDirectory()) {
          walk(abs);
          continue;
        }
        if (extname(name).toLowerCase() === '.md') {
          out.push(abs);
        }
      }
    };
    walk(this.paths.pages);
    return out.sort();
  }

  listPages(): WikiPage[] {
    return this.listPageFiles().map((abs) => {
      const relPath = relToPages(this.paths.pages, abs);
      const raw = readFileSync(abs, 'utf8');
      const { frontmatter, body } = parseFrontmatter(raw);
      return { relPath, absPath: abs, frontmatter, body, raw };
    });
  }

  listRawFiles(): string[] {
    if (!existsSync(this.paths.raw)) {
      return [];
    }
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('.')) {
          continue;
        }
        const abs = join(dir, name);
        const st = statSync(abs);
        if (st.isDirectory()) {
          walk(abs);
          continue;
        }
        out.push(abs);
      }
    };
    walk(this.paths.raw);
    return out.sort();
  }

  /**
   * Copy a source into raw/ immutably. If the same slug exists with different
   * content, write a content-hash suffix instead of overwriting.
   */
  writeRaw(slug: string, text: string, ext = '.md'): { relPath: string; absPath: string; existed: boolean } {
    this.ensureDirs();
    const hash = createHash('sha256').update(text).digest('hex').slice(0, 10);
    let filename = `${slug}${ext.startsWith('.') ? ext : `.${ext}`}`;
    let abs = join(this.paths.raw, filename);
    if (existsSync(abs)) {
      const existing = readFileSync(abs);
      const same =
        Buffer.isBuffer(existing) &&
        existing.toString('utf8') === text;
      if (same) {
        return {
          relPath: relToWorkspace(this.workspaceRoot, abs),
          absPath: abs,
          existed: true,
        };
      }
      filename = `${slug}-${hash}${ext.startsWith('.') ? ext : `.${ext}`}`;
      abs = join(this.paths.raw, filename);
    }
    this.writeText(abs, text);
    return {
      relPath: relToWorkspace(this.workspaceRoot, abs),
      absPath: abs,
      existed: false,
    };
  }

  copyRawFile(
    sourceAbs: string,
    slug: string,
  ): { relPath: string; absPath: string; existed: boolean } {
    this.ensureDirs();
    const ext = extname(sourceAbs) || '.md';
    let filename = `${slug}${ext}`;
    let dest = join(this.paths.raw, filename);
    const incoming = readFileSync(sourceAbs);
    if (existsSync(dest)) {
      const existing = readFileSync(dest);
      if (existing.equals(incoming)) {
        return {
          relPath: relToWorkspace(this.workspaceRoot, dest),
          absPath: dest,
          existed: true,
        };
      }
      const hash = createHash('sha256').update(incoming).digest('hex').slice(0, 10);
      filename = `${slug}-${hash}${ext}`;
      dest = join(this.paths.raw, filename);
    }
    copyFileSync(sourceAbs, dest);
    return {
      relPath: relToWorkspace(this.workspaceRoot, dest),
      absPath: dest,
      existed: false,
    };
  }

  relFromWorkspace(absPath: string): string {
    return relToWorkspace(this.workspaceRoot, absPath);
  }
}

export function emptyMeta(
  workspaceRoot: string,
  wikiRoot: string,
): WikiMeta {
  const now = todayDate();
  return {
    version: 1,
    created: now,
    last_updated: now,
    workspace_root: workspaceRoot,
    wiki_root: wikiRoot,
    source_count: 0,
    page_count: 0,
  };
}
