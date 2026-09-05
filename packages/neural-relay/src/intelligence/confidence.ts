import type { NeuralRelayFlags } from '../flags.js';
import type { ConfidenceAction } from '../types.js';

export function confidenceAction(
  confidence: number,
  flags: Pick<NeuralRelayFlags, 'confidenceHigh' | 'confidenceLow'>,
): ConfidenceAction {
  if (confidence >= flags.confidenceHigh) {
    return 'use_selected';
  }
  if (confidence >= flags.confidenceLow) {
    return 'retrieve_more';
  }
  return 'fallback_broader';
}
