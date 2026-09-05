import { createHash } from 'node:crypto';

/** SHA-256 hex digest of UTF-8 content. */
export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Short stable hash prefix for logs / composite keys. */
export function shortHash(content: string, length = 16): string {
  return sha256(content).slice(0, length);
}

/**
 * Normalize prompt text for cache keys.
 * Preserves fenced code blocks; collapses whitespace elsewhere.
 */
export function normalizePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return '';
  }

  const parts: string[] = [];
  const fenceRe = /```[\s\S]*?```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(trimmed)) !== null) {
    const before = trimmed.slice(last, match.index);
    parts.push(collapseWhitespace(before));
    parts.push(match[0]);
    last = match.index + match[0].length;
  }
  parts.push(collapseWhitespace(trimmed.slice(last)));
  return parts.filter(Boolean).join('\n').trim();
}

function collapseWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export function buildResponseCacheKey(parts: {
  templateVersion: string;
  modelId: string;
  temperature: number;
  fingerprint: string;
  promptNormalized: string;
  workspaceId: string;
  schemaVersion?: number;
}): string {
  const schema = parts.schemaVersion ?? 1;
  const payload = [
    `v${schema}`,
    parts.workspaceId,
    parts.templateVersion,
    parts.modelId,
    String(parts.temperature),
    parts.fingerprint,
    parts.promptNormalized,
  ].join('\0');
  return `resp:${sha256(payload)}`;
}

export function buildRouteCacheKey(parts: {
  intent: string;
  mode: string;
  fpBucket: string;
  hasImages: boolean;
  requiresTools: boolean;
  promptNormalized: string;
  workspaceId: string;
  schemaVersion?: number;
}): string {
  const schema = parts.schemaVersion ?? 1;
  const promptHash = shortHash(parts.promptNormalized);
  const payload = [
    `v${schema}`,
    parts.workspaceId,
    parts.intent,
    parts.mode,
    parts.fpBucket,
    parts.hasImages ? '1' : '0',
    parts.requiresTools ? '1' : '0',
    promptHash,
  ].join('\0');
  return `route:${sha256(payload)}`;
}

/** Bucket fingerprint for semantic / routing soft matching. */
export function fingerprintBucket(fingerprint: string): string {
  return fingerprint.slice(0, 12);
}
