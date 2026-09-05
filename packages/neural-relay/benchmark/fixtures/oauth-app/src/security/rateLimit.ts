import { logger } from '../telemetry/logger.js';

export interface RateRule {
  windowMs: number;
  maxHits: number;
}

const hitLog = new Map<string, number[]>();

export function rateLimit(key: string, rule: RateRule): boolean {
  const now = Date.now();
  const hits = (hitLog.get(key) ?? []).filter((t) => now - t < rule.windowMs);
  if (hits.length >= rule.maxHits) {
    logger.warn('rate limit hit', { key });
    return false;
  }
  hits.push(now);
  hitLog.set(key, hits);
  return true;
}

export function clearRateLimits(): void {
  hitLog.clear();
}