/**
 * Format structured context for planner / worker / verifier prompts.
 * Ordering: stable architecture first, dynamic task bits last (cache-friendly).
 */

import type {
  ArchitectureDecision,
  Constraint,
  FileReference,
  Goal,
  OpenQuestion,
  Prohibition,
  Requirement,
  Technology,
  UserPreference,
} from './types.js';

export interface FormatInput {
  requirements: Requirement[];
  constraints: Constraint[];
  prohibitions: Prohibition[];
  technologies: Technology[];
  decisions: ArchitectureDecision[];
  preferences: UserPreference[];
  goals: Goal[];
  open_questions: OpenQuestion[];
  files: FileReference[];
  task?: string;
}

export function formatRelevantContextBlock(input: FormatInput): string {
  const lines: string[] = ['PROJECT CONTEXT (structured)', '─'.repeat(28)];

  if (input.technologies.length) {
    lines.push('TECHNOLOGIES:');
    for (const t of input.technologies) {
      lines.push(
        `- ${t.name} (${t.category}${t.status === 'proposed' ? ', proposed' : ''})`,
      );
    }
  }

  if (input.decisions.length) {
    lines.push('ARCHITECTURE DECISIONS:');
    for (const d of input.decisions) {
      const alt = d.alternatives_rejected.length
        ? ` [rejected: ${d.alternatives_rejected.join(', ')}]`
        : '';
      lines.push(`- ${d.decision}${alt}`);
    }
  }

  if (input.constraints.length) {
    lines.push('CONSTRAINTS:');
    for (const c of input.constraints) {
      lines.push(`- [${c.strength}] ${c.constraint}`);
    }
  }

  if (input.prohibitions.length) {
    lines.push('PROHIBITIONS:');
    for (const p of input.prohibitions) {
      lines.push(`- Do NOT: ${p.prohibition}`);
    }
  }

  if (input.requirements.length) {
    lines.push('RELEVANT REQUIREMENTS:');
    for (const r of input.requirements) {
      lines.push(`- [${r.type}] ${r.description}`);
    }
  }

  if (input.goals.length) {
    lines.push('CURRENT GOALS:');
    for (const g of input.goals) {
      lines.push(`- ${g.goal}`);
    }
  }

  if (input.preferences.length) {
    lines.push('PREFERENCES (not hard requirements):');
    for (const p of input.preferences) {
      lines.push(`- ${p.preference}`);
    }
  }

  if (input.open_questions.length) {
    lines.push('OPEN QUESTIONS:');
    for (const q of input.open_questions) {
      lines.push(`- ${q.question}`);
    }
  }

  if (input.files.length) {
    lines.push('RELEVANT FILES:');
    for (const f of input.files) {
      lines.push(`- ${f.path}${f.reason ? ` — ${f.reason}` : ''}`);
    }
  }

  if (input.task) {
    lines.push('CURRENT TASK:');
    lines.push(input.task);
  }

  return lines.join('\n');
}

/** Compact project summary for PlanRequest.projectSummary. */
export function formatProjectSummary(input: FormatInput): string {
  const parts: string[] = [];
  if (input.goals[0]) {
    parts.push(input.goals[0].goal);
  }
  if (input.technologies.length) {
    parts.push(
      `Stack: ${input.technologies.map((t) => t.name).join(', ')}`,
    );
  }
  if (input.prohibitions.length) {
    parts.push(
      `Avoid: ${input.prohibitions.map((p) => p.prohibition).join(', ')}`,
    );
  }
  return parts.join('. ').slice(0, 800);
}

/** Verifier checklist text. */
export function formatVerificationChecklist(input: FormatInput): string {
  const lines = ['REQUIREMENT VERIFICATION CHECKLIST', '─'.repeat(28)];
  for (const r of input.requirements) {
    lines.push(`[ ] REQ ${r.id}: ${r.description}`);
  }
  for (const c of input.constraints) {
    lines.push(`[ ] CON ${c.id}: ${c.constraint} (${c.strength})`);
  }
  for (const p of input.prohibitions) {
    lines.push(`[ ] PROH ${p.id}: must not ${p.prohibition}`);
  }
  for (const d of input.decisions) {
    lines.push(`[ ] DEC ${d.id}: ${d.decision}`);
  }
  return lines.join('\n');
}
