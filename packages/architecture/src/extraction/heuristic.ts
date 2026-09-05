import { redactSecrets } from '@singularity/context';
import {
  confidenceAction,
  inferFactorsFromText,
  scoreConfidence,
} from '../domain/adr/confidence.js';
import type { Adr } from '../domain/adr/schema.js';
import { nowIso } from '../domain/adr/schema.js';

export interface ExtractedCandidate {
  title: string;
  decision: string;
  problem: string;
  reasoning: string[];
  alternatives: Array<{ name: string; reason: string }>;
  constraints: string[];
  affected_components: string[];
  confidence: number;
  action: ReturnType<typeof confidenceAction>;
}

const DECISION_RE =
  /\b(?:we (?:decided|chose|selected|picked|are moving|moved)|use|switch to|migrate to|replace .+ with)\s+([^.;\n]{3,80})/gi;

export function heuristicExtractAdr(text: string): ExtractedCandidate | undefined {
  const cleaned = redactSecrets(text);
  const factors = inferFactorsFromText(cleaned);
  const confidence = scoreConfidence(factors);
  const action = confidenceAction(confidence);
  const decisions: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(DECISION_RE.source, 'gi');
  while ((m = re.exec(cleaned))) {
    decisions.push(m[1]!.trim());
  }
  const because = [
    ...cleaned.matchAll(/\bbecause\s+([^.;\n]{5,120})/gi),
  ].map((x) => x[1]!.trim());
  const instead = [
    ...cleaned.matchAll(/\binstead of\s+([^.;\n]{3,80})/gi),
  ].map((x) => x[1]!.trim());
  const rejected = [
    ...cleaned.matchAll(/\bwe rejected\s+([^.;\n]{3,80})/gi),
  ].map((x) => x[1]!.trim());
  if (!decisions.length && action === 'observation') {
    return {
      title: cleaned.slice(0, 80),
      decision: cleaned.slice(0, 200),
      problem: '',
      reasoning: because,
      alternatives: [...instead, ...rejected].map((name) => ({
        name,
        reason: 'mentioned as alternative',
      })),
      constraints: [],
      affected_components: [],
      confidence,
      action,
    };
  }
  if (!decisions.length) {
    return undefined;
  }
  const summary = decisions[0]!;
  return {
    title: summary.slice(0, 120),
    decision: summary,
    problem: because[0] ?? '',
    reasoning: because,
    alternatives: [...instead, ...rejected].map((name) => ({
      name,
      reason: 'rejected or replaced',
    })),
    constraints: because,
    affected_components: inferComponents(cleaned),
    confidence,
    action,
  };
}

function inferComponents(text: string): string[] {
  const hits = text.match(/\b[a-z][\w-]*(?:-service|-api|-worker|-gateway)\b/gi) ?? [];
  return [...new Set(hits.map((h) => h.toLowerCase()))].slice(0, 8);
}

export function candidateToAdr(
  projectId: string,
  id: string,
  c: ExtractedCandidate,
  extra?: Partial<Adr>,
): Adr {
  const ts = nowIso();
  const kind =
    c.action === 'observation'
      ? 'observation'
      : c.action === 'queue_review'
        ? 'candidate'
        : 'candidate';
  return {
    id,
    version: 1,
    project_id: projectId,
    title: c.title,
    status: 'proposed',
    problem: c.problem,
    decision: { summary: c.decision },
    context: [],
    goals: [],
    non_goals: [],
    reasoning: c.reasoning,
    alternatives: c.alternatives.map((a) => ({
      name: a.name,
      status: 'rejected',
      reason: a.reason,
    })),
    constraints: c.constraints,
    assumptions: [],
    tradeoffs: [],
    consequences: [],
    risks: [],
    affected_components: c.affected_components,
    dependencies: [],
    evidence: {
      commits: [],
      pull_requests: [],
      tests: [],
      documents: [],
      conversations: [],
      code: [],
      incidents: [],
      deployments: [],
      metrics: [],
    },
    confidence: c.confidence,
    confidence_factors: inferFactorsFromText(`${c.title} ${c.decision} ${c.reasoning.join(' ')}`),
    timestamps: { created_at: ts, updated_at: ts },
    relationships: { related: [] },
    validation: { status: 'pending' },
    provenance: [],
    record_kind: kind,
    ...extra,
  };
}
