/**
 * Memory extraction: turns raw activity (chat turns, file diffs, module
 * clusters) into structured entities + relationships via an LLM, with strict
 * quality gates so the Brain never becomes a dumping ground.
 */

import type { UpsertEntityInput, UpsertRelationshipInput } from './types.js';

export interface BrainLlmClient {
  complete(prompt: string): Promise<string>;
}

export interface ExtractionResult {
  durable: boolean;
  entities: Array<UpsertEntityInput & { description?: string }>;
  relationships: UpsertRelationshipInput[];
  episode?: { summary: string; kind: 'chat' | 'code_change' | 'file_change' | 'decision' | 'sync' };
}

export interface ExtractionInput {
  kind: 'chat' | 'code_change' | 'file_change';
  text: string;
  contextHint?: string;
}

const EXTRACTION_SYSTEM_PROMPT = `You are the memory-extraction module of Singularity Brain.
From the given activity excerpt, extract DURABLE engineering knowledge worth remembering months later across these layers:
- Code: modules, services, layers, technologies, dependencies
- Semantic: concepts, facts, requirements, constraints, topics
- Memory: decisions, tradeoffs, experiments, hypotheses, evaluations, outcomes, lessons
- Tasks: goals, plans, changes (only if durable — not transient todo noise)
IGNORE ephemeral details: greetings, small edits, styling tweaks, small talk, transient task state.
Return STRICT JSON only, no markdown fence:
{
  "durable": boolean,                       // false when nothing here is worth remembering
  "entities": [{"type": "...", "label": "...", "description": "...", "confidence": 0..1}],
  "relationships": [{"source": {"type":"...","label":"..."}, "relType": "...", "target": {"type":"...","label":"..."}, "confidence": 0..1}],
  "episode": {"kind": "chat|code_change|file_change|decision|sync", "summary": "one sentence"}
}
Entity types: project repository code technology service layer architecture concept fact requirement constraint assumption topic goal decision tradeoff learning lesson observation experiment hypothesis evaluation outcome experience conversation document task plan change event person bug solution preference.
Rel types: works_on created modified uses depends_on contains part_of decided learned discovered related_to caused caused_by fixed_by solved_by replaced_by supersedes derived_from discussed_in implemented_in implements explains constrains supports contradicts motivated_by affects tests produces informs validated_by modifies tested_by failed_because succeeded_because belongs_to connected_to.
Rules:
- Labels are short canonical names ("PostgreSQL", "Auth Service"), not sentences. Descriptions carry detail.
- Only include relationships whose endpoints exist as extracted or implied entities.
- Prefer fewer high-confidence memories over many weak ones.
- Do NOT invent edges. Prefer connecting decisions to architecture/concepts/technologies they actually affect.
- Never attach every entity to a project hub; use part_of / affects / informs / depends_on between peers.`;

/** Heuristic pre-gate to avoid burning LLM calls on obvious noise. */
export function isTrivialForBrain(text: string): boolean {
  const t = text.trim();
  if (t.length < 24) {
    return true;
  }
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|continue|go on|next)\b/i.test(t) && t.length < 64) {
    return true;
  }
  return false;
}

interface RawExtraction {
  durable?: boolean;
  entities?: Array<{ type?: string; label?: string; description?: string; confidence?: number }>;
  relationships?: Array<{
    source?: { type?: string; label?: string };
    relType?: string;
    target?: { type?: string; label?: string };
    confidence?: number;
  }>;
  episode?: { kind?: string; summary?: string };
}

function parseJsonLoose(s: string): RawExtraction | undefined {
  const trimmed = s.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as RawExtraction;
  } catch {
    return undefined;
  }
}

const KNOWN_TYPES = new Set([
  'project', 'repository', 'code', 'technology', 'service', 'layer', 'architecture',
  'concept', 'fact', 'requirement', 'constraint', 'assumption', 'topic',
  'goal', 'decision', 'tradeoff', 'learning', 'lesson', 'observation',
  'experiment', 'hypothesis', 'evaluation', 'outcome', 'experience',
  'conversation', 'document', 'task', 'plan', 'change', 'event', 'person',
  'bug', 'solution', 'preference',
]);

export class MemoryExtractor {
  constructor(private llm: BrainLlmClient) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const empty: ExtractionResult = { durable: false, entities: [], relationships: [] };
    if (isTrivialForBrain(input.text)) {
      return empty;
    }
    const prompt = [
      EXTRACTION_SYSTEM_PROMPT,
      input.contextHint ? `Context: ${input.contextHint}` : '',
      `Activity kind: ${input.kind}`,
      '--- activity ---',
      clip(input.text, 12_000),
    ]
      .filter(Boolean)
      .join('\n');
    let raw: string;
    try {
      raw = await this.llm.complete(prompt);
    } catch {
      return empty;
    }
    const parsed = parseJsonLoose(raw);
    if (!parsed || parsed.durable === false || !Array.isArray(parsed.entities)) {
      return empty;
    }
    const entities = parsed.entities
      .filter((e): e is NonNullable<RawExtraction['entities']>[number] => Boolean(e?.label))
      .slice(0, 24)
      .map((e) => ({
        type: KNOWN_TYPES.has(e.type ?? '') ? (e.type as string) : 'concept',
        label: String(e.label).slice(0, 120),
        description: e.description ? String(e.description).slice(0, 600) : undefined,
        confidence: clamp01(e.confidence ?? 0.8),
        sourceType: `brain.${input.kind}`,
      }));
    const labelSet = new Set(entities.map((e) => normalize(e.label)));
    const relationships: UpsertRelationshipInput[] = [];
    for (const r of parsed.relationships ?? []) {
      const src = r.source?.label;
      const tgt = r.target?.label;
      if (!src || !tgt) {
        continue;
      }
      // Drop edges that reference labels the model never introduced — they would
      // otherwise materialize phantom nodes.
      if (!labelSet.has(normalize(src)) || !labelSet.has(normalize(tgt))) {
        continue;
      }
      relationships.push({
        sourceLabel: src.slice(0, 120),
        sourceType: r.source?.type && KNOWN_TYPES.has(r.source.type) ? r.source.type : 'concept',
        targetLabel: tgt.slice(0, 120),
        targetType: r.target?.type && KNOWN_TYPES.has(r.target.type) ? r.target.type : 'concept',
        relType: String(r.relType ?? 'related_to').slice(0, 40),
        confidence: clamp01(r.confidence ?? 0.75),
        projectId: undefined,
      });
    }
    let episode: ExtractionResult['episode'];
    if (parsed.episode?.summary) {
      const allowed = ['chat', 'code_change', 'file_change', 'decision', 'sync'] as const;
      type EpisodeKind = (typeof allowed)[number];
      const rawKind = parsed.episode.kind as EpisodeKind;
      const kind: EpisodeKind = allowed.includes(rawKind) ? rawKind : (input.kind as EpisodeKind);
      episode = { summary: String(parsed.episode.summary).slice(0, 400), kind };
    }
    return { durable: entities.length > 0, entities, relationships, episode };
  }

  /** Summarize a batch of files/modules into architecture-level knowledge. */
  async summarizeModule(modulePath: string, digest: string): Promise<ExtractionResult> {
    return this.extract({
      kind: 'code_change',
      text: `Repository module ${modulePath} contains:\n${digest}`,
      contextHint: 'Deep repository ingestion (Sync Everything). Extract what this module IS, what it USES, and its role in the architecture.',
    });
  }

  async understandDecision(text: string, contextHint?: string): Promise<ExtractionResult> {
    return this.extract({ kind: 'chat', text, contextHint: contextHint ?? 'Focus on extracting any architectural or technical decision with its rationale.' });
  }
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) {
    return 0.8;
  }
  return Math.min(1, Math.max(0, n));
}

function normalize(label: string): string {
  return label.trim().toLowerCase();
}
