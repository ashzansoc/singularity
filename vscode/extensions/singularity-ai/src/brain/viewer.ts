/**
 * Singularity Brain — WebGL graph viewer (webview side).
 *
 * Sigma.js + Graphology with a Barnes-Hut ForceAtlas2 layout on a near-black
 * canvas. Receives typed postMessages from intelligenceShell/shellPanel.ts:
 *   init {types} · graph {view, merge} · progress {event} · detail {detail} · searchResults
 * Sends back: ready / refresh / sync / detail / expand / search.
 */

import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { Attributes } from 'graphology-types';

interface TypeMeta {
  type: string;
  label: string;
  color: string;
  order: number;
}

interface ViewNode {
  id: string;
  label: string;
  type: string;
  importance: number;
  projectId?: string;
  lastSeenAt: number;
  cluster?: string;
  authority?: string;
  degree?: number;
}

interface ViewEdge {
  id: string;
  source: string;
  target: string;
  relType: string;
  confidence: number;
}

interface GraphView {
  nodes: ViewNode[];
  edges: ViewEdge[];
  truncated: boolean;
}

interface EntityDetail {
  id: string;
  label: string;
  type: string;
  description?: string;
  importance: number;
  confidence: number;
  projectId?: string;
  lastSeenAt: number;
  projects: Array<{ projectId: string }>;
  related: Array<{ id: string; label: string; type: string; relType: string; direction: string }>;
  decisions: string[];
  learnings: string[];
}

const vscode = acquireVsCodeApi();

const app = (document.getElementById('brain-root') ?? document.getElementById('app')) as HTMLDivElement;

// ---- Shell -----------------------------------------------------------------

app.innerHTML = `
<style>
  :root { --bg:#0f0f0f; --panel:#141414; --line:rgba(255,255,255,.08); --text:#e8e8e8; --dim:#9a9a9a; }
  html,body{margin:0;height:100%;background:var(--bg);color:var(--text);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  #brain-root{position:fixed;inset:0;display:flex;flex-direction:column}
  #stage{flex:1;position:relative;background:var(--bg);}
  #sigma-container{position:absolute;inset:0}
  .topbar{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:20;align-items:center}
  .searchwrap{display:flex;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:6px 12px}
  .searchwrap input{background:transparent;border:none;outline:none;color:var(--text);width:280px;font-size:13px}
  .searchwrap .icon{opacity:.5;margin-right:8px;font-size:13px}
  .chip{background:var(--panel);border:1px solid var(--line);color:var(--dim);border-radius:10px;padding:7px 12px;font-size:12px;cursor:pointer;transition:.15s}
  .chip:hover{color:var(--text);border-color:rgba(255,255,255,.2)}
  .chip.active{color:#fff;border-color:rgba(140,120,255,.6);box-shadow:0 0 12px rgba(120,100,255,.15)}
  #sync-pill{position:absolute;top:14px;left:16px;display:flex;align-items:center;gap:7px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:7px 12px;font-size:12px;color:var(--dim);z-index:20}
  #sync-dot{width:7px;height:7px;border-radius:50%;background:#3d3d52;transition:.3s}
  #sync-dot.busy{background:#ffd866;box-shadow:0 0 8px rgba(255,216,102,.8);animation:pulse 1.2s infinite}
  #sync-dot.ok{background:#50fa7b}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  #filters{position:absolute;top:56px;left:16px;display:flex;flex-direction:column;gap:4px;z-index:19;max-height:42vh;overflow-y:auto}
  #cluster-chips{position:absolute;top:56px;right:16px;display:flex;flex-wrap:wrap;gap:6px;z-index:19;max-width:280px;justify-content:flex-end}
  .cluster-chip{background:var(--panel);border:1px solid var(--line);color:var(--dim);border-radius:8px;padding:5px 10px;font-size:11px;cursor:pointer;letter-spacing:.02em;user-select:none}
  .cluster-chip:hover{color:var(--text);border-color:rgba(255,255,255,.22)}
  .cluster-chip.off{opacity:.35;text-decoration:line-through}
  .cluster-chip.on{color:#e8e8f4;border-color:rgba(160,150,255,.45)}
  .filter-row{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--dim);cursor:pointer;padding:3px 6px;border-radius:6px;user-select:none}
  .filter-row:hover{color:var(--text);background:rgba(255,255,255,.04)}
  .filter-row .swatch{width:8px;height:8px;border-radius:50%}
  .filter-row.off{opacity:.32;text-decoration:line-through}
  /* Empty state */
  #empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;z-index:25;background:var(--bg);transition:opacity .6s}
  #empty h1{font-size:18px;font-weight:600;margin:0 0 10px;letter-spacing:-0.01em;color:var(--text)}
  #empty p{color:var(--dim);font-size:13px;line-height:1.6;max-width:420px;margin:0 0 24px}
  #empty button{background:#1c1c1c;border:1px solid var(--line);color:var(--text);font-size:12.5px;padding:8px 16px;border-radius:6px;cursor:pointer;transition:background .15s}
  #empty button:hover{background:#222}
  /* Inspector */
  #inspector{position:absolute;top:0;right:0;bottom:0;width:330px;background:var(--panel);border-left:1px solid var(--line);backdrop-filter:blur(14px);z-index:22;padding:22px 20px;transform:translateX(105%);transition:transform .25s ease;overflow-y:auto}
  #inspector.open{transform:translateX(0)}
  #inspector h2{margin:0 0 2px;font-size:17px;font-weight:600}
  #inspector .type-line{font-size:12px;color:var(--dim);margin-bottom:14px}
  #inspector .sec{margin-top:16px}
  #inspector .sec h3{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--dim);margin:0 0 7px}
  #inspector ul{list-style:none;padding:0;margin:0;font-size:12.5px;line-height:1.75}
  #inspector li b{color:#fff}
  #inspector .desc{font-size:12.5px;color:#bdbdcf;line-height:1.65}
  #inspector .meta{font-size:11.5px;color:var(--dim)}
  #inspector .close{position:absolute;top:14px;right:16px;background:none;border:none;color:var(--dim);font-size:16px;cursor:pointer}
  #inspector .expand-btn{margin-top:14px;width:100%;background:rgba(255,255,255,.06);border:1px solid var(--line);color:var(--text);padding:8px;border-radius:8px;cursor:pointer;font-size:12px}
  #inspector .expand-btn:hover{background:rgba(255,255,255,.1)}
  #search-results{position:absolute;top:52px;left:50%;transform:translateX(-50%);width:340px;max-height:300px;overflow-y:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;z-index:21;display:none;backdrop-filter:blur(14px)}
  .sr-item{padding:9px 14px;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:9px;border-bottom:1px solid rgba(255,255,255,.04)}
  .sr-item:last-child{border-bottom:none}
  .sr-item:hover{background:rgba(255,255,255,.06)}
  .sr-item .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
  .sr-item .via{margin-left:auto;color:var(--dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}
  #hint{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);font-size:11px;color:rgba(140,140,160,.55);z-index:18;pointer-events:none}
  #delta-toast{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 14px;font-size:12px;color:var(--text);z-index:22;opacity:0;transition:opacity .25s;pointer-events:none}
  #delta-toast.show{opacity:1}
  #side-panels{position:absolute;bottom:14px;right:16px;display:flex;gap:8px;z-index:20}
  #insights-panel,#activity-panel{position:absolute;top:56px;right:16px;width:300px;max-height:55vh;overflow-y:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;z-index:21;display:none;backdrop-filter:blur(14px);padding:12px}
  #insights-panel h3,#activity-panel h3{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim)}
  .insight-item,.activity-item{padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px}
  .insight-item:last-child,.activity-item:last-child{border-bottom:none}
  .insight-item .title{font-weight:600;margin-bottom:4px}
  .insight-item .meta{color:var(--dim);font-size:11px;margin-bottom:6px}
  .insight-actions{display:flex;gap:6px;flex-wrap:wrap}
  .insight-actions button{background:rgba(255,255,255,.06);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:3px 8px;font-size:10.5px;cursor:pointer}
  .activity-item .ts{color:var(--dim);font-size:10.5px;margin-right:6px}
</style>
<div id="brain-root">
  <div id="stage">
    <div id="sigma-container"></div>
    <div id="sync-pill"><div id="sync-dot"></div><span id="sync-label">Brain Idle</span></div>
    <div class="topbar">
      <div class="searchwrap"><span class="icon">⌕</span><input id="search" placeholder="Search your Brain…" /></div>
      <button class="chip" id="btn-sync">Sync Everything</button>
      <button class="chip" id="btn-insights">Insights</button>
      <button class="chip" id="btn-activity">Activity</button>
      <button class="chip" id="btn-ultrathink">UltraThink</button>
      <button class="chip" id="btn-reset">Reset view</button>
    </div>
    <div id="filters"></div>
    <div id="cluster-chips"></div>
    <div id="search-results"></div>
    <div id="insights-panel"><h3>Brain Insights</h3><div id="insights-body"></div></div>
    <div id="activity-panel"><h3>Brain Activity</h3><div id="activity-body"></div></div>
    <div id="delta-toast"></div>
    <div id="empty">
      <h1>Singularity Brain</h1>
      <p>Your persistent cognitive memory is waiting to be initialized.<br/>Observe, remember, reason, and improve — quietly.</p>
      <button id="btn-initial-sync">[ Sync Everything ]</button>
    </div>
    <div id="hint">scroll to zoom · drag to pan · click a node to inspect · Insights / Activity for cognitive timeline</div>
  </div>
  <div id="inspector"><button class="close">✕</button><div id="inspector-body"></div></div>
</div>`;

const container = document.getElementById('sigma-container') as HTMLElement;
const emptyEl = document.getElementById('empty') as HTMLElement;
const inspector = document.getElementById('inspector') as HTMLElement;
const inspectorBody = document.getElementById('inspector-body') as HTMLElement;
const filtersEl = document.getElementById('filters') as HTMLElement;
const clusterChipsEl = document.getElementById('cluster-chips') as HTMLElement;
const syncDot = document.getElementById('sync-dot') as HTMLElement;
const syncLabel = document.getElementById('sync-label') as HTMLElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const searchResultsEl = document.getElementById('search-results') as HTMLElement;

let types: TypeMeta[] = [];
const colorOf = new Map<string, string>();
let selectedId: string | null = null;
let hoveredId: string | null = null;
const disabledTypes = new Set<string>();
/** Progressive disclosure: hide whole semantic layers (empty = show all). */
const disabledClusters = new Set<string>();
const CLUSTER_LABELS: Record<string, string> = {
  architecture: 'Architecture',
  code: 'Code',
  dependencies: 'Dependencies',
  decisions: 'Decisions',
  evaluation: 'Evaluation',
  memory: 'Memory',
  problems: 'Problems',
  solutions: 'Solutions',
  tasks: 'Tasks',
  project: 'Project',
  models: 'Models',
  runtime: 'Runtime',
};
let hasData = false;

function typeColor(t: string): string {
  const known = types.find((x) => x.type === t);
  if (known) {
    return known.color;
  }
  // Stable hash → hue for dynamic/unknown categories.
  let h = 0;
  for (let i = 0; i < t.length; i++) {
    h = (h * 31 + t.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 62%, 62%)`;
}

// ---- Graph -------------------------------------------------------------------

const graph = new Graph<Attributes>({ multi: true, type: 'undirected', allowSelfLoops: false });
const renderer = new Sigma(graph, container, {
  allowInvalidContainer: true,
  renderEdgeLabels: false,
  defaultEdgeColor: 'rgba(160,170,210,0.28)',
  defaultEdgeType: 'line',
  minCameraRatio: 0.01,
  maxCameraRatio: 18,
  labelDensity: 0.55,
  labelGridCellSize: 70,
  labelRenderedSizeThreshold: 8,
  labelColor: { color: '#c8c8d8' },
  defaultNodeColor: '#8888aa',
  zIndex: true,
});

function nodeSize(importance: number, brainType?: string): number {
  const base = 3 + Math.pow(Math.max(0, Math.min(1, importance)), 1.35) * 18;
  // Project root stays visually small — never a giant hub.
  if (brainType === 'project') {
    return Math.min(base, 7);
  }
  if (brainType === 'architecture' || brainType === 'topic') {
    return Math.max(base, 8);
  }
  return base;
}

const CLUSTER_ANGLE: Record<string, number> = {
  architecture: 0,
  code: Math.PI * 0.35,
  dependencies: Math.PI * 0.7,
  decisions: Math.PI * 1.05,
  evaluation: Math.PI * 1.4,
  memory: Math.PI * 1.75,
  problems: Math.PI * 2.1,
  solutions: Math.PI * 2.45,
  tasks: Math.PI * 2.8,
  project: Math.PI * 3.15,
  models: Math.PI * 3.5,
  runtime: Math.PI * 3.85,
};

const REL_EDGE_COLOR: Record<string, string> = {
  depends_on: '170,200,255',
  uses: '120,220,160',
  part_of: '200,170,255',
  contains: '160,180,220',
  related_to: '140,150,180',
  informs: '255,210,120',
  affects: '255,160,120',
  decided: '255,220,100',
  replaced_by: '255,140,180',
  failed_because: '255,100,100',
  solved_by: '100,230,160',
  implemented_in: '140,190,255',
};

/** Scatter nodes into cluster sectors so ForceAtlas2 forms multi-center layout. */
function seedPositions(force = false): void {
  const clusterCounts = new Map<string, number>();
  graph.forEachNode((_key, attr) => {
    const c = String(attr.cluster ?? attr.brainType ?? 'memory');
    clusterCounts.set(c, (clusterCounts.get(c) ?? 0) + 1);
  });
  const clusterIdx = new Map<string, number>();
  graph.forEachNode((key) => {
    const x = graph.getNodeAttribute(key, 'x');
    const y = graph.getNodeAttribute(key, 'y');
    const stacked = typeof x !== 'number' || typeof y !== 'number' || (x === 0 && y === 0);
    if (!(force || stacked)) {
      return;
    }
    const cluster = String(graph.getNodeAttribute(key, 'cluster') ?? graph.getNodeAttribute(key, 'brainType') ?? 'memory');
    const idx = clusterIdx.get(cluster) ?? 0;
    clusterIdx.set(cluster, idx + 1);
    const baseAngle = CLUSTER_ANGLE[cluster] ?? ((cluster.charCodeAt(0) % 12) * (Math.PI / 6));
    const count = Math.max(1, clusterCounts.get(cluster) ?? 1);
    const spread = (idx / count) * 1.1 - 0.55;
    const angle = baseAngle + spread;
    const ring = 90 + 55 * Math.sqrt(idx + 1);
    graph.setNodeAttribute(key, 'x', ring * Math.cos(angle));
    graph.setNodeAttribute(key, 'y', ring * Math.sin(angle));
  });
}

function runLayout(iterations = 220): void {
  if (graph.order === 0) {
    return;
  }
  seedPositions(true);
  const settings = {
    ...forceAtlas2.inferSettings(graph),
    gravity: 0.05,
    scalingRatio: 32,
    strongGravityMode: false,
    slowDown: 2.4,
    barnesHutOptimize: graph.order > 80,
    outboundAttractionDistribution: true,
  };
  forceAtlas2.assign(graph, { iterations: Math.min(iterations, 120), settings });
  forceAtlas2.assign(graph, {
    iterations: Math.max(40, Math.floor(iterations / 2)),
    settings: { ...settings, slowDown: 4.5, gravity: 0.035 },
  });
}

function fitCamera(): void {
  if (graph.order === 0) {
    return;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  graph.forEachNode((_k, attr) => {
    const x = Number(attr.x ?? 0);
    const y = Number(attr.y ?? 0);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const span = Math.max(maxX - minX, maxY - minY, 40);
  const ratio = Math.min(2.4, Math.max(0.08, span / 520));
  renderer.getCamera().animate({ x: cx, y: cy, ratio }, { duration: 450 });
}

function applyStyle(): void {
  const focusId = hoveredId ?? selectedId;
  const neighbors = focusId ? new Set<string>([focusId]) : null;
  if (focusId && neighbors) {
    graph.forEachNeighbor(focusId, (n) => neighbors.add(n));
  }
  graph.forEachNode((key, attr) => {
    const cluster = String(attr.cluster ?? attr.brainType ?? 'memory');
    const dimmedByType = disabledTypes.has(String(attr.brainType ?? ''));
    const dimmedByCluster = disabledClusters.has(cluster);
    const outOfFocus = Boolean(focusId && neighbors && !neighbors.has(key));
    const base = String(attr.brainColor ?? '#8888aa');
    const hidden = dimmedByType || dimmedByCluster;
    graph.mergeNodeAttributes(key, {
      color: hidden ? 'rgba(80,80,100,0.12)' : outOfFocus ? softDim(base, 0.35) : base,
      size: nodeSize(Number(attr.importance ?? 0.5), String(attr.brainType ?? '')) * (key === selectedId ? 1.25 : 1),
      hidden,
      zIndex: key === selectedId || key === hoveredId ? 2 : outOfFocus ? 0 : 1,
    });
  });
  graph.forEachEdge((key, attr, s, t) => {
    const inFocus = !focusId || (neighbors!.has(s) && neighbors!.has(t));
    const conf = Number(attr.weight ?? 0.5);
    const rel = String(attr.relType ?? 'related_to');
    const rgb = REL_EDGE_COLOR[rel] ?? '170,185,230';
    graph.mergeEdgeAttributes(key, {
      color: inFocus
        ? `rgba(${rgb},${0.28 + 0.4 * conf})`
        : `rgba(${rgb},0.07)`,
      size: inFocus ? 0.75 + conf * 1.5 : 0.35,
      hidden: Boolean(graph.getNodeAttribute(s, 'hidden') || graph.getNodeAttribute(t, 'hidden')),
      zIndex: inFocus ? 1 : 0,
    });
  });
  renderer.refresh();
}

function softDim(hexOrCss: string, alpha: number): string {
  // Prefer keeping hue so clusters stay recognizable while dimmed.
  if (hexOrCss.startsWith('#') && (hexOrCss.length === 7 || hexOrCss.length === 4)) {
    const h = hexOrCss.length === 4
      ? `#${hexOrCss[1]}${hexOrCss[1]}${hexOrCss[2]}${hexOrCss[2]}${hexOrCss[3]}${hexOrCss[3]}`
      : hexOrCss;
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `rgba(140,145,170,${alpha})`;
}

function mergeView(view: GraphView, replace = false): void {
  if (replace) {
    graph.clear();
    selectedId = null;
    hoveredId = null;
    inspector.classList.remove('open');
  }
  for (const n of view.nodes) {
    if (!graph.hasNode(n.id)) {
      graph.addNode(n.id, {
        label: n.label.length > 34 ? n.label.slice(0, 32) + '…' : n.label,
        size: nodeSize(n.importance, n.type),
        x: 0,
        y: 0,
        importance: n.importance,
        brainType: n.type,
        brainColor: typeColor(n.type),
        cluster: n.cluster ?? n.type,
        projectId: n.projectId ?? '',
      });
    } else {
      graph.mergeNodeAttributes(n.id, {
        label: n.label.length > 34 ? n.label.slice(0, 32) + '…' : n.label,
        importance: n.importance,
        brainType: n.type,
        brainColor: typeColor(n.type),
        cluster: n.cluster ?? n.type,
      });
    }
  }
  let edgesAdded = 0;
  for (const e of view.edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target) || e.source === e.target) {
      continue;
    }
    try {
      if (graph.hasEdge(e.id)) {
        continue;
      }
      // Graphology: key must use addEdgeWithKey — addEdge(key, src, tgt) is a different overload and silently fails.
      graph.addEdgeWithKey(e.id, e.source, e.target, {
        weight: e.confidence,
        relType: e.relType,
        size: 1,
      });
      edgesAdded++;
    } catch {
      // Parallel edges between the same pair — ignore duplicates.
    }
  }
  runLayout(graph.order < 30 ? 160 : graph.order < 120 ? 220 : 280);
  hasData = graph.order > 0;
  emptyEl.style.display = hasData ? 'none' : 'flex';
  buildFilters();
  buildClusterChips();
  applyStyle();
  fitCamera();
  syncLabel.textContent = `Brain · ${graph.order} nodes · ${graph.size} links`;
  void edgesAdded;
}

// ---- Filters --------------------------------------------------------------------

function buildFilters(): void {
  const counts = new Map<string, number>();
  graph.forEachNode((_k, attr) => {
    const t = String(attr.brainType ?? '');
    counts.set(t, (counts.get(t) ?? 0) + 1);
  });
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => {
      const off = disabledTypes.has(t);
      return `<div class="filter-row ${off ? 'off' : ''}" data-type="${escapeHtml(t)}">
        <span class="swatch" style="background:${typeColor(t)}"></span>${escapeHtml(t)} · ${c}</div>`;
    })
    .join('');
  filtersEl.innerHTML = rows;
  filtersEl.querySelectorAll('.filter-row').forEach((el) => {
    el.addEventListener('click', () => {
      const t = (el as HTMLElement).dataset.type!;
      if (disabledTypes.has(t)) {
        disabledTypes.delete(t);
      } else {
        disabledTypes.add(t);
      }
      buildFilters();
      applyStyle();
    });
  });
}

function buildClusterChips(): void {
  const counts = new Map<string, number>();
  graph.forEachNode((_k, attr) => {
    const c = String(attr.cluster ?? 'memory');
    counts.set(c, (counts.get(c) ?? 0) + 1);
  });
  const preferred = ['architecture', 'code', 'dependencies', 'decisions', 'evaluation', 'memory', 'problems', 'solutions', 'tasks', 'project'];
  const keys = [
    ...preferred.filter((k) => counts.has(k)),
    ...[...counts.keys()].filter((k) => !preferred.includes(k)).sort(),
  ];
  clusterChipsEl.innerHTML = keys
    .map((c) => {
      const off = disabledClusters.has(c);
      const label = CLUSTER_LABELS[c] ?? c;
      return `<button class="cluster-chip ${off ? 'off' : 'on'}" data-cluster="${escapeHtml(c)}" type="button">${escapeHtml(label)} · ${counts.get(c)}</button>`;
    })
    .join('');
  clusterChipsEl.querySelectorAll('.cluster-chip').forEach((el) => {
    el.addEventListener('click', () => {
      const c = (el as HTMLElement).dataset.cluster!;
      if (disabledClusters.has(c)) {
        disabledClusters.delete(c);
      } else {
        disabledClusters.add(c);
      }
      buildClusterChips();
      applyStyle();
    });
  });
}

// ---- Inspector ---------------------------------------------------------------------

function showDetail(d: EntityDetail | undefined): void {
  if (!d) {
    return;
  }
  const rel = d.related
    .slice(0, 14)
    .map((r) => `<li><b>${escapeHtml(r.label)}</b> <span class="meta">${escapeHtml(r.relType)} · ${escapeHtml(r.type)}</span></li>`)
    .join('');
  const decisions = d.decisions.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const learnings = d.learnings.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  inspectorBody.innerHTML = `
    <h2>${escapeHtml(d.label)}</h2>
    <div class="type-line" style="color:${typeColor(d.type)}">${escapeHtml(d.type)}</div>
    ${d.description ? `<div class="desc">${escapeHtml(d.description)}</div>` : ''}
    <div class="sec meta">Importance ${Math.round((d.importance ?? 0) * 100)}% · confidence ${Math.round((d.confidence ?? 0) * 100)}%
      ${d.projects?.length ? `· seen across ${d.projects.length} project${d.projects.length > 1 ? 's' : ''}` : ''}<br/>
      last updated ${timeAgo(d.lastSeenAt)}</div>
    <div class="sec"><h3>Related</h3><ul>${rel || '<li class="meta">none</li>'}</ul></div>
    ${decisions ? `<div class="sec"><h3>Decisions</h3><ul>${decisions}</ul></div>` : ''}
    ${learnings ? `<div class="sec"><h3>Learnings</h3><ul>${learnings}</ul></div>` : ''}
    <button class="expand-btn" id="btn-expand">Expand neighborhood</button>`;
  inspector.classList.add('open');
  document.getElementById('btn-expand')?.addEventListener('click', () => {
    if (selectedId) {
      vscode.postMessage({ type: 'expand', id: selectedId, depth: 1 });
    }
  });
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---- Interaction wiring --------------------------------------------------------------

renderer.on('clickNode', ({ node }) => {
  selectedId = node;
  applyStyle();
  vscode.postMessage({ type: 'detail', id: node });
});
renderer.on('clickStage', () => {
  selectedId = null;
  inspector.classList.remove('open');
  searchResultsEl.style.display = 'none';
  applyStyle();
});
renderer.on('enterNode', ({ node }) => {
  hoveredId = node;
  container.style.cursor = 'pointer';
  applyStyle();
});
renderer.on('leaveNode', () => {
  hoveredId = null;
  container.style.cursor = 'default';
  applyStyle();
});
renderer.on('doubleClickNode', ({ node }) => {
  vscode.postMessage({ type: 'expand', id: node, depth: 1 });
});

(document.getElementById('btn-sync') as HTMLButtonElement).addEventListener('click', () => {
  vscode.postMessage({ type: 'sync' });
});
(document.getElementById('btn-initial-sync') as HTMLButtonElement).addEventListener('click', () => {
  setSyncBusy(true, 'Syncing everything…');
  vscode.postMessage({ type: 'sync' });
});
const insightsPanel = document.getElementById('insights-panel') as HTMLElement;
const activityPanel = document.getElementById('activity-panel') as HTMLElement;
const insightsBody = document.getElementById('insights-body') as HTMLElement;
const activityBody = document.getElementById('activity-body') as HTMLElement;
const deltaToast = document.getElementById('delta-toast') as HTMLElement;

(document.getElementById('btn-insights') as HTMLButtonElement).addEventListener('click', () => {
  const open = insightsPanel.style.display === 'block';
  insightsPanel.style.display = open ? 'none' : 'block';
  activityPanel.style.display = 'none';
  if (!open) {
    vscode.postMessage({ type: 'insights' });
  }
});
(document.getElementById('btn-activity') as HTMLButtonElement).addEventListener('click', () => {
  const open = activityPanel.style.display === 'block';
  activityPanel.style.display = open ? 'none' : 'block';
  insightsPanel.style.display = 'none';
  if (!open) {
    vscode.postMessage({ type: 'activity' });
  }
});
(document.getElementById('btn-ultrathink') as HTMLButtonElement).addEventListener('click', () => {
  vscode.postMessage({ type: 'ultrathink' });
});

function renderInsights(list: Array<{ id: string; title: string; kind: string; confidence: number; status: string; observation?: string; improvement?: string; createdAt: number }>): void {
  if (!list.length) {
    insightsBody.innerHTML = '<div class="meta">No insights yet. The Brain stays silent unless evidence supports one.</div>';
    return;
  }
  insightsBody.innerHTML = list.map((i) => `
    <div class="insight-item" data-id="${escapeHtml(i.id)}">
      <div class="title">${escapeHtml(i.title)}</div>
      <div class="meta">${escapeHtml(i.kind)} · ${Math.round(i.confidence * 100)}% · ${escapeHtml(i.status)} · ${timeAgo(i.createdAt)}</div>
      ${i.observation ? `<div class="desc">${escapeHtml(i.observation)}</div>` : ''}
      ${i.improvement ? `<div class="desc">${escapeHtml(i.improvement)}</div>` : ''}
      <div class="insight-actions">
        <button data-act="accepted">Accept</button>
        <button data-act="rejected">Reject</button>
        <button data-act="dismissed">Dismiss</button>
        <button data-act="seen">Seen</button>
      </div>
    </div>`).join('');
  insightsBody.querySelectorAll('.insight-actions button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn.closest('.insight-item') as HTMLElement)?.dataset.id;
      const status = (btn as HTMLElement).dataset.act;
      if (id && status) {
        vscode.postMessage({ type: 'insightFeedback', id, status });
      }
    });
  });
}

function renderActivity(events: Array<{ id: string; ts: number; kind: string; message: string }>): void {
  if (!events.length) {
    activityBody.innerHTML = '<div class="meta">No activity yet.</div>';
    return;
  }
  activityBody.innerHTML = events.map((e) => `
    <div class="activity-item"><span class="ts">${timeAgo(e.ts)}</span><b>${escapeHtml(e.kind)}</b> — ${escapeHtml(e.message)}</div>
  `).join('');
}

function showDelta(delta: { memories?: number; relationships?: number; learnings?: number; insights?: number }): void {
  const parts: string[] = [];
  if (delta.memories) parts.push(`+${delta.memories} memories`);
  if (delta.relationships) parts.push(`+${delta.relationships} relationships`);
  if (delta.learnings) parts.push(`+${delta.learnings} learning`);
  if (delta.insights) parts.push(`+${delta.insights} insight`);
  if (!parts.length) return;
  deltaToast.textContent = parts.join(' · ');
  deltaToast.classList.add('show');
  setTimeout(() => deltaToast.classList.remove('show'), 2800);
}

function applyRuntimeStatus(snap: { status?: string; callsToday?: number; insightsNew?: number }): void {
  const st = snap.status ?? 'idle';
  if (st === 'reflecting') {
    syncDot.className = 'busy';
    syncLabel.textContent = '● Brain Reflecting';
  } else if (st === 'active') {
    syncDot.className = 'ok';
    syncLabel.textContent = '● Brain Active';
  } else if (st === 'stopped') {
    syncDot.className = '';
    syncLabel.textContent = 'Brain Stopped';
  } else {
    syncDot.className = 'ok';
    syncLabel.textContent = `● Brain Idle${snap.insightsNew ? ` · ${snap.insightsNew} new insights` : ''}`;
  }
}

document.querySelector('#inspector .close')?.addEventListener('click', () => {
  inspector.classList.remove('open');
  selectedId = null;
  applyStyle();
});
(document.getElementById('btn-reset') as HTMLButtonElement).addEventListener('click', () => {
  renderer.getCamera().animatedReset({ duration: 350 });
});

let searchTimer: ReturnType<typeof setTimeout> | undefined;
searchInput.addEventListener('input', () => {
  if (searchTimer) clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) {
    searchResultsEl.style.display = 'none';
    return;
  }
  searchTimer = setTimeout(() => vscode.postMessage({ type: 'search', query: q }), 260);
});

function showSearchHits(hits: Array<{ id: string; label: string; type: string; via: string }>): void {
  if (!hits.length) {
    searchResultsEl.style.display = 'none';
    return;
  }
  searchResultsEl.innerHTML = hits
    .map(
      (h) => `<div class="sr-item" data-id="${escapeHtml(h.id)}">
        <span class="dot" style="background:${typeColor(h.type)}"></span>${escapeHtml(h.label)}<span class="via">${escapeHtml(h.via)}</span></div>`,
    )
    .join('');
  searchResultsEl.style.display = 'block';
  searchResultsEl.querySelectorAll('.sr-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.id!;
      selectedId = id;
      searchResultsEl.style.display = 'none';
      const pos = graph.getNodeAttributes(id);
      if (pos && typeof pos.x === 'number') {
        renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.4 }, { duration: 400 });
      }
      applyStyle();
      vscode.postMessage({ type: 'detail', id });
    });
  });
}

function setSyncBusy(busy: boolean, message?: string): void {
  syncDot.className = busy ? 'busy' : 'ok';
  syncLabel.textContent = message ?? (busy ? 'Syncing…' : `Brain · ${graph.order} memories`);
  if (!busy) {
    setTimeout(() => {
      syncDot.className = '';
    }, 2500);
  }
}

// ---- Message pump -----------------------------------------------------------------------

window.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data as { type: string; [k: string]: unknown };
  switch (msg.type) {
    case 'init': {
      types = (msg.types as TypeMeta[]) ?? [];
      for (const t of types) {
        colorOf.set(t.type, t.color);
      }
      break;
    }
    case 'graph': {
      mergeView(msg.view as GraphView, msg.merge !== true);
      break;
    }
    case 'progress': {
      const e = msg.event as { status: string; phase: string; message?: string; filesDone?: number; filesTotal?: number };
      const busy = e.status === 'running';
      setSyncBusy(busy, busy ? `${e.phase}${e.message ? ` · ${e.message}` : ''}` : 'Brain updated');
      if (e.status === 'done') {
        vscode.postMessage({ type: 'refresh' });
      }
      break;
    }
    case 'detail': {
      showDetail(msg.detail as EntityDetail | undefined);
      break;
    }
    case 'searchResults': {
      showSearchHits((msg.hits as Array<{ id: string; label: string; type: string; via: string }>) ?? []);
      break;
    }
    case 'runtimeStatus': {
      applyRuntimeStatus((msg.snap as { status?: string; callsToday?: number; insightsNew?: number }) ?? {});
      break;
    }
    case 'memoryDelta': {
      showDelta((msg.delta as { memories?: number; relationships?: number; learnings?: number; insights?: number }) ?? {});
      break;
    }
    case 'insights': {
      renderInsights((msg.insights as Array<{ id: string; title: string; kind: string; confidence: number; status: string; observation?: string; improvement?: string; createdAt: number }>) ?? []);
      break;
    }
    case 'activity': {
      renderActivity((msg.events as Array<{ id: string; ts: number; kind: string; message: string }>) ?? []);
      break;
    }
  }
});

vscode.postMessage({ type: 'ready' });
