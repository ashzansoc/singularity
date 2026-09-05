import { estimateTokens } from '../hash.js';
import type { EgressEntry, ModelRole } from '../types.js';
import type { NeuralRelayStore } from '../store.js';

export function logEgress(
  store: NeuralRelayStore | undefined,
  entry: EgressEntry,
): void {
  const line = JSON.stringify({
    ts: new Date(entry.ts).toISOString(),
    role: entry.role,
    model: entry.model,
    files: entry.files,
    estimatedTokens: entry.estimatedTokens,
  });
  console.log(`[neural-relay] egress ${line}`);
  store?.appendEgressLog(line);
}

export function makeEgress(
  model: string,
  role: ModelRole,
  files: string[],
  text: string,
): EgressEntry {
  return {
    model,
    role,
    files: [...new Set(files)],
    estimatedTokens: estimateTokens(text),
    ts: Date.now(),
  };
}
