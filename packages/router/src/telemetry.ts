import type { TelemetryEvent } from './types.js';

export function emitTelemetry(
  onTelemetry: ((event: TelemetryEvent) => void) | undefined,
  event: Omit<TelemetryEvent, 'timestamp'> & { timestamp?: number },
): void {
  onTelemetry?.({
    ...event,
    timestamp: event.timestamp ?? Date.now(),
  });
}
