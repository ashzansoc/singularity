import type { StoredProductionEvent } from '../memory/decisionStore.js';
import type { StoredRiskAssessment } from './types.js';

export function productionWatermark(events: StoredProductionEvent[]): string {
  if (!events.length) {
    return '0';
  }
  let max = events[0]!.timestamp;
  for (const e of events) {
    if (e.timestamp > max) {
      max = e.timestamp;
    }
  }
  return `${events.length}:${max}`;
}

export function isRiskStale(
  row: StoredRiskAssessment,
  architectureVersion: number,
  watermark: string,
): boolean {
  if (row.status !== 'completed') {
    return false;
  }
  let src: { architecture_version?: number; production_watermark?: string } = {};
  try {
    src = row.source_versions ? (JSON.parse(row.source_versions) as typeof src) : {};
  } catch {
    src = {};
  }
  if (src.architecture_version != null && src.architecture_version !== architectureVersion) {
    return true;
  }
  if (src.production_watermark != null && src.production_watermark !== watermark) {
    return true;
  }
  return false;
}
