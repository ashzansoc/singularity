/**
 * ConflictResolver — detects incompatible agent recommendations and resolves them.
 */

import type { LlmPort } from '../ports.js';
import type { RuntimeEvent } from '../types.js';
import type { SubagentResult } from '../subagent/types.js';

export interface DetectedConflict {
  id: string;
  topic: string;
  recommendations: Array<{ agentId: string; text: string }>;
}

export interface ConflictResolution {
  conflictId: string;
  decision: string;
  rationale: string;
  winningAgentId?: string;
}

const RESOLVER_SYSTEM = `You resolve architecture conflicts between specialist agents.
Return ONLY JSON:
{
  "decision": string,
  "rationale": string,
  "winningAgentId": string | null
}`;

export function detectRecommendationConflicts(
  results: SubagentResult[],
): DetectedConflict[] {
  const conflicts: DetectedConflict[] = [];
  const recs: Array<{ agentId: string; text: string; keywords: Set<string> }> = [];

  for (const r of results) {
    for (const rec of r.recommendations ?? []) {
      recs.push({
        agentId: r.subagentId,
        text: rec,
        keywords: extractKeywords(rec),
      });
    }
  }

  for (let i = 0; i < recs.length; i++) {
    for (let j = i + 1; j < recs.length; j++) {
      const a = recs[i]!;
      const b = recs[j]!;
      if (a.agentId === b.agentId) {
        continue;
      }
      const overlap = [...a.keywords].filter((k) => b.keywords.has(k));
      if (overlap.length === 0) {
        continue;
      }
      if (areContradictory(a.text, b.text)) {
        conflicts.push({
          id: `conflict-${i}-${j}`,
          topic: overlap.slice(0, 3).join(', '),
          recommendations: [
            { agentId: a.agentId, text: a.text },
            { agentId: b.agentId, text: b.text },
          ],
        });
      }
    }
  }
  return conflicts;
}

function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  return new Set(words);
}

const NEGATION_PAIRS: Array<[RegExp, RegExp]> = [
  [/\buse\b.*\bredis\b/i, /\b(do not|don't|avoid|without)\b.*\bredis\b/i],
  [/\badd\b.*\bdependency\b/i, /\b(no new|avoid|without)\b.*\bdependency\b/i],
  [/\bmigrate\b/i, /\bkeep\b.*\b(existing|current)\b/i],
];

function areContradictory(a: string, b: string): boolean {
  for (const [pos, neg] of NEGATION_PAIRS) {
    if ((pos.test(a) && neg.test(b)) || (pos.test(b) && neg.test(a))) {
      return true;
    }
  }
  return false;
}

export async function resolveConflicts(opts: {
  llm: LlmPort;
  goal: string;
  conflicts: DetectedConflict[];
  sessionId?: string;
  signal?: AbortSignal;
  onEvent?: (ev: RuntimeEvent) => void;
}): Promise<ConflictResolution[]> {
  const resolutions: ConflictResolution[] = [];
  for (const conflict of opts.conflicts) {
    opts.onEvent?.({
      kind: 'workflow_conflict_detected',
      ts: Date.now(),
      message: `Conflict on ${conflict.topic}`,
      data: { conflict },
    });

    const prompt = [
      `Mission: ${opts.goal}`,
      `Topic: ${conflict.topic}`,
      ...conflict.recommendations.map(
        (r) => `Agent ${r.agentId}: ${r.text}`,
      ),
    ].join('\n');

    const raw = await opts.llm.complete({
      role: 'integrator',
      systemPrompt: RESOLVER_SYSTEM,
      prompt,
      preferredTier: 'T5',
      temperature: 0.1,
      sessionId: opts.sessionId,
      signal: opts.signal,
    });

    let parsed: ConflictResolution = {
      conflictId: conflict.id,
      decision: conflict.recommendations[0]?.text ?? 'defer',
      rationale: 'Heuristic fallback',
    };
    try {
      const json = JSON.parse(raw.text.replace(/```json?\s*|\s*```/g, '').trim()) as {
        decision?: string;
        rationale?: string;
        winningAgentId?: string | null;
      };
      parsed = {
        conflictId: conflict.id,
        decision: json.decision ?? parsed.decision,
        rationale: json.rationale ?? parsed.rationale,
        winningAgentId: json.winningAgentId ?? undefined,
      };
    } catch {
      /* keep fallback */
    }
    resolutions.push(parsed);
  }
  return resolutions;
}
