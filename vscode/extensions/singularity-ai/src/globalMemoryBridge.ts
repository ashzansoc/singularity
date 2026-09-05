/**
 * Global user memory — persists across workspaces and IDE windows.
 * Complements Singularity /memories/ files and Singularity Brain (globalStorage).
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { getBrainEngine } from './brainBridge.js';

const MEMORY_BASE_DIR = 'memory-tool/memories';
const USER_PROFILE_FILE = 'user-profile.md';
const MAX_IDENTITY_MEMORY_CHARS = 8_000;

const IDENTITY_MEMORY_FILES = new Set([
  'user-profile.md',
  'profile.md',
  'identity.md',
  'about-me.md',
]);

function isIdentityMemoryFile(name: string): boolean {
  const lower = name.toLowerCase();
  return IDENTITY_MEMORY_FILES.has(lower) || /^user-?profile\.md$/i.test(name);
}

function memoryDir(context: vscode.ExtensionContext): string {
  return join(context.globalStorageUri.fsPath, MEMORY_BASE_DIR);
}

function readIdentityMemoryMarkdown(context: vscode.ExtensionContext): string {
  const dir = memoryDir(context);
  try {
    if (!statSync(dir).isDirectory()) {
      return '';
    }
  } catch {
    return '';
  }

  const lines: string[] = [];
  const names = readdirSync(dir)
    .filter((name) => !name.startsWith('.') && isIdentityMemoryFile(name))
    .sort((a, b) => {
      if (a === 'user-profile.md') {
        return -1;
      }
      if (b === 'user-profile.md') {
        return 1;
      }
      return a.localeCompare(b);
    });

  for (const name of names) {
    const path = join(dir, name);
    try {
      if (!statSync(path).isFile()) {
        continue;
      }
    } catch {
      continue;
    }
    const text = readFileSync(path, 'utf8').trim();
    if (!text) {
      continue;
    }
    lines.push(`## ${name}`, text);
    if (lines.join('\n').length >= MAX_IDENTITY_MEMORY_CHARS) {
      break;
    }
  }
  return lines.join('\n').slice(0, MAX_IDENTITY_MEMORY_CHARS);
}

/** Heuristic: user is sharing durable identity / profile facts. */
export function chatSharesUserIdentity(text: string): boolean {
  const t = text.trim();
  if (t.length < 12) {
    return false;
  }
  return (
    /\b(i am|i'm|my name is|call me|i made|i built|i created|i own|i work at|born on|years? old)\b/i.test(t)
    || /\b(you(r)? creator|your creator|remember (this|who i am|me))\b/i.test(t)
  );
}

function mergeProfileMarkdown(existing: string, addition: string): string {
  const block = addition.trim();
  if (!block) {
    return existing;
  }
  if (!existing.trim()) {
    return `# User profile\n\n${block}\n`;
  }
  if (existing.includes(block)) {
    return existing;
  }
  return `${existing.trim()}\n\n${block}\n`;
}

function persistUserProfile(context: vscode.ExtensionContext, text: string): boolean {
  const dir = memoryDir(context);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, USER_PROFILE_FILE);
  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    /* new file */
  }
  const merged = mergeProfileMarkdown(existing, text.trim());
  if (merged === existing) {
    return false;
  }
  writeFileSync(path, merged, 'utf8');
  return true;
}

export function startGlobalMemoryBridge(context: vscode.ExtensionContext): void {
  const readBlock = async (req?: { task?: string; scope?: 'identity' | 'all' }): Promise<string> => {
    const scope = req?.scope ?? 'identity';
    const userMem = scope === 'identity' ? readIdentityMemoryMarkdown(context) : readIdentityMemoryMarkdown(context);
    const eng = getBrainEngine();
    let brainBlock = '';
    if (eng) {
      try {
        const query =
          req?.task?.trim()
          || 'user identity name profile company role creator preferences who is the user';
        brainBlock = await eng.relevantContext(query, scope === 'identity' ? 900 : 1_200);
      } catch {
        brainBlock = '';
      }
    }
    const chunks: string[] = [];
    if (userMem) {
      chunks.push(
        [
          'USER PROFILE (identity only — exclude topic notes like canva-imports.md):',
          userMem,
        ].join('\n'),
      );
    }
    if (brainBlock) {
      chunks.push(brainBlock);
    }
    return chunks.join('\n\n');
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'singularity.ai.globalMemory.block',
      async (req?: { task?: string; scope?: 'identity' | 'all' }) => ({ ok: true, block: await readBlock(req) }),
    ),
    vscode.commands.registerCommand(
      'singularity.ai.globalMemory.extractFromChat',
      (req?: { text?: string }) => {
        const text = req?.text?.trim();
        if (!text || !chatSharesUserIdentity(text)) {
          return { ok: false, wrote: false };
        }
        const wrote = persistUserProfile(context, text);
        return { ok: true, wrote };
      },
    ),
  );
}
