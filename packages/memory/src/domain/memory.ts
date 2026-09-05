import { z } from 'zod';

export const MemoryTypeSchema = z.enum([
  'FACT',
  'PREFERENCE',
  'CONSTRAINT',
  'ARCHITECTURAL_DECISION',
  'ARCHITECTURAL_CONSTRAINT',
  'TECHNOLOGY_CHOICE',
  'REJECTED_APPROACH',
  'LESSON_LEARNED',
  'PROJECT_CONVENTION',
  'HISTORICAL_EVENT',
  'DISCOVERY',
  'WARNING',
]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemoryStatusSchema = z.enum([
  'ACTIVE',
  'SUPERSEDED',
  'DEPRECATED',
  'INVALIDATED',
  'ARCHIVED',
]);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

export const MemoryScopeSchema = z.enum([
  'WORKING',
  'PROJECT',
  'ARCHITECTURAL',
  'HISTORICAL',
]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const SourceTypeSchema = z.enum([
  'CONVERSATION',
  'AGENT',
  'COMMIT',
  'PULL_REQUEST',
  'ADR',
  'DOCUMENT',
  'CODE',
  'TEST',
  'CI',
  'HUMAN',
  'SYSTEM',
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const ProvenanceSchema = z.object({
  source_type: SourceTypeSchema,
  source_id: z.string().min(1),
  project_id: z.string().min(1),
  task_id: z.string().optional(),
  agent_id: z.string().optional(),
  created_at: z.string(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const MemoryRecordSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  type: MemoryTypeSchema,
  scope: MemoryScopeSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  reason: z.string().default(''),
  status: MemoryStatusSchema.default('ACTIVE'),
  importance: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(0.5),
  source_type: SourceTypeSchema,
  source_id: z.string().min(1),
  task_id: z.string().optional(),
  agent_id: z.string().optional(),
  supersedes_id: z.string().optional(),
  entities: z.array(z.string()).default([]),
  embedding_pending: z.boolean().default(true),
  created_at: z.string(),
  updated_at: z.string(),
  last_accessed_at: z.string().optional(),
});
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const MemoryVersionSchema = z.object({
  id: z.string(),
  memory_id: z.string(),
  content: z.string(),
  reason: z.string().default(''),
  status: MemoryStatusSchema,
  source_id: z.string().optional(),
  created_at: z.string(),
});
export type MemoryVersion = z.infer<typeof MemoryVersionSchema>;

export const MemoryCandidateSchema = z.object({
  type: MemoryTypeSchema,
  scope: MemoryScopeSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  reason: z.string().default(''),
  importance: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  entities: z.array(z.string()).default([]),
  source: z.object({
    event_id: z.string(),
    task_id: z.string().optional(),
    source_type: SourceTypeSchema.optional(),
    source_id: z.string().optional(),
    agent_id: z.string().optional(),
  }),
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

export function parseMemory(input: unknown): MemoryRecord {
  return MemoryRecordSchema.parse(input);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newMemoryId(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newVersionId(): string {
  return `mver_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
