import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { estimateTokens } from '../metrics.js';
import { isActiveStatus } from '../domain/adr/lifecycle.js';
import type { Adr } from '../domain/adr/schema.js';

export const CONTEXT_BUDGET_DEFAULT = 2_000;
export const CONTEXT_BUDGET_MAX = 4_000;
export const CONTEXT_BUDGET_CRITICAL = 8_000;

export interface CachedArchitectureContext {
  entity: string;
  version: number;
  architecture_context: {
    decisions: string[];
    constraints: string[];
    dependencies: string[];
    risks: string[];
    conflicts: string[];
    prompt_block: string;
  };
}

function hashEntity(entity: string): string {
  return createHash('sha256').update(entity).digest('hex').slice(0, 16);
}

function cachePath(root: string, entity: string): string {
  return join(root, `${hashEntity(entity)}.json`);
}

/**
 * Disk + memory cache. Coding plane may import lookup helpers only.
 */
export class ArchitectureContextCache {
  private readonly mem = new Map<string, CachedArchitectureContext>();
  readonly dir: string;

  constructor(workspaceRoot: string) {
    this.dir = join(workspaceRoot, '.singularity', 'architecture', 'cache');
    try {
      mkdirSync(this.dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  get(entity: string): CachedArchitectureContext | undefined {
    const hit = this.mem.get(entity);
    if (hit) {
      return hit;
    }
    try {
      const p = cachePath(this.dir, entity);
      if (!existsSync(p)) {
        return undefined;
      }
      const parsed = JSON.parse(readFileSync(p, 'utf8')) as CachedArchitectureContext;
      this.mem.set(entity, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  set(ctx: CachedArchitectureContext): void {
    this.mem.set(ctx.entity, ctx);
    try {
      writeFileSync(cachePath(this.dir, ctx.entity), JSON.stringify(ctx));
    } catch {
      /* still in memory */
    }
  }
}

export function rankAdrsForEntity(adrs: Adr[], entity: string): Adr[] {
  const e = entity.toLowerCase();
  return [...adrs]
    .map((a) => {
      let score = 0;
      if (a.affected_components.some((c) => c.toLowerCase().includes(e) || e.includes(c.toLowerCase()))) {
        score += 5;
      }
      if (a.title.toLowerCase().includes(e) || a.decision.summary.toLowerCase().includes(e)) {
        score += 3;
      }
      if (isActiveStatus(a.status)) {
        score += 2;
      } else {
        score -= 2;
      }
      score += a.confidence;
      return { a, score };
    })
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}

export function buildCachedContext(
  entity: string,
  adrs: Adr[],
  version: number,
  budget = CONTEXT_BUDGET_DEFAULT,
  extra?: {
    conflicts?: Array<{ adr_id: string; reason: string; severity: string }>;
    drifts?: Array<{ adr_id: string; reason: string; severity: string }>;
  },
): CachedArchitectureContext {
  const ranked = rankAdrsForEntity(adrs, entity).filter(
    (a) => a.record_kind !== 'observation' && isActiveStatus(a.status),
  );
  const historical = rankAdrsForEntity(adrs, entity).filter(
    (a) => a.status === 'superseded' || a.status === 'deprecated',
  );
  const decisions: string[] = [];
  const constraints: string[] = [];
  const dependencies: string[] = [];
  const risks: string[] = [];
  const conflictLines = extra?.conflicts ?? [];
  const driftLines = extra?.drifts ?? [];
  const lines: string[] = [`Architecture context for ${entity}:`];
  let tokens = estimateTokens(lines[0]!);
  for (const d of driftLines.slice(0, 4)) {
    const dl = `! drift [${d.severity}] ${d.adr_id}: ${d.reason}`;
    const dt = estimateTokens(dl);
    if (tokens + dt > budget) {
      break;
    }
    tokens += dt;
    lines.push(dl);
  }
  for (const c of conflictLines.slice(0, 4)) {
    const cl = `! conflict [${c.severity}] ${c.adr_id}: ${c.reason}`;
    const ct = estimateTokens(cl);
    if (tokens + ct > budget) {
      break;
    }
    tokens += ct;
    lines.push(cl);
  }
  for (const adr of ranked) {
    const line = `- ${adr.id} [${adr.status}] ${adr.decision.summary}`;
    const t = estimateTokens(line);
    if (tokens + t > budget) {
      break;
    }
    tokens += t;
    lines.push(line);
    decisions.push(adr.id);
    constraints.push(...adr.constraints);
    dependencies.push(...adr.dependencies);
    risks.push(...adr.risks);
    for (const c of adr.constraints.slice(0, 2)) {
      const cl = `  constraint: ${c}`;
      const ct = estimateTokens(cl);
      if (tokens + ct > budget) {
        break;
      }
      tokens += ct;
      lines.push(cl);
    }
  }
  if (historical.length && tokens < budget - 40) {
    const h = `historical (superseded): ${historical
      .slice(0, 3)
      .map((a) => a.id)
      .join(', ')}`;
    tokens += estimateTokens(h);
    if (tokens <= budget) {
      lines.push(h);
    }
  }
  return {
    entity,
    version,
    architecture_context: {
      decisions: [...new Set(decisions)],
      constraints: [...new Set(constraints)].slice(0, 12),
      dependencies: [...new Set(dependencies)].slice(0, 12),
      risks: [...new Set(risks)].slice(0, 8),
      conflicts: [
        ...conflictLines.map((c) => c.adr_id),
        ...driftLines.map((d) => d.adr_id),
      ],
      prompt_block: lines.join('\n'),
    },
  };
}

/** Cheap entity guess from a task string — no DB. */
export function guessEntities(task: string): string[] {
  const tokens = task
    .toLowerCase()
    .split(/[^a-z0-9._/-]+/)
    .filter((t) => t.length > 3);
  const files = tokens.filter((t) => t.includes('/') || t.includes('.'));
  const services = tokens.filter((t) => t.includes('service') || t.includes('api'));
  const uniq = [...new Set([...files, ...services, 'workspace'])];
  return uniq.slice(0, 6);
}

/**
 * Coding-plane lookup: memory/disk cache only. Never searches SQLite/vectors.
 */
export function lookupCachedContextBlock(
  cache: ArchitectureContextCache,
  task: string,
  budget = CONTEXT_BUDGET_DEFAULT,
): string {
  try {
    const entities = guessEntities(task);
    const blocks: string[] = [];
    let tokens = 0;
    for (const e of entities) {
      const ctx = cache.get(e) ?? cache.get('workspace');
      if (!ctx?.architecture_context.prompt_block) {
        continue;
      }
      const t = estimateTokens(ctx.architecture_context.prompt_block);
      if (tokens + t > budget) {
        break;
      }
      tokens += t;
      blocks.push(ctx.architecture_context.prompt_block);
    }
    return blocks.join('\n\n');
  } catch {
    return '';
  }
}
