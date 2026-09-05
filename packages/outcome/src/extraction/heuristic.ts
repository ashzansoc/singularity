import type {
  OutcomeRequirementType,
  RequirementCriticality,
} from '../domain/types.js';

export interface ExtractedRequirementDraft {
  description: string;
  type: OutcomeRequirementType;
  criticality: RequirementCriticality;
  priority: 'high' | 'medium' | 'low';
  source_text: string;
  constraints: string[];
}

const TYPE_RULES: Array<{ re: RegExp; type: OutcomeRequirementType }> = [
  { re: /\b(http\s*401|invalid password|must reject|never store|plaintext|hashed?|jwt|auth)/i, type: 'security' },
  { re: /\b(p95|latency|throughput|ms\b|performance)/i, type: 'performance' },
  { re: /\b(ui|button|click|page|component)/i, type: 'ui' },
  { re: /\b(restart|recover|operational|deploy)/i, type: 'operational' },
  { re: /\b(node\.js|compatible|browser support)/i, type: 'compatibility' },
  { re: /\b(architecture|must use \w+service)/i, type: 'architectural' },
  { re: /\b(integrat|webhook|third.party)/i, type: 'integration' },
  { re: /\b(return http|status code|401|400|201|behavior)/i, type: 'behavioral' },
  { re: /\b(database|unique|email|password hash|persist)/i, type: 'data' },
  { re: /\b(reliab|retry|failover)/i, type: 'reliability' },
];

function classifyType(text: string): OutcomeRequirementType {
  for (const rule of TYPE_RULES) {
    if (rule.re.test(text)) {
      return rule.type;
    }
  }
  return 'functional';
}

function classifyCriticality(text: string, type: OutcomeRequirementType): RequirementCriticality {
  if (type === 'security' || /\b(must|never|critical|401|plaintext)\b/i.test(text)) {
    return 'CRITICAL';
  }
  if (/\b(should|unique|201|400)\b/i.test(text)) {
    return 'HIGH';
  }
  return 'MEDIUM';
}

function splitClauses(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|(?:,\s*(?:and\s+)?)|(?:\band\s+)/i)
    .map((s) => s.trim().replace(/^[. ,]+|[. ,]+$/g, ''))
    .filter((s) => s.length > 12);
}

/**
 * Deterministic extractor used when LangExtract is unavailable.
 */
export function heuristicExtractRequirements(text: string): ExtractedRequirementDraft[] {
  const clauses = splitClauses(text);
  const used = new Set<string>();
  const drafts: ExtractedRequirementDraft[] = [];
  const candidates = clauses.length > 0 ? clauses : [text.trim()];
  for (const clause of candidates) {
    const key = clause.toLowerCase();
    if (used.has(key)) {
      continue;
    }
    used.add(key);
    const type = classifyType(clause);
    const criticality = classifyCriticality(clause, type);
    drafts.push({
      description: clause,
      type,
      criticality,
      priority: criticality === 'CRITICAL' || criticality === 'HIGH' ? 'high' : 'medium',
      source_text: clause,
      constraints: /\bnever\b|\bmust not\b/i.test(clause) ? [clause] : [],
    });
  }
  if (drafts.length === 0 && text.trim()) {
    drafts.push({
      description: text.trim(),
      type: 'functional',
      criticality: 'HIGH',
      priority: 'high',
      source_text: text.trim(),
      constraints: [],
    });
  }
  return drafts;
}
