import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Canonical layout under `.singularity/execution/`. */
export const EXECUTION_DIR = '.singularity/execution';
export const EXECUTION_DB = 'execution.sqlite';
export const GRAPH_SNAPSHOT = 'graph.json';
export const EVENTS_WAL = 'events/events.wal';

export interface ExecutionLayout {
  root: string;
  dbPath: string;
  graphPath: string;
  tasksDir: string;
  artifactsDir: string;
  integrationsDir: string;
  verificationsDir: string;
  eventsWalPath: string;
}

export function resolveExecutionLayout(workspaceRoot: string): ExecutionLayout {
  const root = join(workspaceRoot, EXECUTION_DIR);
  return {
    root,
    dbPath: join(root, EXECUTION_DB),
    graphPath: join(root, GRAPH_SNAPSHOT),
    tasksDir: join(root, 'tasks'),
    artifactsDir: join(root, 'artifacts'),
    integrationsDir: join(root, 'integrations'),
    verificationsDir: join(root, 'verifications'),
    eventsWalPath: join(root, EVENTS_WAL),
  };
}

export function ensureExecutionLayout(workspaceRoot: string): ExecutionLayout {
  const layout = resolveExecutionLayout(workspaceRoot);
  mkdirSync(layout.root, { recursive: true });
  mkdirSync(layout.tasksDir, { recursive: true });
  mkdirSync(layout.artifactsDir, { recursive: true });
  mkdirSync(layout.integrationsDir, { recursive: true });
  mkdirSync(layout.verificationsDir, { recursive: true });
  mkdirSync(join(layout.root, 'events'), { recursive: true });
  return layout;
}

export function writeGraphSnapshot(layout: ExecutionLayout, graph: unknown): void {
  writeFileSync(layout.graphPath, JSON.stringify(graph, null, 2), 'utf8');
}

export function appendEventWal(layout: ExecutionLayout, line: string): void {
  appendFileSync(layout.eventsWalPath, line + '\n', 'utf8');
}
