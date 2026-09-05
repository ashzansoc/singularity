export type SignificanceLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const CRITICAL_RE =
  /\b(new (database|db|service|broker|auth(entication)?|authorization)|service decomposition|api contract|data storage strategy|infrastructure architecture|deployment architecture|event architecture|model architecture|caching architecture)\b/i;

const HIGH_RE =
  /\b(database migration|message broker|kafka|nats|rabbitmq|postgres|postgresql|mongodb|dynamodb|neo4j|redis|oauth|jwt|openid|new (queue|topic)|major dependency|authentication architecture|authorization architecture)\b/i;

const MEDIUM_RE =
  /\b(library replacement|module restructuring|new abstraction|new integration|persistence pattern|extract .+ into|split .+ service|replace .+ with)\b/i;

const LOW_RE =
  /\b(format(ting)?|rename|typo|lint|bug fix|local refactor|comment|whitespace)\b/i;

export function classifySignificance(input: {
  text?: string;
  changed_files?: string[];
}): SignificanceLevel {
  const blob = `${input.text ?? ''} ${(input.changed_files ?? []).join(' ')}`;
  if (!blob.trim()) {
    return 'NONE';
  }
  if (CRITICAL_RE.test(blob)) {
    return 'CRITICAL';
  }
  if (HIGH_RE.test(blob)) {
    return 'HIGH';
  }
  if (MEDIUM_RE.test(blob)) {
    return 'MEDIUM';
  }
  if (LOW_RE.test(blob) && blob.length < 400) {
    return 'LOW';
  }
  if ((input.changed_files?.length ?? 0) === 0 && (input.text?.length ?? 0) < 40) {
    return 'NONE';
  }
  if ((input.changed_files ?? []).some((f) => /(?:^|\/)(docker|k8s|terraform|prisma|schema|auth)\b/i.test(f))) {
    return 'HIGH';
  }
  return 'LOW';
}

export function shouldEnterAdrPipeline(level: SignificanceLevel): boolean {
  return level === 'MEDIUM' || level === 'HIGH' || level === 'CRITICAL';
}
