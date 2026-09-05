/**
 * Memory Engine daemon — intelligence plane only.
 * Chat critical path must use emitMemoryEvent (void) and lookupMemoryContext (cache).
 */

import { join } from 'node:path';
import * as vscode from 'vscode';
import { MemorySubsystem } from '@singularity/memory';
import { isIntelligenceRemoteMode } from './intelligenceBridge.js';
import { getIntelligenceClient } from './intelligenceWorkerProcess.js';
import { lookupRemoteMemoryContext } from './planeContextCache.js';

let sys: MemorySubsystem | undefined;

export function getMemorySubsystem(): MemorySubsystem | undefined {
  return sys;
}

export function startMemoryDaemon(workspaceRoot: string): MemorySubsystem | undefined {
  if (isIntelligenceRemoteMode()) {
    return undefined;
  }
  const cfg = vscode.workspace.getConfiguration('singularity.ai');
  const enabled = cfg.get<boolean>('memory.enabled', true);
  if (!enabled) {
    return undefined;
  }
  try {
    sys?.stop();
    sys = new MemorySubsystem({
      workspaceRoot,
      projectId: workspaceRoot,
      settings: {
        memory_enabled: enabled,
        extraction_enabled: cfg.get<boolean>('memory.extractionEnabled', true),
        graph_enabled: cfg.get<boolean>('memory.graphEnabled', true),
        vector_search_enabled: cfg.get<boolean>('memory.vectorSearchEnabled', true),
        context_enabled: cfg.get<boolean>('memory.contextEnabled', true),
      },
    });
    void sys.start().catch(() => undefined);
    return sys;
  } catch {
    sys = undefined;
    return undefined;
  }
}

export function disposeMemoryDaemon(): void {
  try {
    sys?.stop();
  } catch {
    /* ignore */
  }
  sys = undefined;
}

const EVENT_MAP: Record<string, string> = {
  USER_INTENT_CAPTURED: 'conversation.completed',
  CODE_CHANGE_COMPLETED: 'code.changed',
  FILE_CREATED: 'code.changed',
  FILE_MODIFIED: 'code.changed',
  FILE_DELETED: 'code.changed',
  COMMIT_CREATED: 'commit.created',
};

/** Coding plane: never throws, never awaits. */
export function emitMemoryEvent(
  event_type: string,
  extra?: {
    changed_files?: string[];
    text?: string;
    session_id?: string;
    task_id?: string;
    commit_id?: string;
    summary?: string;
  },
): void {
  try {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (isIntelligenceRemoteMode()) {
      void getIntelligenceClient()?.postCodingEvent({
        event_type,
        project_id: folder ?? 'default',
        changed_files: extra?.changed_files,
        text: extra?.text ?? extra?.summary,
        session_id: extra?.session_id,
        task_id: extra?.task_id,
        commit_id: extra?.commit_id,
      });
      return;
    }
    sys?.emit({
      event_type: EVENT_MAP[event_type] ?? event_type,
      project_id: folder ?? 'default',
      task_id: extra?.task_id,
      payload: {
        text: extra?.text,
        summary: extra?.summary ?? extra?.text,
        files_changed: extra?.changed_files,
        commit_id: extra?.commit_id,
        session_id: extra?.session_id,
      },
    });
  } catch {
    /* coding continues */
  }
}

/** Coding plane: snapshot/cache only. */
export function lookupMemoryContext(task: string): string {
  try {
    if (sys) {
      return sys.lookup(task);
    }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
      return '';
    }
    if (isIntelligenceRemoteMode()) {
      return lookupRemoteMemoryContext(folder, folder);
    }
    return '';
  } catch {
    return '';
  }
}

export function memoryDbHint(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    return '';
  }
  return join(folder, '.singularity', 'memory', 'memory.sqlite');
}

/** UI categories for Memory shell route. */
export type MemoryUiCategory =
  | 'decisions'
  | 'preferences'
  | 'architecture'
  | 'lessons'
  | 'context';

function memoryCategory(type: string): MemoryUiCategory {
  switch (type) {
    case 'ARCHITECTURAL_DECISION':
    case 'TECHNOLOGY_CHOICE':
    case 'REJECTED_APPROACH':
      return 'decisions';
    case 'PREFERENCE':
    case 'PROJECT_CONVENTION':
      return 'preferences';
    case 'ARCHITECTURAL_CONSTRAINT':
    case 'CONSTRAINT':
      return 'architecture';
    case 'LESSON_LEARNED':
    case 'WARNING':
    case 'DISCOVERY':
      return 'lessons';
    default:
      return 'context';
  }
}

export interface MemoryUiItem {
  id: string;
  category: MemoryUiCategory;
  title: string;
  content: string;
  source?: string;
  confidence: number;
  createdAt?: string;
  updatedAt?: string;
  entities?: string[];
  evidence?: string;
  type?: string;
}

function memoryUiFromRecord(m: {
  id: string;
  type?: string;
  title: string;
  content?: string;
  confidence?: number;
  source_type?: string;
  source_id?: string;
  created_at?: string;
  updated_at?: string;
  entities?: string[];
  score?: number;
}): MemoryUiItem {
  return {
    id: m.id,
    category: memoryCategory(m.type ?? ''),
    title: m.title,
    content: m.content ?? '',
    source: m.source_type && m.source_id ? `${m.source_type}:${m.source_id}` : undefined,
    confidence: m.confidence ?? 0.5,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    entities: m.entities,
    evidence: m.score !== undefined ? `score ${m.score.toFixed(3)}` : undefined,
    type: m.type,
  };
}

/** Thin read adapter for Intelligence Shell — does not alter engine behavior. */
export async function listMemoriesForUi(limit = 100): Promise<MemoryUiItem[]> {
  try {
    if (sys) {
      const list = await sys.store.list({
        project_id: sys.projectId,
        status: 'ACTIVE',
        limit,
      });
      return list.map((m) => ({
        id: m.id,
        category: memoryCategory(m.type),
        title: m.title,
        content: m.content,
        source: `${m.source_type}:${m.source_id}`,
        confidence: m.confidence,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
        entities: m.entities,
        evidence: m.reason || undefined,
        type: m.type,
      }));
    }
    if (isIntelligenceRemoteMode()) {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const client = getIntelligenceClient();
      if (!folder || !client) {
        return [];
      }
      const list = await client.listMemories(folder, limit);
      return list.map((m) => memoryUiFromRecord(m));
    }
    return [];
  } catch {
    return [];
  }
}

export async function removeMemoryForUi(id: string): Promise<boolean> {
  try {
    if (!sys) {
      return false;
    }
    const next = await sys.patchMemory(id, { status: 'ARCHIVED', forget: true });
    return Boolean(next);
  } catch {
    return false;
  }
}

export async function searchMemoriesForUi(query: string, limit = 10): Promise<MemoryUiItem[]> {
  try {
    if (sys) {
      const hits = await sys.search(query, limit, false);
      return hits.map((h) => ({
        id: h.memory.id,
        category: memoryCategory(h.memory.type),
        title: h.memory.title,
        content: h.memory.content,
        source: `${h.memory.source_type}:${h.memory.source_id}`,
        confidence: h.memory.confidence,
        createdAt: h.memory.created_at,
        updatedAt: h.memory.updated_at,
        entities: h.memory.entities,
        evidence: `score ${h.score.toFixed(3)}`,
        type: h.memory.type,
      }));
    }
    if (isIntelligenceRemoteMode()) {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const client = getIntelligenceClient();
      if (!folder || !client) {
        return [];
      }
      const hits = await client.searchMemories(folder, query, limit);
      return hits.map((h) => memoryUiFromRecord(h));
    }
    return [];
  } catch {
    return [];
  }
}
