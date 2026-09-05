import type { MemoryRecord } from '../domain/memory.js';
import { emptySnapshot, type ProjectSnapshot } from '../domain/snapshot.js';
import { estimateTokens } from '../metrics.js';

const LANG = ['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Java', 'Kotlin'];
const FW = ['FastAPI', 'React', 'Next.js', 'Django', 'Express', 'NestJS'];
const DB = ['PostgreSQL', 'Postgres', 'MySQL', 'MongoDB', 'Redis', 'SQLite'];
const INFRA = ['Kubernetes', 'Docker', 'AWS', 'GCP', 'Temporal', 'Kafka'];

function collect(memories: MemoryRecord[], vocab: string[]): string[] {
  const found = new Set<string>();
  const blob = memories.map((m) => `${m.title} ${m.content} ${m.entities.join(' ')}`).join(' ');
  for (const v of vocab) {
    if (new RegExp(`\\b${v.replace('.', '\\.')}\\b`, 'i').test(blob)) {
      found.add(v === 'Postgres' ? 'PostgreSQL' : v);
    }
  }
  return [...found];
}

export function buildSnapshot(
  projectName: string,
  memories: MemoryRecord[],
  tokenBudget = 4000,
  topK = 8,
): ProjectSnapshot {
  const active = memories.filter((m) => m.status === 'ACTIVE' && m.scope !== 'WORKING');
  const snap = emptySnapshot(projectName);
  snap.project.language = collect(active, LANG);
  snap.project.frameworks = collect(active, FW);
  snap.project.databases = collect(active, DB);
  snap.project.infrastructure = collect(active, INFRA);
  snap.architecture = active
    .filter((m) => m.type.includes('ARCHITECTURAL') || m.type === 'TECHNOLOGY_CHOICE')
    .sort((a, b) => b.importance - a.importance)
    .slice(0, topK)
    .map((m) => m.title);
  snap.constraints = active
    .filter((m) => m.type.includes('CONSTRAINT'))
    .slice(0, 8)
    .map((m) => m.title);
  const lines = [
    `Project: ${snap.project.name}`,
    snap.project.language.length ? `Languages: ${snap.project.language.join(', ')}` : '',
    snap.project.frameworks.length ? `Frameworks: ${snap.project.frameworks.join(', ')}` : '',
    snap.project.databases.length ? `Databases: ${snap.project.databases.join(', ')}` : '',
    ...snap.architecture.map((a) => `- ${a}`),
    ...snap.constraints.map((c) => `Constraint: ${c}`),
  ].filter(Boolean);
  let block = lines.join('\n');
  while (estimateTokens(block) > tokenBudget && lines.length > 3) {
    lines.pop();
    block = lines.join('\n');
  }
  snap.prompt_block = block;
  return snap;
}
