import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { nowIso } from '../domain/adr/schema.js';
import { isActiveStatus } from '../domain/adr/lifecycle.js';
import type { Adr } from '../domain/adr/schema.js';
import type { StoredDrift } from '../memory/decisionStore.js';
import { detectStructuralDrift } from './observedGraph.js';

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|rs|kt|rb|php|cs)$/i;

const TECH_ALIASES: Record<string, string[]> = {
  postgresql: ['postgres', 'postgresql', 'pg-promise', 'node-postgres'],
  mongodb: ['mongodb', 'mongoose', 'mongo'],
  redis: ['redis', 'ioredis'],
  kafka: ['kafka', 'kafkajs'],
  rabbitmq: ['rabbitmq', 'amqplib'],
  stripe: ['stripe'],
  dynamodb: ['dynamodb', 'dynamo'],
  mysql: ['mysql', 'mariadb'],
  sqlite: ['sqlite', 'better-sqlite3'],
  elasticsearch: ['elasticsearch', 'opensearch'],
  neo4j: ['neo4j'],
  graphql: ['graphql'],
};

function wordHas(hay: string, needle: string): boolean {
  const n = needle.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${n}\\b`, 'i').test(hay);
}

export function extractDeclaredTech(text: string): string[] {
  const found: string[] = [];
  for (const [canon, aliases] of Object.entries(TECH_ALIASES)) {
    if (aliases.some((a) => wordHas(text, a))) {
      found.push(canon);
    }
  }
  return found;
}

export function extractGatewayServices(text: string): string[] {
  const out: string[] = [];
  const re =
    /(?:must|should|only)\s+(?:go\s+)?(?:through|via|in)\s+([a-z0-9][a-z0-9_-]*service)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(m[1]!.toLowerCase());
  }
  return [...new Set(out)];
}

function listSourceFiles(root: string, dir: string, cap: number, acc: string[]): void {
  if (acc.length >= cap) {
    return;
  }
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (acc.length >= cap) {
      return;
    }
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.singularity') {
      continue;
    }
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      listSourceFiles(root, abs, cap, acc);
    } else if (SOURCE_EXT.test(name)) {
      acc.push(abs);
    }
  }
}

function readSnippet(abs: string): string {
  try {
    return readFileSync(abs, 'utf8').slice(0, 12_000);
  } catch {
    return '';
  }
}

function serviceOfPath(rel: string): string {
  const parts = rel.replace(/\\/g, '/').split('/');
  return (parts.find((p) => /service|gateway|worker|api/i.test(p)) ?? parts[0] ?? '').toLowerCase();
}

/**
 * Compare declared ADRs against workspace files. Intelligence plane only.
 */
export function detectDrift(opts: {
  workspaceRoot: string;
  project_id: string;
  adrs: Adr[];
  extraFiles?: string[];
}): StoredDrift[] {
  const out: StoredDrift[] = [];
  const root = opts.workspaceRoot;
  let seq = 0;

  for (const adr of opts.adrs) {
    if (adr.record_kind === 'observation' || !isActiveStatus(adr.status)) {
      continue;
    }
    const declaredText = [
      adr.title,
      adr.decision.summary,
      ...adr.constraints,
      ...adr.consequences,
    ].join('\n');
    const declared = extractDeclaredTech(declaredText);
    const rejected = adr.alternatives
      .filter((a) => a.status === 'rejected')
      .flatMap((a) => extractDeclaredTech(a.name));
    const gateways = extractGatewayServices(declaredText);

    const files: string[] = [];
    for (const e of adr.evidence.code) {
      const abs = e.id.startsWith('/') ? e.id : join(root, e.id);
      files.push(abs);
      if (!existsSync(abs) && SOURCE_EXT.test(e.id)) {
        seq += 1;
        out.push({
          id: `drift_${adr.id}_${seq}`,
          project_id: opts.project_id,
          adr_id: adr.id,
          severity: 'medium',
          kind: 'missing_implementation',
          reason: `${adr.id} lists ${e.id} as implementation evidence but the file is missing.`,
          files: [e.id],
          created_at: nowIso(),
          status: 'open',
          confidence: 0.9,
        });
      }
    }
    for (const extra of opts.extraFiles ?? []) {
      files.push(extra.startsWith('/') ? extra : join(root, extra));
    }
    for (const c of adr.affected_components) {
      for (const base of ['src', 'packages', 'services', '']) {
        const dir = base ? join(root, base, c) : join(root, c);
        if (existsSync(dir)) {
          listSourceFiles(root, dir, 40, files);
        }
      }
    }
    if (gateways.length || rejected.length) {
      listSourceFiles(root, join(root, 'src'), 60, files);
      listSourceFiles(root, join(root, 'packages'), 40, files);
      listSourceFiles(root, join(root, 'services'), 40, files);
    }

    const uniqFiles = [...new Set(files)].slice(0, 80);
    let corpus = '';
    const fileHits: Array<{ rel: string; text: string; svc: string }> = [];
    for (const abs of uniqFiles) {
      const text = readSnippet(abs);
      if (!text) {
        continue;
      }
      const rel = relative(root, abs).split(sep).join('/');
      fileHits.push({ rel, text, svc: serviceOfPath(rel) });
      corpus += `\n${text}`;
    }

    for (const tech of rejected) {
      const hits = fileHits.filter((f) => extractDeclaredTech(f.text).includes(tech));
      if (hits.length) {
        seq += 1;
        out.push({
          id: `drift_${adr.id}_${seq}`,
          project_id: opts.project_id,
          adr_id: adr.id,
          severity: 'high',
          kind: 'rejected_in_use',
          reason: `${adr.id} rejected ${tech}, but it appears in ${hits
            .slice(0, 3)
            .map((h) => h.rel)
            .join(', ')}.`,
          files: hits.map((h) => h.rel).slice(0, 8),
          created_at: nowIso(),
          status: 'open',
          confidence: 0.85,
        });
      }
    }

    if (declared.length && fileHits.length) {
      const present = extractDeclaredTech(corpus);
      const missing = declared.filter((t) => !present.includes(t) && !rejected.includes(t));
      if (missing.length && adr.evidence.code.length) {
        seq += 1;
        out.push({
          id: `drift_${adr.id}_${seq}`,
          project_id: opts.project_id,
          adr_id: adr.id,
          severity: 'medium',
          kind: 'missing_declared',
          reason: `${adr.id} declares ${missing.join(', ')} but linked implementation files do not mention it.`,
          files: adr.evidence.code.map((e) => e.id).slice(0, 8),
          created_at: nowIso(),
          status: 'open',
          confidence: 0.85,
        });
      }
    }

    for (const gw of gateways) {
      const extra: string[] = [];
      if (/payment|billing|checkout/.test(gw)) {
        extra.push('stripe');
      }
      const techs = [...new Set([...declared, ...extra])];
      const scan = techs.length ? techs : ['stripe'];
      for (const tech of scan) {
        const offenders = fileHits.filter(
          (f) => extractDeclaredTech(f.text).includes(tech) && f.svc && f.svc !== gw && !f.svc.includes(gw),
        );
        if (offenders.length) {
          seq += 1;
          out.push({
            id: `drift_${adr.id}_${seq}`,
            project_id: opts.project_id,
            adr_id: adr.id,
            severity: 'high',
            kind: 'constraint_violation',
            reason: `${adr.id} requires traffic through ${gw}, but ${offenders[0]!.rel} (${offenders[0]!.svc}) uses ${tech} directly.`,
            files: offenders.map((o) => o.rel).slice(0, 8),
            created_at: nowIso(),
            status: 'open',
            confidence: 0.8,
          });
        }
      }
    }
  }

  out.push(
    ...detectStructuralDrift({
      workspaceRoot: opts.workspaceRoot,
      project_id: opts.project_id,
      adrs: opts.adrs,
      extraFiles: opts.extraFiles,
    }),
  );

  return out;
}
