import { LangExtractSidecarClient } from '@singularity/context';
import { heuristicExtractAdr, type ExtractedCandidate } from './heuristic.js';
import { confidenceAction, inferFactorsFromText, scoreConfidence } from '../domain/adr/confidence.js';

/**
 * ADR extraction via LangExtract sidecar. Falls back to heuristics.
 * Intelligence plane only — never import from coding LLM path.
 */
export class AdrExtractor {
  private readonly client: LangExtractSidecarClient;
  private readonly fallback: boolean;

  constructor(opts?: { client?: LangExtractSidecarClient; fallback?: boolean }) {
    this.client = opts?.client ?? new LangExtractSidecarClient();
    this.fallback = opts?.fallback !== false;
  }

  async extract(text: string): Promise<ExtractedCandidate | undefined> {
    try {
      const res = await this.client.extract(
        {
          text,
          source_metadata: { type: 'conversation' },
          complexity: text.length > 4000 ? 'large_document' : 'simple',
        },
        undefined,
      );
      const decisions = res.delta?.architecture_decisions;
      if (res.ok && decisions?.length) {
        const d = decisions[0]!;
        const blob = `${d.decision} ${d.rationale ?? ''} ${(d.alternatives_rejected ?? []).join(' ')}`;
        const factors = inferFactorsFromText(blob);
        const confidence = scoreConfidence(factors);
        return {
          title: d.decision.slice(0, 120),
          decision: d.decision,
          problem: d.rationale ?? '',
          reasoning: d.rationale ? [d.rationale] : [],
          alternatives: (d.alternatives_rejected ?? []).map((name) => ({
            name,
            reason: 'rejected',
          })),
          constraints: [],
          affected_components: [],
          confidence,
          action: confidenceAction(confidence),
        };
      }
    } catch {
      /* fallback */
    }
    if (!this.fallback) {
      return undefined;
    }
    return heuristicExtractAdr(text);
  }
}
