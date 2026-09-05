import type { MemoryCandidate, MemoryScope, MemoryType, SourceType } from '../domain/memory.js';
import { MemoryCandidateSchema } from '../domain/memory.js';
import { redactSecrets, shouldRedact } from './secrets.js';

const RENAME_ONLY =
  /\b(renamed|rename)\b.*\b(variable|identifier|symbol)\b|\bchanged variable name\b/i;

const ARCH =
  /\b(postgres|postgresql|mysql|mongodb|redis|kafka|temporal|auth0|firebase|saml|oauth|kubernetes|fastapi|django)\b/i;

const DECISION = /\b(decided|we (?:use|chose|selected|migrated)|because|instead of|rejected)\b/i;

export function isDurableNoise(text: string): boolean {
  if (RENAME_ONLY.test(text) && !ARCH.test(text) && !DECISION.test(text)) {
    return true;
  }
  return text.trim().length < 24;
}

export function classifyType(text: string): MemoryType {
  const t = text.toLowerCase();
  if (/\breject(ed)?\b|\binstead of\b|\bnot using\b/.test(t) && ARCH.test(t)) {
    return 'REJECTED_APPROACH';
  }
  if (/\b(must|must not|constraint|required to|shall)\b/.test(t)) {
    return ARCH.test(t) ? 'ARCHITECTURAL_CONSTRAINT' : 'CONSTRAINT';
  }
  if (/\b(prefer|preference|always use)\b/.test(t)) {
    return 'PREFERENCE';
  }
  if (/\bconvention|style guide|lint\b/.test(t)) {
    return 'PROJECT_CONVENTION';
  }
  if (/\blesson|we learned|abandoned|failed because\b/.test(t)) {
    return 'LESSON_LEARNED';
  }
  if (/\bpreviously|used to|migrated from|historical\b/.test(t)) {
    return 'HISTORICAL_EVENT';
  }
  if (/\bwarning|risk|do not\b/.test(t)) {
    return 'WARNING';
  }
  if (DECISION.test(t) || ARCH.test(t)) {
    return 'ARCHITECTURAL_DECISION';
  }
  if (/\bdiscover/.test(t)) {
    return 'DISCOVERY';
  }
  if (/\buses\b|\bis\b/.test(t) && ARCH.test(t)) {
    return 'TECHNOLOGY_CHOICE';
  }
  return 'FACT';
}

export function classifyScope(type: MemoryType): MemoryScope {
  switch (type) {
    case 'ARCHITECTURAL_DECISION':
    case 'ARCHITECTURAL_CONSTRAINT':
    case 'TECHNOLOGY_CHOICE':
    case 'REJECTED_APPROACH':
      return 'ARCHITECTURAL';
    case 'HISTORICAL_EVENT':
    case 'LESSON_LEARNED':
      return 'HISTORICAL';
    default:
      return 'PROJECT';
  }
}

export function scoreImportance(text: string, type: MemoryType): number {
  let s = 0.4;
  if (type.startsWith('ARCHITECTURAL') || type === 'TECHNOLOGY_CHOICE') {
    s += 0.35;
  }
  if (DECISION.test(text)) {
    s += 0.15;
  }
  if (ARCH.test(text)) {
    s += 0.1;
  }
  return Math.min(1, s);
}

export function scoreConfidence(opts: {
  sourceType: SourceType;
  explicit: boolean;
  heuristic: boolean;
}): number {
  if (opts.sourceType === 'HUMAN' || opts.sourceType === 'ADR') {
    return 0.98;
  }
  if (opts.explicit) {
    return 0.9;
  }
  if (opts.heuristic) {
    return 0.55;
  }
  return 0.45;
}

const ENTITIES = [
  'PostgreSQL',
  'Postgres',
  'Redis',
  'Auth0',
  'Firebase',
  'Kafka',
  'Temporal',
  'FastAPI',
  'React',
  'Kubernetes',
  'MongoDB',
  'SAML',
];

export function extractEntities(text: string): string[] {
  const found: string[] = [];
  for (const e of ENTITIES) {
    if (new RegExp(`\\b${e}\\b`, 'i').test(text)) {
      found.push(e === 'Postgres' ? 'PostgreSQL' : e);
    }
  }
  return [...new Set(found)];
}

export function eventText(payload?: Record<string, unknown>): string {
  if (!payload) {
    return '';
  }
  const parts = [
    payload.summary,
    payload.text,
    payload.decision,
    payload.reason,
    Array.isArray(payload.decisions) ? payload.decisions.join(' ') : '',
  ];
  return parts.filter((p) => typeof p === 'string').join('\n').slice(0, 4000);
}

export function heuristicExtractCandidate(opts: {
  eventId: string;
  eventType: string;
  projectId: string;
  taskId?: string;
  agentId?: string;
  sourceType?: SourceType;
  text: string;
}): MemoryCandidate | undefined {
  const raw = redactSecrets(opts.text);
  if (shouldRedact(opts.text) && raw === opts.text) {
    return undefined;
  }
  if (isDurableNoise(raw)) {
    return undefined;
  }
  const type = classifyType(raw);
  const scope = classifyScope(type);
  if (scope === 'WORKING') {
    return undefined;
  }
  const title = raw.split(/[.!\n]/)[0]!.trim().slice(0, 120) || type;
  const candidate = {
    type,
    scope,
    title,
    content: raw.slice(0, 2000),
    reason: /because\s+(.+)/i.exec(raw)?.[1]?.slice(0, 400) ?? '',
    importance: scoreImportance(raw, type),
    confidence: scoreConfidence({
      sourceType: opts.sourceType ?? 'AGENT',
      explicit: /decided|must|chose/.test(raw.toLowerCase()),
      heuristic: true,
    }),
    entities: extractEntities(raw),
    source: {
      event_id: opts.eventId,
      task_id: opts.taskId,
      source_type: opts.sourceType ?? 'AGENT',
      source_id: opts.eventId,
      agent_id: opts.agentId,
    },
  };
  return MemoryCandidateSchema.parse(candidate);
}

export class HeuristicMemoryExtractor {
  async extract(opts: {
    eventId: string;
    eventType: string;
    projectId: string;
    taskId?: string;
    agentId?: string;
    sourceType?: SourceType;
    text: string;
  }): Promise<MemoryCandidate | undefined> {
    return heuristicExtractCandidate(opts);
  }
}
