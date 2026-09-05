/**
 * Architecture Intelligence daemon — intelligence plane only.
 * Chat critical path must use emitArchitectureEvent (void) and
 * lookupArchitectureContext (cache read) — never start/stop/search.
 */

import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  createArchitectureSubsystem,
  type ArchitectureSubsystem,
  type GraphSink,
} from '@singularity/architecture';
import { codeImpactFromEngine, type IntelligenceEngine } from '@singularity/intelligence';
import { emitMemoryEvent, getMemorySubsystem } from './memoryBridge.js';
import { singularityWarn } from './singularityLog.js';
import { isIntelligenceRemoteMode } from './intelligenceBridge.js';
import { getIntelligenceClient } from './intelligenceWorkerProcess.js';
import { lookupRemoteArchitectureContext } from './planeContextCache.js';

let sys: ArchitectureSubsystem | undefined;

export function getArchitectureSubsystem(): ArchitectureSubsystem | undefined {
  return sys;
}

function graphSink(engine: IntelligenceEngine): GraphSink {
  return {
    upsertAdr(node) {
      engine.store.upsertNodes([
        {
          id: node.id,
          kind: 'adr',
          label: node.title,
          content: node.content,
          hash: node.id,
          version: 1,
          tokenCount: Math.max(1, Math.ceil(node.content.length / 4)),
          dependencies: [],
          lastModified: Date.now(),
        },
      ]);
    },
    upsertEdge(from, to, kind) {
      const k = kind.toUpperCase();
      const edgeKind =
        k === 'AFFECTS' ? 'affects' : k === 'IMPLEMENTED_BY' || k === 'IMPLEMENTS' ? 'implements' : 'related_to';
      engine.store.upsertEdges([
        {
          id: `${from}:${edgeKind}:${to}`,
          from,
          to,
          kind: edgeKind,
        },
      ]);
    },
  };
}

export function startArchitectureDaemon(
  workspaceRoot: string,
  engine?: IntelligenceEngine,
): ArchitectureSubsystem | undefined {
  if (isIntelligenceRemoteMode()) {
    return undefined;
  }
  const cfg = vscode.workspace.getConfiguration('singularity.ai');
  const enabled = cfg.get<boolean>('architecture.enabled', true);
  if (!enabled) {
    return undefined;
  }
  try {
    sys?.stop();
    sys = createArchitectureSubsystem({
      workspaceRoot,
      projectId: workspaceRoot,
      heuristicOnly: false,
      flags: {
        architecture_memory_enabled: enabled,
        adr_extraction_enabled: cfg.get<boolean>('architecture.extractionEnabled', true),
        architecture_graph_enabled: cfg.get<boolean>('architecture.graphEnabled', true),
        architecture_vector_search_enabled: cfg.get<boolean>(
          'architecture.vectorSearchEnabled',
          true,
        ),
        architecture_drift_detection_enabled: cfg.get<boolean>(
          'architecture.driftDetectionEnabled',
          true,
        ),
        architecture_conflict_detection_enabled: cfg.get<boolean>(
          'architecture.conflictDetectionEnabled',
          true,
        ),
        architecture_evolution_enabled: cfg.get<boolean>(
          'architecture.evolutionEnabled',
          true,
        ),
        architecture_context_enabled: cfg.get<boolean>('architecture.contextEnabled', true),
        production_awareness_enabled: cfg.get<boolean>(
          'architecture.productionAwarenessEnabled',
          true,
        ),
      },
      graph: engine ? graphSink(engine) : undefined,
      codeImpact: engine ? codeImpactFromEngine(engine) : undefined,
      memorySink: {
        remember(input) {
          getMemorySubsystem()?.emit({
            event_type: 'architecture.decision',
            project_id: input.project_id,
            payload: {
              summary: input.title,
              text: `${input.title}. ${input.content}. ${input.reason ?? ''}`,
              source_id: input.source_id,
              entities: input.entities,
            },
          });
        },
      },
    });
    void sys.start().catch(() => {
      /* coding continues */
    });
    return sys;
  } catch (e) {
    singularityWarn('[singularity-ai] Architecture Intelligence failed to start', e);
    sys = undefined;
    return undefined;
  }
}

export function disposeArchitectureDaemon(): void {
  try {
    sys?.stop();
  } catch {
    /* ignore */
  }
  sys = undefined;
}

/** Coding plane: never throws, never awaits. */
export function emitArchitectureEvent(
  event_type:
    | 'USER_INTENT_CAPTURED'
    | 'CODE_CHANGE_COMPLETED'
    | 'FILE_CREATED'
    | 'FILE_MODIFIED'
    | 'FILE_DELETED'
    | 'COMMIT_CREATED',
  extra?: {
    changed_files?: string[];
    text?: string;
    session_id?: string;
    task_id?: string;
    commit_id?: string;
  },
): void {
  try {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (isIntelligenceRemoteMode()) {
      void getIntelligenceClient()?.postCodingEvent({
        event_type,
        project_id: folder ?? 'default',
        changed_files: extra?.changed_files,
        text: extra?.text,
        session_id: extra?.session_id,
        task_id: extra?.task_id,
        commit_id: extra?.commit_id,
      });
      return;
    }
    sys?.emit({
      event_type,
      project_id: folder ?? 'default',
      changed_files: extra?.changed_files,
      session_id: extra?.session_id,
      task_id: extra?.task_id,
      commit_id: extra?.commit_id,
      payload: extra?.text ? { text: extra.text } : undefined,
    });
  } catch {
    /* coding continues */
  }
  if (!isIntelligenceRemoteMode()) {
    emitMemoryEvent(event_type, extra);
  }
}

/** Coding plane: cache-only prompt block. */
export function lookupArchitectureContext(task: string): string {
  try {
    if (sys) {
      return sys.lookup(task);
    }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
      return '';
    }
    if (isIntelligenceRemoteMode()) {
      return lookupRemoteArchitectureContext(folder, task);
    }
    return '';
  } catch {
    return '';
  }
}

export function architectureDbHint(): string {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    return '';
  }
  return join(folder, '.singularity', 'architecture', 'architecture.sqlite');
}

export interface ArchitectureUiSnapshot {
  nodes: Array<{ id: string; label: string; kind: string; importance?: number }>;
  edges: Array<{ id: string; source: string; target: string; kind: string }>;
  adrs: Array<{
    id: string;
    title: string;
    status: string;
    summary?: string;
    updatedAt?: string;
  }>;
  drifts: Array<{ id: string; title: string; subtitle?: string }>;
  conflicts: Array<{ id: string; title: string; subtitle?: string }>;
}

let remoteArchUiCache: ArchitectureUiSnapshot | undefined;
let remoteArchUiAt = 0;

async function refreshRemoteArchitectureUi(): Promise<ArchitectureUiSnapshot> {
  const empty: ArchitectureUiSnapshot = {
    nodes: [],
    edges: [],
    adrs: [],
    drifts: [],
    conflicts: [],
  };
  const client = getIntelligenceClient();
  if (!client) {
    return empty;
  }
  const [graph, adrs, drifts, conflicts] = await Promise.all([
    client.architectureGraph('workspace', 2),
    client.architectureDecisions(),
    client.architectureDrifts(),
    client.architectureConflicts(),
  ]);
  return {
    nodes: (graph?.nodes ?? []).map((n) => ({
      id: n.id,
      label: n.label ?? n.id,
      kind: n.kind ?? 'node',
      importance: 0.5,
    })),
    edges: (graph?.edges ?? []).map((e) => ({
      id: e.id,
      source: e.from ?? '',
      target: e.to ?? '',
      kind: e.kind ?? 'related',
    })),
    adrs: adrs.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status ?? 'unknown',
      summary: a.decision?.summary,
      updatedAt: a.timestamps?.updated_at,
    })),
    drifts: drifts.map((d) => ({
      id: d.id,
      title: d.kind ?? 'drift',
      subtitle: d.reason || d.adr_id,
    })),
    conflicts: conflicts.map((c) => ({
      id: c.id,
      title: c.reason || 'Conflict',
      subtitle: c.adr_id,
    })),
  };
}

/** Thin read adapter for Architecture shell route. */
export function listArchitectureForUi(): ArchitectureUiSnapshot {
  const empty: ArchitectureUiSnapshot = {
    nodes: [],
    edges: [],
    adrs: [],
    drifts: [],
    conflicts: [],
  };
  try {
    if (sys) {
      const nodes = sys.archGraph.listNodes().map((n) => ({
        id: n.id,
        label: n.label ?? n.id,
        kind: n.kind,
        importance: 0.5,
      }));
      const edges = sys.archGraph.listEdges().map((e) => ({
        id: e.id,
        source: e.from,
        target: e.to,
        kind: e.kind,
      }));
      const adrs = sys.store.list({ project_id: sys.projectId }).map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        summary: a.decision?.summary,
        updatedAt: a.timestamps?.updated_at,
      }));
      const drifts = sys.store.listDrifts(sys.projectId).map((d) => ({
        id: d.id,
        title: d.kind,
        subtitle: d.reason || d.adr_id,
      }));
      const conflicts = sys.store.listConflicts(sys.projectId).map((c) => ({
        id: c.id,
        title: c.reason || 'Conflict',
        subtitle: c.adr_id,
      }));
      return { nodes, edges, adrs, drifts, conflicts };
    }
    if (isIntelligenceRemoteMode()) {
      const now = Date.now();
      if (remoteArchUiCache && now - remoteArchUiAt < 8_000) {
        return remoteArchUiCache;
      }
      void refreshRemoteArchitectureUi().then((snap) => {
        remoteArchUiCache = snap;
        remoteArchUiAt = Date.now();
      });
      return remoteArchUiCache ?? empty;
    }
    return empty;
  } catch {
    return empty;
  }
}

export function architectureNeighborsForUi(
  id: string,
  depth = 1,
): Array<{ id: string; title: string; subtitle?: string }> {
  try {
    if (sys) {
      const { nodes } = sys.archGraph.neighbors(id, depth);
      return nodes.map((n) => ({
        id: n.id,
        title: n.label ?? n.id,
        subtitle: n.kind,
      }));
    }
    if (isIntelligenceRemoteMode()) {
      const client = getIntelligenceClient();
      if (!client) {
        return [];
      }
      void client.architectureGraph(id, depth).then((graph) => {
        if (!graph?.nodes?.length) {
          return;
        }
        const snap = remoteArchUiCache ?? listArchitectureForUi();
        remoteArchUiCache = {
          ...snap,
          nodes: graph.nodes.map((n) => ({
            id: n.id,
            label: n.label ?? n.id,
            kind: n.kind ?? 'node',
            importance: 0.5,
          })),
        };
        remoteArchUiAt = Date.now();
      });
      return [];
    }
    return [];
  } catch {
    return [];
  }
}
