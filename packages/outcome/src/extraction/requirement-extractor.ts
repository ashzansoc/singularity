import { heuristicExtractRequirements, type ExtractedRequirementDraft } from './heuristic.js';

export interface RequirementExtractor {
  extract(text: string): Promise<ExtractedRequirementDraft[]>;
}

export class HeuristicRequirementExtractor implements RequirementExtractor {
  async extract(text: string): Promise<ExtractedRequirementDraft[]> {
    return heuristicExtractRequirements(text);
  }
}

/**
 * Optional Context/LangExtract adapter. Failures fall back to heuristics.
 * Intelligence plane only — never import from the coding hot path.
 */
export function createRequirementExtractor(opts?: {
  contextExtract?: (text: string) => Promise<Array<{ description: string }>>;
}): RequirementExtractor {
  if (!opts?.contextExtract) {
    return new HeuristicRequirementExtractor();
  }
  return {
    async extract(text: string) {
      try {
        const items = await opts.contextExtract!(text);
        if (!items.length) {
          return heuristicExtractRequirements(text);
        }
        const heuristic = heuristicExtractRequirements(text);
        return items.map((it, i) => {
          const h = heuristic[i] ?? heuristic[0];
          return {
            description: it.description,
            type: h?.type ?? 'functional',
            criticality: h?.criticality ?? 'HIGH',
            priority: h?.priority ?? 'high',
            source_text: it.description,
            constraints: h?.constraints ?? [],
          } satisfies ExtractedRequirementDraft;
        });
      } catch {
        return heuristicExtractRequirements(text);
      }
    },
  };
}
