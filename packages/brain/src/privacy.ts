/**
 * Privacy boundary: minimize context before remote Brain model calls.
 * Never send the lifetime Brain automatically.
 */

import type { BrainConfig } from './types.js';

export interface MinimizedContext {
  brief: string;
  truncated: boolean;
  originalChars: number;
  sentChars: number;
}

/** Cap and scrub a reflection brief before it leaves the machine. */
export function minimizeForRemote(text: string, cfg: BrainConfig, hardCap?: number): MinimizedContext {
  const cap = hardCap ?? cfg.contextLimit;
  const originalChars = text.length;
  let brief = text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key["\s:=]+[A-Za-z0-9_\-]{8,}/gi, 'api_key=[redacted]')
    .replace(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g, '[credential block redacted]');

  let truncated = false;
  if (brief.length > cap) {
    const marker = '\n…[truncated for privacy/budget]';
    brief = `${brief.slice(0, Math.max(0, cap - marker.length))}${marker}`;
    truncated = true;
  }
  return { brief, truncated, originalChars, sentChars: brief.length };
}

/** Build a small local retrieval pack string from labeled sections. */
export function packSections(sections: Array<{ title: string; lines: string[] }>, maxChars: number): string {
  const parts: string[] = [];
  let used = 0;
  for (const s of sections) {
    if (!s.lines.length) {
      continue;
    }
    const block = `${s.title}:\n${s.lines.map((l) => `  - ${l}`).join('\n')}`;
    if (used + block.length > maxChars) {
      break;
    }
    parts.push(block);
    used += block.length;
  }
  return parts.join('\n');
}
