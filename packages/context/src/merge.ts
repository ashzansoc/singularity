/**
 * Merge extraction deltas into ProjectState with conflict detection,
 * supersession, and user-override protection.
 */

import { confidenceCategory, newContextId, nowIso } from './ids.js';
import { redactSecrets } from './redact.js';
import type {
  ArchitectureDecision,
  Constraint,
  ExtractionDelta,
  Goal,
  ItemStatus,
  OpenQuestion,
  Prohibition,
  ProjectEntity,
  ProjectState,
  Requirement,
  SourceReference,
  SourceType,
  Technology,
  UserPreference,
  FileReference,
} from './types.js';

export interface MergeStats {
  created: number;
  updated: number;
  superseded: number;
  open_questions_added: number;
}

function defaultSource(): SourceReference {
  return { type: 'system' };
}

function ensureMeta(
  partial: {
    status?: ItemStatus;
    confidence?: number;
    source_type?: SourceType;
    source?: SourceReference;
    created_at?: string;
    updated_at?: string;
  },
  defaults?: { status?: ItemStatus; confidence?: number; source_type?: SourceType },
) {
  const confidence = partial.confidence ?? defaults?.confidence ?? 0.8;
  const now = nowIso();
  return {
    status: partial.status ?? defaults?.status ?? 'active',
    confidence,
    confidence_category: confidenceCategory(confidence),
    source_type: partial.source_type ?? defaults?.source_type ?? 'explicit',
    source: partial.source ?? defaultSource(),
    created_at: partial.created_at ?? now,
    updated_at: partial.updated_at ?? now,
  };
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function similar(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function isProtected(sourceType: SourceType): boolean {
  return sourceType === 'user_override';
}

export function emptyProjectState(projectId: string, workspaceRoot?: string): ProjectState {
  return {
    meta: {
      project_id: projectId,
      version: 0,
      last_updated: nowIso(),
      workspace_root: workspaceRoot,
    },
    requirements: [],
    constraints: [],
    prohibitions: [],
    technologies: [],
    architecture_decisions: [],
    user_preferences: [],
    current_goals: [],
    open_questions: [],
    entities: [],
    important_files: [],
    source_references: [],
  };
}

/**
 * Apply a delta onto state (mutates a deep copy).
 */
export function mergeDelta(
  state: ProjectState,
  delta: ExtractionDelta,
): { state: ProjectState; stats: MergeStats } {
  const next: ProjectState = structuredClone(state);
  const stats: MergeStats = {
    created: 0,
    updated: 0,
    superseded: 0,
    open_questions_added: 0,
  };
  const now = nowIso();

  // Explicit supersessions first
  for (const s of delta.supersessions ?? []) {
    if (s.kind === 'technology' || s.old_text) {
      for (const t of next.technologies) {
        if (
          t.status === 'active' &&
          s.old_text &&
          similar(t.name, s.old_text) &&
          !isProtected(t.source_type)
        ) {
          t.status = 'superseded';
          t.updated_at = now;
          stats.superseded += 1;
        }
      }
      for (const c of next.constraints) {
        if (
          c.status === 'active' &&
          s.old_text &&
          similar(c.constraint, s.old_text) &&
          !isProtected(c.source_type)
        ) {
          c.status = 'superseded';
          c.updated_at = now;
          stats.superseded += 1;
        }
      }
      for (const d of next.architecture_decisions) {
        if (
          d.status === 'active' &&
          s.old_text &&
          similar(d.decision, s.old_text) &&
          !isProtected(d.source_type)
        ) {
          d.status = 'superseded';
          d.updated_at = now;
          stats.superseded += 1;
        }
      }
    }
  }

    // Technologies
  for (const raw of delta.technologies ?? []) {
    const name = redactSecrets(raw.name);
    // If this name is explicitly superseded in the same delta, skip activating it
    const supersededHere = (delta.supersessions ?? []).some(
      (s) => s.old_text && similar(s.old_text, name),
    );
    if (supersededHere) {
      continue;
    }
    const meta = ensureMeta(raw, {
      status: raw.status,
      confidence: raw.confidence,
      source_type: raw.source_type,
    });

    // Conflict: same category different active tech
    const conflict = next.technologies.find(
      (t) =>
        t.status === 'active' &&
        (raw.category ? t.category === raw.category : true) &&
        !similar(t.name, name) &&
        raw.category &&
        t.category === raw.category &&
        ['database', 'payments', 'framework', 'css'].includes(t.category),
    );

    if (conflict && meta.status === 'active') {
      if (isProtected(conflict.source_type)) {
        next.open_questions.push({
          id: newContextId('q'),
          question: `Conflict: user override keeps ${conflict.name}, but extraction suggests ${name}. Which should we use?`,
          related_item_ids: [conflict.id],
          ...ensureMeta({ status: 'active', confidence: 0.6, source_type: 'inferred' }),
        });
        stats.open_questions_added += 1;
        continue;
      }
      // Recency + explicitness: new explicit wins
      if (
        meta.source_type === 'explicit' ||
        conflict.source_type !== 'explicit'
      ) {
        conflict.status = 'superseded';
        conflict.updated_at = now;
        stats.superseded += 1;
      } else {
        next.open_questions.push({
          id: newContextId('q'),
          question: `Unresolved technology conflict between ${conflict.name} and ${name}`,
          related_item_ids: [conflict.id],
          ...ensureMeta({ status: 'active', confidence: 0.5, source_type: 'inferred' }),
        });
        stats.open_questions_added += 1;
        continue;
      }
    }

    const existing = next.technologies.find(
      (t) => similar(t.name, name) && t.status !== 'superseded',
    );
    if (existing) {
      if (isProtected(existing.source_type) && meta.source_type !== 'user_override') {
        continue;
      }
      Object.assign(existing, {
        ...meta,
        name,
        category: raw.category ?? existing.category,
        role: raw.role ?? existing.role,
        id: existing.id,
        created_at: existing.created_at,
        updated_at: now,
      });
      stats.updated += 1;
    } else {
      const item: Technology = {
        id: newContextId('tech'),
        name,
        category: raw.category ?? 'other',
        role: raw.role,
        ...meta,
      };
      next.technologies.push(item);
      stats.created += 1;
    }
  }

  // Prohibitions vs technologies
  for (const raw of delta.prohibitions ?? []) {
    const prohibition = redactSecrets(raw.prohibition);
    const meta = ensureMeta(raw);
    // Supersede matching active technologies
    for (const t of next.technologies) {
      if (
        t.status === 'active' &&
        similar(t.name, prohibition) &&
        !isProtected(t.source_type)
      ) {
        t.status = 'superseded';
        t.updated_at = now;
        stats.superseded += 1;
      }
    }
    const existing = next.prohibitions.find(
      (p) => similar(p.prohibition, prohibition) && p.status === 'active',
    );
    if (existing) {
      if (isProtected(existing.source_type) && meta.source_type !== 'user_override') {
        continue;
      }
      Object.assign(existing, {
        ...meta,
        prohibition,
        kind: raw.kind ?? existing.kind,
        id: existing.id,
        created_at: existing.created_at,
        updated_at: now,
      });
      stats.updated += 1;
    } else {
      const item: Prohibition = {
        id: newContextId('proh'),
        prohibition,
        kind: raw.kind ?? 'technology',
        ...meta,
      };
      next.prohibitions.push(item);
      stats.created += 1;
    }
  }

  // Constraints
  for (const raw of delta.constraints ?? []) {
    const constraint = redactSecrets(raw.constraint);
    const meta = ensureMeta(raw);
    const existing = next.constraints.find(
      (c) => similar(c.constraint, constraint) && c.status === 'active',
    );
    if (existing) {
      if (isProtected(existing.source_type) && meta.source_type !== 'user_override') {
        continue;
      }
      Object.assign(existing, {
        ...meta,
        constraint,
        kind: raw.kind ?? existing.kind,
        strength: raw.strength ?? existing.strength,
        id: existing.id,
        created_at: existing.created_at,
        updated_at: now,
      });
      stats.updated += 1;
    } else {
      // Detect contradiction with prohibition
      const clash = next.prohibitions.find(
        (p) =>
          p.status === 'active' &&
          similar(p.prohibition, constraint.replace(/^use\s+/i, '')),
      );
      if (clash) {
        if (!isProtected(clash.source_type)) {
          clash.status = 'superseded';
          clash.updated_at = now;
          stats.superseded += 1;
        } else {
          next.open_questions.push({
            id: newContextId('q'),
            question: `Constraint "${constraint}" conflicts with prohibition "${clash.prohibition}"`,
            related_item_ids: [clash.id],
            ...ensureMeta({ status: 'active', confidence: 0.6, source_type: 'inferred' }),
          });
          stats.open_questions_added += 1;
          continue;
        }
      }
      const item: Constraint = {
        id: newContextId('con'),
        constraint,
        kind: raw.kind ?? 'other',
        strength: raw.strength ?? 'hard',
        ...meta,
      };
      next.constraints.push(item);
      stats.created += 1;
    }
  }

  // Requirements
  for (const raw of delta.requirements ?? []) {
    const description = redactSecrets(raw.description);
    const meta = ensureMeta(raw);
    const existing = next.requirements.find(
      (r) => similar(r.description, description) && r.status === 'active',
    );
    if (existing) {
      if (isProtected(existing.source_type) && meta.source_type !== 'user_override') {
        continue;
      }
      Object.assign(existing, {
        ...meta,
        description,
        type: raw.type ?? existing.type,
        priority: raw.priority ?? existing.priority,
        id: existing.id,
        created_at: existing.created_at,
        updated_at: now,
      });
      stats.updated += 1;
    } else {
      const item: Requirement = {
        id: newContextId('req'),
        type: raw.type ?? 'functional',
        description,
        priority: raw.priority ?? 'medium',
        ...meta,
      };
      next.requirements.push(item);
      stats.created += 1;
    }
  }

  // Decisions
  for (const raw of delta.architecture_decisions ?? []) {
    const decision = redactSecrets(raw.decision);
    const meta = ensureMeta(raw);
    const existing = next.architecture_decisions.find(
      (d) => similar(d.decision, decision) && d.status === 'active',
    );
    if (existing) {
      if (isProtected(existing.source_type) && meta.source_type !== 'user_override') {
        continue;
      }
      Object.assign(existing, {
        ...meta,
        decision,
        category: raw.category ?? existing.category,
        alternatives_rejected:
          raw.alternatives_rejected ?? existing.alternatives_rejected,
        rationale: raw.rationale ?? existing.rationale,
        id: existing.id,
        created_at: existing.created_at,
        updated_at: now,
      });
      stats.updated += 1;
    } else {
      // Supersede decisions in same category when alternatives rejected match
      for (const d of next.architecture_decisions) {
        if (
          d.status === 'active' &&
          raw.category &&
          d.category === raw.category &&
          !similar(d.decision, decision) &&
          !isProtected(d.source_type)
        ) {
          d.status = 'superseded';
          d.updated_at = now;
          stats.superseded += 1;
        }
      }
      const item: ArchitectureDecision = {
        id: newContextId('dec'),
        decision,
        category: raw.category ?? 'general',
        alternatives_rejected: raw.alternatives_rejected ?? [],
        rationale: raw.rationale,
        ...meta,
      };
      next.architecture_decisions.push(item);
      stats.created += 1;
    }
  }

  // Preferences
  for (const raw of delta.user_preferences ?? []) {
    const preference = redactSecrets(raw.preference);
    const meta = ensureMeta(raw);
    const existing = next.user_preferences.find(
      (p) => similar(p.preference, preference) && p.status === 'active',
    );
    if (existing) {
      if (isProtected(existing.source_type) && meta.source_type !== 'user_override') {
        continue;
      }
      Object.assign(existing, {
        ...meta,
        preference,
        category: raw.category ?? existing.category,
        id: existing.id,
        created_at: existing.created_at,
        updated_at: now,
      });
      stats.updated += 1;
    } else {
      const item: UserPreference = {
        id: newContextId('pref'),
        preference,
        category: raw.category ?? 'general',
        ...meta,
      };
      next.user_preferences.push(item);
      stats.created += 1;
    }
  }

  // Goals
  for (const raw of delta.current_goals ?? []) {
    const goal = redactSecrets(raw.goal);
    const meta = ensureMeta(raw);
    const existing = next.current_goals.find(
      (g) => similar(g.goal, goal) && g.status === 'active',
    );
    if (existing) {
      Object.assign(existing, {
        ...meta,
        goal,
        priority: raw.priority ?? existing.priority,
        id: existing.id,
        created_at: existing.created_at,
        updated_at: now,
      });
      stats.updated += 1;
    } else {
      const item: Goal = {
        id: newContextId('goal'),
        goal,
        priority: raw.priority ?? 'medium',
        ...meta,
      };
      next.current_goals.push(item);
      stats.created += 1;
    }
  }

  // Open questions
  for (const raw of delta.open_questions ?? []) {
    const question = redactSecrets(raw.question);
    const meta = ensureMeta(raw);
    const item: OpenQuestion = {
      id: newContextId('q'),
      question,
      related_item_ids: raw.related_item_ids ?? [],
      ...meta,
    };
    next.open_questions.push(item);
    stats.created += 1;
    stats.open_questions_added += 1;
  }

  // Entities
  for (const raw of delta.entities ?? []) {
    const name = redactSecrets(raw.name);
    const meta = ensureMeta(raw);
    const existing = next.entities.find(
      (e) => similar(e.name, name) && e.status === 'active',
    );
    if (existing) {
      Object.assign(existing, {
        ...meta,
        name,
        entity_type: raw.entity_type ?? existing.entity_type,
        description: raw.description ?? existing.description,
        id: existing.id,
        created_at: existing.created_at,
        updated_at: now,
      });
      stats.updated += 1;
    } else {
      const item: ProjectEntity = {
        id: newContextId('ent'),
        name,
        entity_type: raw.entity_type ?? 'other',
        description: raw.description,
        ...meta,
      };
      next.entities.push(item);
      stats.created += 1;
    }
  }

  // Files
  for (const raw of delta.important_files ?? []) {
    const path = raw.path;
    const meta = ensureMeta(raw);
    const existing = next.important_files.find(
      (f) => similar(f.path, path) && f.status === 'active',
    );
    if (existing) {
      Object.assign(existing, {
        ...meta,
        path,
        reason: raw.reason ?? existing.reason,
        related_item_ids: raw.related_item_ids ?? existing.related_item_ids,
        id: existing.id,
        created_at: existing.created_at,
        updated_at: now,
      });
      stats.updated += 1;
    } else {
      const item: FileReference = {
        id: newContextId('file'),
        path,
        reason: raw.reason,
        related_item_ids: raw.related_item_ids ?? [],
        ...meta,
      };
      next.important_files.push(item);
      stats.created += 1;
    }
  }

  next.meta.version += 1;
  next.meta.last_updated = now;
  return { state: next, stats };
}

/**
 * Apply a user override (highest priority).
 */
export function applyUserOverride(
  state: ProjectState,
  kind:
    | 'requirement'
    | 'constraint'
    | 'prohibition'
    | 'technology'
    | 'decision'
    | 'preference',
  content: string,
  extra?: { category?: string; replaceId?: string },
): ProjectState {
  const delta: ExtractionDelta = {};
  const base = {
    status: 'active' as const,
    confidence: 1,
    source_type: 'user_override' as const,
    source: { type: 'user_override' as const },
  };
  if (kind === 'technology') {
    delta.technologies = [
      { name: content, category: extra?.category ?? 'other', ...base },
    ];
  } else if (kind === 'requirement') {
    delta.requirements = [
      { description: content, type: 'functional', priority: 'high', ...base },
    ];
  } else if (kind === 'constraint') {
    delta.constraints = [
      {
        constraint: content,
        kind: 'other',
        strength: 'hard',
        ...base,
      },
    ];
  } else if (kind === 'prohibition') {
    delta.prohibitions = [{ prohibition: content, kind: 'other', ...base }];
  } else if (kind === 'decision') {
    delta.architecture_decisions = [
      {
        decision: content,
        category: extra?.category ?? 'general',
        alternatives_rejected: [],
        ...base,
      },
    ];
  } else {
    delta.user_preferences = [
      { preference: content, category: extra?.category ?? 'general', ...base },
    ];
  }

  let working = state;
  if (extra?.replaceId) {
    working = structuredClone(state);
    const collections = [
      working.requirements,
      working.constraints,
      working.prohibitions,
      working.technologies,
      working.architecture_decisions,
      working.user_preferences,
    ];
    for (const col of collections) {
      const item = col.find((x) => x.id === extra.replaceId);
      if (item && !isProtected(item.source_type)) {
        item.status = 'superseded';
        item.updated_at = nowIso();
      }
    }
  }
  return mergeDelta(working, delta).state;
}

/**
 * Delete or archive an item by id.
 */
export function removeItem(
  state: ProjectState,
  id: string,
  mode: 'archive' | 'delete' = 'archive',
): ProjectState {
  const next = structuredClone(state);
  const collections: Array<Array<{ id: string; status: ItemStatus; updated_at: string }>> = [
    next.requirements,
    next.constraints,
    next.prohibitions,
    next.technologies,
    next.architecture_decisions,
    next.user_preferences,
    next.current_goals,
    next.open_questions,
    next.entities,
    next.important_files,
  ];
  for (const col of collections) {
    const idx = col.findIndex((x) => x.id === id);
    if (idx >= 0) {
      if (mode === 'delete') {
        col.splice(idx, 1);
      } else {
        col[idx]!.status = 'archived';
        col[idx]!.updated_at = nowIso();
      }
      next.meta.version += 1;
      next.meta.last_updated = nowIso();
      break;
    }
  }
  return next;
}
