import type { SourceType } from './memory.js';
import { DEFAULT_SOURCE_PRIORITY } from '../config/settings.js';

export function sourceQuality(sourceType: SourceType, table?: Record<string, number>): number {
  const t = table ?? DEFAULT_SOURCE_PRIORITY;
  return t[sourceType] ?? 0.4;
}

export function sourceBeats(
  incoming: SourceType,
  existing: SourceType,
  table?: Record<string, number>,
): boolean {
  return sourceQuality(incoming, table) > sourceQuality(existing, table);
}
