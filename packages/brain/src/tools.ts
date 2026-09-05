/**
 * Controlled Brain tools — one model, many tools, no agent swarm.
 * Level 3 side effects (code edits) are never executed automatically.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative } from 'node:path';
import type { BrainStore } from './store.js';
import { SemanticMemoryApi } from './semantic.js';
import { ImprovementManager } from './improvement.js';
import type {
  AutonomyLevel,
  EvidenceRef,
  ReasoningMode,
  RuntimeEvent,
} from './types.js';

export interface BrainToolContext {
  store: BrainStore;
  semantic: SemanticMemoryApi;
  improvement: ImprovementManager;
  workspaceRoot?: string;
  /** Max autonomy the runtime may exercise without human approval. */
  maxAutonomy: AutonomyLevel;
  projectId?: string;
}

export interface BrainToolDef {
  name: string;
  description: string;
  autonomy: AutonomyLevel;
  parameters: Record<string, unknown>;
}

export const BRAIN_TOOL_DEFS: BrainToolDef[] = [
  { name: 'brain.searchSemantic', description: 'Search semantic memory', autonomy: 1, parameters: { query: 'string', limit: 'number?' } },
  { name: 'brain.readSemantic', description: 'Read a semantic memory by id', autonomy: 1, parameters: { id: 'string' } },
  { name: 'brain.writeSemantic', description: 'Write a durable semantic memory', autonomy: 1, parameters: { label: 'string', content: 'string', type: 'string?' } },
  { name: 'brain.updateSemantic', description: 'Update semantic memory', autonomy: 1, parameters: { id: 'string', content: 'string?' } },
  { name: 'brain.queryGraph', description: 'Search graph entities by query', autonomy: 1, parameters: { query: 'string', limit: 'number?' } },
  { name: 'brain.createNode', description: 'Create/upsert a graph node', autonomy: 1, parameters: { type: 'string', label: 'string', description: 'string?' } },
  { name: 'brain.updateNode', description: 'Update a graph node', autonomy: 1, parameters: { id: 'string', description: 'string?' } },
  { name: 'brain.createRelationship', description: 'Create an idempotent relationship', autonomy: 1, parameters: { sourceLabel: 'string', sourceType: 'string', targetLabel: 'string', targetType: 'string', relType: 'string' } },
  { name: 'brain.updateRelationship', description: 'Update relationship confidence', autonomy: 1, parameters: { sourceLabel: 'string', sourceType: 'string', targetLabel: 'string', targetType: 'string', relType: 'string', confidence: 'number' } },
  { name: 'brain.searchEpisodes', description: 'Search recent episodes', autonomy: 1, parameters: { limit: 'number?' } },
  { name: 'brain.readEpisode', description: 'Read an episode', autonomy: 1, parameters: { id: 'string' } },
  { name: 'brain.createEpisode', description: 'Record an episode', autonomy: 1, parameters: { summary: 'string', kind: 'string?', outcome: 'string?' } },
  { name: 'brain.searchProcedures', description: 'Search procedural memory', autonomy: 1, parameters: { query: 'string' } },
  { name: 'brain.readProcedure', description: 'Read a procedure', autonomy: 1, parameters: { id: 'string' } },
  { name: 'brain.createProcedure', description: 'Create a procedure', autonomy: 1, parameters: { name: 'string', steps: 'string[]', conditions: 'string?' } },
  { name: 'brain.updateProcedure', description: 'Update a procedure', autonomy: 1, parameters: { id: 'string', steps: 'string[]?', successRate: 'number?', failureRate: 'number?' } },
  { name: 'brain.searchRepository', description: 'List files matching a name fragment (read-only)', autonomy: 1, parameters: { query: 'string' } },
  { name: 'brain.readFile', description: 'Read a workspace file (read-only)', autonomy: 1, parameters: { path: 'string' } },
  { name: 'brain.searchCode', description: 'Search file contents for a string (read-only)', autonomy: 1, parameters: { query: 'string' } },
  { name: 'brain.gitHistory', description: 'Read recent git log if available (read-only)', autonomy: 1, parameters: { limit: 'number?' } },
  { name: 'brain.projectState', description: 'Summarize project graph state', autonomy: 1, parameters: {} },
  { name: 'brain.getRecentActivity', description: 'Brain activity timeline', autonomy: 1, parameters: { limit: 'number?' } },
  { name: 'brain.getProjectHistory', description: 'Episodes for a project', autonomy: 1, parameters: { projectId: 'string?', limit: 'number?' } },
  { name: 'brain.createHypothesis', description: 'Create a hypothesis with optional counter', autonomy: 1, parameters: { statement: 'string', counterStatement: 'string?', confidence: 'number?', evidenceIds: 'string[]?' } },
  { name: 'brain.recordObservation', description: 'Record an observation episode', autonomy: 1, parameters: { summary: 'string' } },
  { name: 'brain.createInsight', description: 'Create an evidence-backed insight', autonomy: 1, parameters: { title: 'string', kind: 'string', confidence: 'number', observation: 'string?', reasoning: 'string?', improvement: 'string?', evidence: 'EvidenceRef[]', relatedFiles: 'string[]?' } },
  { name: 'brain.runEvaluation', description: 'Record evaluation metrics for an experiment', autonomy: 2, parameters: { experimentId: 'string', label: 'string', metrics: 'object' } },
  { name: 'brain.compareEvaluation', description: 'Decide promote/reject for an experiment', autonomy: 2, parameters: { experimentId: 'string' } },
  { name: 'brain.noAction', description: 'Explicitly conclude nothing meaningful', autonomy: 1, parameters: { reason: 'string?' } },
];

export function toolSchemasForPrompt(): string {
  return JSON.stringify(BRAIN_TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })), null, 0);
}

export async function executeBrainTool(
  name: string,
  args: Record<string, unknown>,
  ctx: BrainToolContext,
  mode: ReasoningMode = 'default',
): Promise<{ ok: boolean; result: unknown; error?: string; noAction?: boolean }> {
  const def = BRAIN_TOOL_DEFS.find((t) => t.name === name);
  if (!def) {
    return { ok: false, result: null, error: `unknown tool ${name}` };
  }
  if (def.autonomy > ctx.maxAutonomy) {
    return { ok: false, result: null, error: `tool ${name} requires autonomy level ${def.autonomy}` };
  }

  try {
    switch (name) {
      case 'brain.noAction':
        ctx.store.addActivity({
          ts: Date.now(),
          kind: 'no_action',
          message: String(args.reason ?? 'Nothing meaningful found'),
          projectId: ctx.projectId,
        });
        return { ok: true, result: { status: 'NO_ACTION', reason: args.reason ?? 'nothing meaningful' }, noAction: true };

      case 'brain.searchSemantic':
        return { ok: true, result: ctx.semantic.search(String(args.query ?? ''), Number(args.limit ?? 8)) };
      case 'brain.readSemantic':
        return { ok: true, result: ctx.semantic.read(String(args.id)) };
      case 'brain.writeSemantic':
        return {
          ok: true,
          result: ctx.semantic.write({
            label: String(args.label),
            content: String(args.content),
            type: args.type ? String(args.type) : undefined,
            projectId: ctx.projectId,
            source: 'brain.tool',
          }),
        };
      case 'brain.updateSemantic':
        return { ok: true, result: ctx.semantic.update(String(args.id), { content: args.content ? String(args.content) : undefined }) };

      case 'brain.queryGraph': {
        const q = String(args.query ?? '').toLowerCase();
        const hits = ctx.store.topEntities(Number(args.limit ?? 20))
          .filter((e) => !q || e.label.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q))
          .map((e) => ({ id: e.id, type: e.type, label: e.label, importance: e.importance }));
        return { ok: true, result: hits };
      }
      case 'brain.createNode': {
        const ent = ctx.store.upsertEntity({
          type: String(args.type),
          label: String(args.label),
          description: args.description ? String(args.description) : undefined,
          sourceType: 'brain.tool',
          projectId: ctx.projectId,
        });
        return { ok: true, result: ent };
      }
      case 'brain.updateNode': {
        const ent = ctx.store.getEntity(String(args.id));
        if (!ent) {
          return { ok: false, result: null, error: 'node not found' };
        }
        return {
          ok: true,
          result: ctx.store.upsertEntity({
            type: ent.type,
            label: ent.label,
            description: args.description ? String(args.description) : ent.description,
            sourceType: ent.sourceType,
            projectId: ent.projectId,
          }),
        };
      }
      case 'brain.createRelationship':
      case 'brain.updateRelationship': {
        const rel = ctx.store.upsertRelationship(
          {
            sourceLabel: String(args.sourceLabel),
            sourceType: String(args.sourceType),
            targetLabel: String(args.targetLabel),
            targetType: String(args.targetType),
            relType: String(args.relType),
            confidence: args.confidence !== undefined ? Number(args.confidence) : 0.7,
            projectId: ctx.projectId,
          },
          (label, type) => {
            const existing = ctx.store.findByNormLabel(label.toLowerCase());
            if (existing) {
              return existing;
            }
            return ctx.store.upsertEntity({ type, label, sourceType: 'brain.inferred', projectId: ctx.projectId });
          },
        );
        return { ok: true, result: rel };
      }

      case 'brain.searchEpisodes':
        return { ok: true, result: ctx.store.recentEpisodes(Number(args.limit ?? 20)) };
      case 'brain.readEpisode':
        return { ok: true, result: ctx.store.getEpisode(String(args.id)) };
      case 'brain.createEpisode':
        return {
          ok: true,
          result: ctx.store.addEpisode({
            kind: (args.kind as 'observation') ?? 'observation',
            summary: String(args.summary),
            outcome: args.outcome as 'success' | 'failure' | 'neutral' | undefined,
            entityIds: [],
            occurredAt: Date.now(),
            projectId: ctx.projectId,
            workspaceRoot: ctx.workspaceRoot,
          }),
        };

      case 'brain.searchProcedures':
        return { ok: true, result: ctx.store.searchProcedures(String(args.query ?? '')) };
      case 'brain.readProcedure':
        return { ok: true, result: ctx.store.getProcedure(String(args.id)) };
      case 'brain.createProcedure':
        return {
          ok: true,
          result: ctx.store.upsertProcedure({
            name: String(args.name),
            steps: Array.isArray(args.steps) ? args.steps.map(String) : [],
            conditions: args.conditions ? String(args.conditions) : undefined,
            successRate: 0,
            failureRate: 0,
            evidence: [],
            confidence: 0.5,
            projectId: ctx.projectId,
          }),
        };
      case 'brain.updateProcedure': {
        const cur = ctx.store.getProcedure(String(args.id));
        if (!cur) {
          return { ok: false, result: null, error: 'procedure not found' };
        }
        return {
          ok: true,
          result: ctx.store.upsertProcedure({
            ...cur,
            steps: Array.isArray(args.steps) ? args.steps.map(String) : cur.steps,
            successRate: args.successRate !== undefined ? Number(args.successRate) : cur.successRate,
            failureRate: args.failureRate !== undefined ? Number(args.failureRate) : cur.failureRate,
            lastUsed: Date.now(),
          }),
        };
      }

      case 'brain.searchRepository':
        return { ok: true, result: searchRepo(ctx.workspaceRoot, String(args.query ?? ''), 40) };
      case 'brain.readFile':
        return { ok: true, result: readWorkspaceFile(ctx.workspaceRoot, String(args.path ?? '')) };
      case 'brain.searchCode':
        return { ok: true, result: searchCode(ctx.workspaceRoot, String(args.query ?? ''), 20) };
      case 'brain.gitHistory':
        return { ok: true, result: readGitLog(ctx.workspaceRoot, Number(args.limit ?? 15)) };
      case 'brain.projectState': {
        const stats = {
          entities: ctx.store.countEntities(),
          episodes: ctx.store.recentEpisodes(5).length,
          insights: ctx.store.listInsights(5, 'new').length,
          procedures: ctx.store.listProcedures(5).length,
          top: ctx.store.topEntities(8).map((e) => `${e.type}:${e.label}`),
        };
        return { ok: true, result: stats };
      }
      case 'brain.getRecentActivity':
        return { ok: true, result: ctx.store.recentActivity(Number(args.limit ?? 30)) };
      case 'brain.getProjectHistory': {
        const pid = String(args.projectId ?? ctx.projectId ?? '');
        const eps = ctx.store.recentEpisodes(Number(args.limit ?? 30))
          .filter((e) => !pid || e.projectId === pid);
        return { ok: true, result: eps };
      }

      case 'brain.createHypothesis':
        return {
          ok: true,
          result: ctx.store.upsertHypothesis({
            statement: String(args.statement),
            counterStatement: args.counterStatement ? String(args.counterStatement) : undefined,
            confidence: Number(args.confidence ?? 0.5),
            evidenceIds: Array.isArray(args.evidenceIds) ? args.evidenceIds.map(String) : [],
            status: 'open',
            projectId: ctx.projectId,
          }),
        };
      case 'brain.recordObservation':
        return {
          ok: true,
          result: ctx.store.addEpisode({
            kind: 'observation',
            summary: String(args.summary),
            entityIds: [],
            occurredAt: Date.now(),
            projectId: ctx.projectId,
          }),
        };
      case 'brain.createInsight': {
        const evidence = (Array.isArray(args.evidence) ? args.evidence : []) as EvidenceRef[];
        if (!evidence.length && mode === 'ultrathink') {
          return { ok: false, result: null, error: 'UltraThink insights require evidence refs' };
        }
        if (!evidence.length) {
          return { ok: false, result: null, error: 'insights require evidence' };
        }
        const insight = ctx.store.upsertInsight({
          title: String(args.title),
          kind: String(args.kind ?? 'observation'),
          confidence: Number(args.confidence ?? 0.5),
          observation: args.observation ? String(args.observation) : undefined,
          reasoning: args.reasoning ? String(args.reasoning) : undefined,
          improvement: args.improvement ? String(args.improvement) : undefined,
          evidence,
          relatedMemoryIds: Array.isArray(args.relatedMemoryIds) ? args.relatedMemoryIds.map(String) : [],
          relatedFiles: Array.isArray(args.relatedFiles) ? args.relatedFiles.map(String) : [],
          status: 'new',
          reasoningMode: mode,
          projectId: ctx.projectId,
        });
        ctx.store.addActivity({
          ts: Date.now(),
          kind: 'insight_created',
          message: insight.title,
          refs: [insight.id],
          projectId: ctx.projectId,
        });
        return { ok: true, result: insight };
      }

      case 'brain.runEvaluation':
        ctx.improvement.recordEvaluation(
          String(args.experimentId),
          String(args.label),
          (args.metrics as Record<string, number>) ?? {},
          args.notes ? String(args.notes) : undefined,
        );
        return { ok: true, result: { recorded: true } };
      case 'brain.compareEvaluation':
        return { ok: true, result: ctx.improvement.decide(String(args.experimentId)) };

      default:
        return { ok: false, result: null, error: `unhandled tool ${name}` };
    }
  } catch (err) {
    return { ok: false, result: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Parse a single tool-call JSON from model output. */
export function parseToolCall(content: string): { tool: string; args: Record<string, unknown> } | undefined {
  const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const tryParse = (s: string) => {
    try {
      const o = JSON.parse(s) as { tool?: string; name?: string; args?: Record<string, unknown>; arguments?: Record<string, unknown> };
      const tool = o.tool ?? o.name;
      if (!tool) {
        return undefined;
      }
      return { tool, args: o.args ?? o.arguments ?? {} };
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(trimmed);
  if (direct) {
    return direct;
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return tryParse(trimmed.slice(start, end + 1));
  }
  if (/NO_ACTION/i.test(content)) {
    return { tool: 'brain.noAction', args: { reason: 'model returned NO_ACTION' } };
  }
  return undefined;
}

function searchRepo(root: string | undefined, query: string, limit: number): string[] {
  if (!root || !existsSync(root) || !query) {
    return [];
  }
  const out: string[] = [];
  const q = query.toLowerCase();
  const walk = (dir: string, depth: number): void => {
    if (depth > 5 || out.length >= limit) {
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git' || name === 'dist') {
        continue;
      }
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
      } else if (name.toLowerCase().includes(q)) {
        out.push(relative(root, full));
      }
      if (out.length >= limit) {
        return;
      }
    }
  };
  walk(root, 0);
  return out;
}

function readWorkspaceFile(root: string | undefined, path: string): { path: string; content?: string; error?: string } {
  if (!root) {
    return { path, error: 'no workspace' };
  }
  const full = path.startsWith('/') ? path : join(root, path);
  if (!full.startsWith(root) || !existsSync(full)) {
    return { path, error: 'not found or outside workspace' };
  }
  try {
    const st = statSync(full);
    if (st.size > 80_000) {
      return { path, error: 'file too large' };
    }
    return { path: relative(root, full) || basename(full), content: readFileSync(full, 'utf8').slice(0, 12_000) };
  } catch (e) {
    return { path, error: e instanceof Error ? e.message : String(e) };
  }
}

function searchCode(root: string | undefined, query: string, limit: number): Array<{ file: string; line: number; text: string }> {
  if (!root || !query || query.length < 3) {
    return [];
  }
  const hits: Array<{ file: string; line: number; text: string }> = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 4 || hits.length >= limit) {
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.git' || name === 'dist') {
        continue;
      }
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (st.size > 100_000 || !/\.(ts|tsx|js|mjs|py|go|rs|md)$/.test(name)) {
        continue;
      }
      try {
        const lines = readFileSync(full, 'utf8').split('\n');
        lines.forEach((text, i) => {
          if (hits.length < limit && text.includes(query)) {
            hits.push({ file: relative(root, full), line: i + 1, text: text.trim().slice(0, 160) });
          }
        });
      } catch {
        /* skip */
      }
    }
  };
  walk(root, 0);
  return hits;
}

function readGitLog(root: string | undefined, limit: number): string[] {
  if (!root || !existsSync(join(root, '.git'))) {
    return [];
  }
  try {
    const req = createRequire(import.meta.url);
    const { execSync } = req('node:child_process') as typeof import('node:child_process');
    const out = execSync(`git -C ${JSON.stringify(root)} log -n ${limit} --pretty=format:%h\\ %s\\ (%cr)`, {
      encoding: 'utf8',
      timeout: 5000,
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export function classifyRuntimeEventKind(event: RuntimeEvent): string {
  if (event.kind && event.kind !== 'chat') {
    return event.kind;
  }
  const t = (event.text ?? '').toLowerCase();
  if (/^\s*(hi|hello|thanks|ok)\b/.test(t) && t.length < 40) {
    return 'chat_trivial';
  }
  if (/decided|architecture|tradeoff/.test(t)) {
    return 'decision';
  }
  if (/fail|error|crash/.test(t)) {
    return 'test_failure';
  }
  return event.kind || 'chat';
}
