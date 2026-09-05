/** Typed postMessage protocol for Intelligence Shell. */

export type ShellRoute = 'context' | 'brain' | 'memory' | 'architecture' | 'tasks';

export const SHELL_ROUTES: readonly ShellRoute[] = [
  'context',
  'brain',
  'memory',
  'architecture',
  'tasks',
] as const;

export const ROUTE_LABELS: Record<ShellRoute, string> = {
  context: 'Context',
  brain: 'Brain',
  memory: 'Memory',
  architecture: 'Architecture',
  tasks: 'Tasks',
};

export const ROUTE_HINTS: Record<ShellRoute, string> = {
  context: 'What Singularity currently knows about this project.',
  brain: 'Knowledge graph — entities, relationships, and evidence.',
  memory: 'Decisions, preferences, lessons, and long-term context.',
  architecture: 'System map — components, services, ADRs, dependencies.',
  tasks: 'Long-running engineering work and agent execution.',
};

export function isShellRoute(value: unknown): value is ShellRoute {
  return typeof value === 'string' && (SHELL_ROUTES as readonly string[]).includes(value);
}

/** Host → webview */
export type ShellHostMessage =
  | { type: 'init'; route: ShellRoute; theme: 'dark' | 'light'; projectName?: string; branch?: string; brainScript?: string }
  | { type: 'navigate'; route: ShellRoute }
  | { type: 'contextData'; payload: ContextPayload }
  | { type: 'memoryData'; payload: MemoryPayload }
  | { type: 'architectureData'; payload: ArchitecturePayload }
  | { type: 'tasksData'; payload: TasksPayload }
  | { type: 'searchResults'; query: string; results: SearchResult[] }
  | { type: 'activity'; label: string; detail?: string; progress?: number }
  | { type: 'boot'; label: string; progress?: number }
  | { type: 'toast'; message: string }
  | { type: 'brainForward'; message: Record<string, unknown> };

/** Webview → host */
export type ShellClientMessage =
  | { type: 'ready' }
  | { type: 'navigate'; route: ShellRoute }
  | { type: 'refresh'; route?: ShellRoute }
  | { type: 'search'; query: string }
  | { type: 'openFile'; path: string }
  | { type: 'memoryRemove'; id: string }
  | { type: 'memoryDetail'; id: string }
  | { type: 'adrReview'; id: string; action: 'accept' | 'reject' }
  | { type: 'contextOverride'; kind: string; content: string; category?: string }
  | { type: 'contextRemove'; id: string }
  | { type: 'contextExtract'; text: string }
  | { type: 'taskSelect'; id: string }
  | { type: 'taskClear' }
  | { type: 'brainMessage'; message: Record<string, unknown> }
  | { type: 'archSelect'; id: string }
  | { type: 'archNeighbors'; id: string; depth?: number };

export interface ConfidenceItem {
  id: string;
  title: string;
  subtitle?: string;
  confidence?: number;
  path?: string;
  kind?: string;
  meta?: string;
}

export interface ContextPayload {
  files: ConfidenceItem[];
  architecture: ConfidenceItem[];
  decisions: ConfidenceItem[];
  memories: ConfidenceItem[];
  tasks: ConfidenceItem[];
  changes: ConfidenceItem[];
  dependencies: ConfidenceItem[];
  evidence: ConfidenceItem[];
  flags?: Record<string, boolean | string | number>;
  statusLine?: string;
}

export interface MemoryItem {
  id: string;
  category: 'decisions' | 'preferences' | 'architecture' | 'lessons' | 'context';
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

export interface MemoryPayload {
  items: MemoryItem[];
  categories: Array<{ id: MemoryItem['category']; label: string; count: number }>;
}

export interface ArchNodeView {
  id: string;
  label: string;
  kind: string;
  importance?: number;
}

export interface ArchEdgeView {
  id: string;
  source: string;
  target: string;
  kind: string;
}

export interface AdrView {
  id: string;
  title: string;
  status: string;
  summary?: string;
  updatedAt?: string;
}

export interface ArchitecturePayload {
  nodes: ArchNodeView[];
  edges: ArchEdgeView[];
  adrs: AdrView[];
  drifts?: ConfidenceItem[];
  conflicts?: ConfidenceItem[];
  selected?: {
    id: string;
    label: string;
    kind: string;
    detail?: string;
    neighbors?: ConfidenceItem[];
  };
}

export interface TaskStepView {
  id: string;
  title: string;
  status: 'complete' | 'running' | 'pending' | 'failed' | 'paused';
}

export interface TaskViewPayload {
  id: string;
  title: string;
  status: string;
  progress: number;
  role?: string;
  objective?: string;
  model?: string;
  steps: TaskStepView[];
  ownedPaths?: string[];
  error?: string;
  deltaText?: string;
}

export interface TasksPayload {
  tasks: TaskViewPayload[];
  selectedId?: string;
  summary?: string;
  activityLabel?: string;
}

export interface SearchResult {
  id: string;
  title: string;
  kind: 'file' | 'memory' | 'architecture' | 'task' | 'decision' | 'conversation';
  subtitle?: string;
  why?: string;
  route?: ShellRoute;
  path?: string;
}
