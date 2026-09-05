export interface MetricSample {
  name: string;
  value: number;
  ts: number;
}

const samples: MetricSample[] = [];
const MAX_SAMPLES = 5000;

export function recordGauge(name: string, value: number): void {
  samples.push({ name, value, ts: Date.now() });
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
}

export function recordTimer(name: string, startMs: number): number {
  const elapsed = Date.now() - startMs;
  recordGauge(name, elapsed);
  return elapsed;
}

export function snapshot(): MetricSample[] {
  return [...samples];
}

export function resetMetrics(): void {
  samples.length = 0;
}