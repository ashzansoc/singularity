/**
 * Intelligence Shell — webview client (routes + progressive UI).
 * Brain route embeds the existing Sigma viewer via host forwarding.
 */

import type {
  ArchitecturePayload,
  ContextPayload,
  MemoryPayload,
  ShellClientMessage,
  ShellHostMessage,
  ShellRoute,
  TasksPayload,
  SearchResult,
} from './protocol.js';
import { ROUTE_HINTS, ROUTE_LABELS, SHELL_ROUTES } from './protocol.js';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const RAIL: Array<{ route: ShellRoute; label: string; glyph: string }> = [
  { route: 'context', label: 'Context', glyph: '◎' },
  { route: 'brain', label: 'Brain', glyph: '◈' },
  { route: 'memory', label: 'Memory', glyph: '◇' },
  { route: 'architecture', label: 'Architecture', glyph: '▣' },
  { route: 'tasks', label: 'Tasks', glyph: '▹' },
];

let route: ShellRoute = 'context';
let theme: 'dark' | 'light' = 'dark';
let projectName = 'workspace';
let branch = '';
let contextData: ContextPayload | null = null;
let memoryData: MemoryPayload | null = null;
let architectureData: ArchitecturePayload | null = null;
let tasksData: TasksPayload | null = null;
let searchResults: SearchResult[] = [];
let activityLabel = '';
let activityProgress: number | undefined;
let inspectorHtml = '';
let brainScriptUrl = '';

function updateBootOverlay(label: string, progress?: number): void {
  const bootLabel = document.getElementById('boot-label');
  const bootProgress = document.getElementById('boot-progress');
  if (bootLabel) {
    bootLabel.textContent = label;
  }
  if (bootProgress && progress != null) {
    bootProgress.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  }
}

function clearBootOverlay(): void {
  document.getElementById('app')?.classList.remove('sg-booting');
}

function loadingSkeleton(label: string): string {
  return `
    <div class="sg-shell-main-scroll sg-loading-route">
      <div class="sg-route-header"><h1 class="sg-title-page">${esc(ROUTE_LABELS[route])}</h1></div>
      <div class="sg-loading-block">
        <div class="sg-boot-spinner" aria-hidden="true"></div>
        <p class="sg-secondary">${esc(label)}</p>
      </div>
    </div>`;
}

window.addEventListener('message', (event: MessageEvent<ShellHostMessage>) => {
  const msg = event.data;
  if (msg?.type === 'boot') {
    updateBootOverlay(msg.label, msg.progress);
  }
});

function post(msg: ShellClientMessage): void {
  vscode.postMessage(msg);
}

function esc(s: string | undefined | null): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function confidenceBar(c?: number): string {
  if (c == null || Number.isNaN(c)) {
    return '';
  }
  const pct = Math.max(0, Math.min(100, Math.round(c * 100)));
  return `<span class="sg-confidence" title="Confidence ${pct}%"><span style="width:${pct}%"></span></span>`;
}

function statusAttr(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('fail') || s.includes('error')) return 'failed';
  if (s.includes('run') || s.includes('active') || s === 'working') return 'running';
  if (s.includes('done') || s.includes('complete') || s === 'succeeded') return 'complete';
  if (s.includes('pause')) return 'paused';
  if (s.includes('retry')) return 'retrying';
  if (s.includes('warn')) return 'warning';
  return 'pending';
}

function mount(): void {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }
  root.className = `singularity-ui sg-shell${inspectorHtml ? ' has-inspector' : ''}${theme === 'light' ? ' theme-light' : ''}`;
  root.innerHTML = `
    <header class="sg-shell-top" role="banner">
      <div class="sg-shell-brand">Singularity</div>
      <div class="sg-shell-crumb" aria-label="Location">
        <span>${esc(projectName)}</span>
        ${branch ? `<span aria-hidden="true">/</span><span>${esc(branch)}</span>` : ''}
        <span aria-hidden="true">/</span>
        <span>${esc(ROUTE_LABELS[route])}</span>
      </div>
      <div class="sg-shell-top-spacer"></div>
      <input class="sg-input sg-shell-search" type="search" id="shell-search"
        placeholder="Search intelligence…" aria-label="Search across intelligence" />
    </header>
    <nav class="sg-shell-rail" aria-label="Intelligence routes">
      ${RAIL.map(
        (r) => `
        <button type="button" class="sg-icon-btn${r.route === route ? ' is-active' : ''}"
          data-route="${r.route}" title="${r.label}" aria-label="${r.label}"
          aria-pressed="${r.route === route}">${r.glyph}</button>`,
      ).join('')}
    </nav>
    <main class="sg-shell-main" id="shell-main" aria-live="polite"></main>
    <aside class="sg-shell-inspector" id="shell-inspector" aria-label="Inspector">
      <div class="sg-shell-inspector-header">Inspector</div>
      <div class="sg-shell-inspector-body" id="shell-inspector-body">${inspectorHtml}</div>
    </aside>
    <footer class="sg-shell-status" role="status">
      <div class="sg-activity">
        ${activityLabel ? `<span class="sg-status" data-status="running">${esc(activityLabel)}</span>` : `<span>Ready</span>`}
        ${
          activityProgress != null
            ? `<div class="sg-progress" style="width:80px"><span style="width:${Math.round(activityProgress * 100)}%"></span></div>`
            : ''
        }
      </div>
      <span>${esc(ROUTE_HINTS[route])}</span>
    </footer>
    <div class="sg-toast" id="shell-toast" role="status"></div>
  `;

  root.querySelectorAll<HTMLButtonElement>('[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.route as ShellRoute;
      if (SHELL_ROUTES.includes(next)) {
        post({ type: 'navigate', route: next });
      }
    });
  });

  const search = document.getElementById('shell-search') as HTMLInputElement | null;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  search?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = search.value.trim();
    searchTimer = setTimeout(() => {
      if (q.length >= 2) {
        post({ type: 'search', query: q });
      } else {
        searchResults = [];
        renderMain();
      }
    }, 200);
  });

  renderMain();
  bindKeys();
}

function bindKeys(): void {
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (e.key === 'g') {
      const map: Record<string, ShellRoute> = {
        c: 'context',
        b: 'brain',
        m: 'memory',
        a: 'architecture',
        t: 'tasks',
      };
      const once = (ev: KeyboardEvent) => {
        const r = map[ev.key];
        if (r) {
          ev.preventDefault();
          post({ type: 'navigate', route: r });
        }
        document.removeEventListener('keydown', once, true);
      };
      document.addEventListener('keydown', once, true);
      setTimeout(() => document.removeEventListener('keydown', once, true), 800);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      (document.getElementById('shell-search') as HTMLInputElement | null)?.focus();
    }
  });
}

function renderMain(): void {
  const main = document.getElementById('shell-main');
  if (!main) {
    return;
  }

  if (searchResults.length) {
    main.innerHTML = `
      <div class="sg-shell-main-scroll">
        <div class="sg-route-header"><h1 class="sg-title-page">Search</h1></div>
        <div class="sg-list">
          ${searchResults
            .map(
              (r) => `
            <button type="button" class="sg-context-item" data-search-id="${esc(r.id)}" data-search-route="${r.route ?? ''}" data-search-path="${esc(r.path ?? '')}">
              <div class="sg-title-section">${esc(r.title)}</div>
              <div class="sg-secondary">${esc(r.subtitle ?? r.kind)}</div>
              ${r.why ? `<div class="sg-meta">${esc(r.why)}</div>` : ''}
            </button>`,
            )
            .join('')}
        </div>
      </div>`;
    main.querySelectorAll<HTMLButtonElement>('[data-search-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const path = btn.dataset.searchPath;
        const r = btn.dataset.searchRoute as ShellRoute | undefined;
        if (path) {
          post({ type: 'openFile', path });
        } else if (r && SHELL_ROUTES.includes(r)) {
          post({ type: 'navigate', route: r });
        }
      });
    });
    return;
  }

  switch (route) {
    case 'context':
      main.innerHTML = renderContext();
      bindContext();
      break;
    case 'brain':
      main.innerHTML = renderBrainHost();
      ensureBrain();
      break;
    case 'memory':
      main.innerHTML = renderMemory();
      bindMemory();
      break;
    case 'architecture':
      main.innerHTML = renderArchitecture();
      bindArchitecture();
      break;
    case 'tasks':
      main.innerHTML = renderTasks();
      bindTasks();
      break;
  }
}

function routeHeader(title: string, hint: string, actions = ''): string {
  return `
    <div class="sg-route-header">
      <div>
        <h1 class="sg-title-page">${esc(title)}</h1>
        <p>${esc(hint)}</p>
      </div>
      <div class="sg-quick-actions">${actions}</div>
    </div>`;
}

function renderContext(): string {
  const d = contextData;
  if (!d) {
    return loadingSkeleton(activityLabel || 'Building context…');
  }

  const section = (title: string, items: typeof d.files) => {
    if (!items.length) {
      return '';
    }
    return `
      <section class="sg-section">
        <h2 class="sg-section-title">${esc(title)}</h2>
        <div class="sg-list">
          ${items
            .map(
              (it) => `
            <button type="button" class="sg-context-item" data-path="${esc(it.path ?? '')}" data-id="${esc(it.id)}">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                <span class="sg-title-section">${esc(it.title)}</span>
                ${confidenceBar(it.confidence)}
              </div>
              ${it.subtitle ? `<div class="sg-secondary">${esc(it.subtitle)}</div>` : ''}
              ${it.meta ? `<div class="sg-meta">${esc(it.meta)}</div>` : ''}
            </button>`,
            )
            .join('')}
        </div>
      </section>`;
  };

  return `<div class="sg-shell-main-scroll">
    ${routeHeader(
      'Context',
      ROUTE_HINTS.context,
      `<button type="button" class="sg-btn" id="ctx-refresh">Refresh</button>`,
    )}
    ${d.statusLine ? `<p class="sg-secondary" style="margin-bottom:16px">${esc(d.statusLine)}</p>` : ''}
    ${section('Relevant files', d.files)}
    ${section('Architecture', d.architecture)}
    ${section('Decisions', d.decisions)}
    ${section('Memories', d.memories)}
    ${section('Active tasks', d.tasks)}
    ${section('Recent changes', d.changes)}
    ${section('Dependencies', d.dependencies)}
    ${section('Evidence', d.evidence)}
    ${
      !d.files.length && !d.architecture.length && !d.decisions.length
        ? `<div class="sg-empty"><h2>No context yet</h2>
           <p>Ask Singularity to understand this project, or extract knowledge from chat.</p>
           <div class="sg-quick-actions">
             <button type="button" class="sg-btn" id="ctx-extract">Extract from selection</button>
           </div></div>`
        : ''
    }
  </div>`;
}

function bindContext(): void {
  document.getElementById('ctx-refresh')?.addEventListener('click', () => post({ type: 'refresh', route: 'context' }));
  document.getElementById('ctx-extract')?.addEventListener('click', () => {
    const text = window.getSelection()?.toString()?.trim();
    if (text) {
      post({ type: 'contextExtract', text });
    } else {
      showToast('Select text to extract, or use chat.');
    }
  });
  document.querySelectorAll<HTMLButtonElement>('.sg-context-item[data-path]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const path = btn.dataset.path;
      if (path) {
        post({ type: 'openFile', path });
      }
    });
  });
}

function renderBrainHost(): string {
  return `
    <div class="sg-graph-host" style="display:flex;flex-direction:column;height:100%">
      <div style="padding:10px 16px;border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div>
          <h1 class="sg-title-page" style="font-size:13px">Brain</h1>
          <p class="sg-secondary" style="margin:2px 0 0">${esc(ROUTE_HINTS.brain)}</p>
        </div>
        <div class="sg-quick-actions">
          <button type="button" class="sg-btn" id="brain-sync">Sync</button>
          <button type="button" class="sg-btn sg-btn-ghost" id="brain-refresh">Refresh</button>
        </div>
      </div>
      <div id="brain-root" style="flex:1;position:relative;min-height:0;overflow:hidden"></div>
    </div>`;
}

let brainViewerLoaded = false;

function ensureBrain(): void {
  document.getElementById('brain-sync')?.addEventListener('click', () =>
    post({ type: 'brainMessage', message: { type: 'sync' } }),
  );
  document.getElementById('brain-refresh')?.addEventListener('click', () =>
    post({ type: 'brainMessage', message: { type: 'refresh' } }),
  );
  const mount = () => post({ type: 'brainMessage', message: { type: 'ready' } });
  if (brainViewerLoaded || !brainScriptUrl) {
    mount();
    return;
  }
  const existing = document.getElementById('sg-brain-viewer');
  if (existing) {
    brainViewerLoaded = true;
    mount();
    return;
  }
  const s = document.createElement('script');
  s.id = 'sg-brain-viewer';
  s.src = brainScriptUrl;
  s.onload = () => {
    brainViewerLoaded = true;
    mount();
  };
  document.body.appendChild(s);
}

function renderMemory(): string {
  const d = memoryData;
  const actions = `<button type="button" class="sg-btn" id="mem-refresh">Refresh</button>`;
  if (!d || !d.items.length) {
    return `<div class="sg-shell-main-scroll">
      ${routeHeader('Memory', ROUTE_HINTS.memory, actions)}
      <div class="sg-empty"><h2>No memories yet</h2>
      <p>As Singularity works, decisions, preferences, and lessons accumulate here.</p></div>
    </div>`;
  }

  const cats = d.categories.length
    ? d.categories
    : [
        { id: 'decisions' as const, label: 'Decisions', count: 0 },
        { id: 'preferences' as const, label: 'Preferences', count: 0 },
        { id: 'architecture' as const, label: 'Architecture', count: 0 },
        { id: 'lessons' as const, label: 'Lessons', count: 0 },
        { id: 'context' as const, label: 'Context', count: 0 },
      ];

  return `<div class="sg-shell-main-scroll">
    ${routeHeader('Memory', ROUTE_HINTS.memory, actions)}
    <div class="sg-tabs" role="tablist">
      ${cats
        .map(
          (c, i) =>
            `<button type="button" class="sg-tab" role="tab" data-cat="${c.id}" aria-selected="${i === 0}">${esc(c.label)} (${c.count})</button>`,
        )
        .join('')}
    </div>
    <div id="mem-list" style="margin-top:12px"></div>
  </div>`;
}

function bindMemory(): void {
  document.getElementById('mem-refresh')?.addEventListener('click', () => post({ type: 'refresh', route: 'memory' }));
  const items = memoryData?.items ?? [];
  const renderCat = (cat: string) => {
    const list = document.getElementById('mem-list');
    if (!list) {
      return;
    }
    const filtered = items.filter((m) => m.category === cat);
    if (!filtered.length) {
      list.innerHTML = `<div class="sg-empty"><h2>Empty</h2><p>No items in this category.</p></div>`;
      return;
    }
    list.innerHTML = filtered
      .map(
        (m) => `
      <article class="sg-task-card" data-mem="${esc(m.id)}">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <h3>${esc(m.title)}</h3>
          ${confidenceBar(m.confidence)}
        </div>
        <p class="sg-secondary">${esc(m.content.slice(0, 280))}${m.content.length > 280 ? '…' : ''}</p>
        <div class="sg-meta" style="margin-top:8px">
          ${m.source ? `Source: ${esc(m.source)} · ` : ''}
          ${m.updatedAt ? `Updated ${esc(m.updatedAt)}` : m.createdAt ? `Created ${esc(m.createdAt)}` : ''}
        </div>
        ${
          m.entities?.length
            ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">${m.entities.map((e) => `<span class="sg-badge">${esc(e)}</span>`).join('')}</div>`
            : ''
        }
        <div class="sg-quick-actions" style="margin-top:10px">
          <button type="button" class="sg-btn sg-btn-ghost" data-mem-detail="${esc(m.id)}">Inspect</button>
          <button type="button" class="sg-btn sg-btn-danger" data-mem-remove="${esc(m.id)}">Remove</button>
        </div>
      </article>`,
      )
      .join('');
    list.querySelectorAll<HTMLButtonElement>('[data-mem-remove]').forEach((btn) => {
      btn.addEventListener('click', () => post({ type: 'memoryRemove', id: String(btn.dataset.memRemove) }));
    });
    list.querySelectorAll<HTMLButtonElement>('[data-mem-detail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = String(btn.dataset.memDetail);
        post({ type: 'memoryDetail', id });
        const m = items.find((x) => x.id === id);
        if (m) {
          setInspector(`
            <h2 class="sg-title-section">${esc(m.title)}</h2>
            <p class="sg-body" style="margin-top:8px;white-space:pre-wrap">${esc(m.content)}</p>
            ${m.evidence ? `<p class="sg-meta" style="margin-top:12px">Evidence: ${esc(m.evidence)}</p>` : ''}
          `);
        }
      });
    });
  };

  const tabs = document.querySelectorAll<HTMLButtonElement>('.sg-tab[data-cat]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      renderCat(String(tab.dataset.cat));
    });
  });
  const first = tabs[0]?.dataset.cat ?? 'decisions';
  renderCat(first);
}

function renderArchitecture(): string {
  const d = architectureData;
  const actions = `<button type="button" class="sg-btn" id="arch-refresh">Refresh</button>`;
  if (!d) {
    return `<div class="sg-shell-main-scroll">
      ${routeHeader('Architecture', ROUTE_HINTS.architecture, actions)}
      <div class="sg-empty"><h2>Mapping architecture…</h2><p>Tracing components, services, and decisions.</p></div>
    </div>`;
  }

  const pending = d.adrs.filter((a) => a.status === 'proposed' || a.status === 'draft');
  return `<div class="sg-shell-main-scroll">
    ${routeHeader('Architecture', ROUTE_HINTS.architecture, actions)}
    <section class="sg-section">
      <h2 class="sg-section-title">System map</h2>
      <div class="sg-list">
        ${
          d.nodes.length
            ? d.nodes
                .slice(0, 80)
                .map(
                  (n) => `
            <button type="button" class="sg-context-item" data-arch-id="${esc(n.id)}">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="sg-badge">${esc(n.kind)}</span>
                <span class="sg-title-section">${esc(n.label)}</span>
              </div>
            </button>`,
                )
                .join('')
            : `<p class="sg-secondary">No graph nodes yet. Accept ADRs or sync Brain.</p>`
        }
      </div>
    </section>
    <section class="sg-section">
      <h2 class="sg-section-title">Decisions (ADRs)</h2>
      ${
        d.adrs.length
          ? d.adrs
              .map(
                (a) => `
        <article class="sg-task-card">
          <div style="display:flex;justify-content:space-between;gap:8px">
            <h3>${esc(a.title)}</h3>
            <span class="sg-badge">${esc(a.status)}</span>
          </div>
          ${a.summary ? `<p class="sg-secondary">${esc(a.summary)}</p>` : ''}
          ${
            pending.some((p) => p.id === a.id)
              ? `<div class="sg-quick-actions">
                  <button type="button" class="sg-btn sg-btn-primary" data-adr-accept="${esc(a.id)}">Accept</button>
                  <button type="button" class="sg-btn" data-adr-reject="${esc(a.id)}">Reject</button>
                </div>`
              : ''
          }
        </article>`,
              )
              .join('')
          : `<p class="sg-secondary">No architecture decisions recorded.</p>`
      }
    </section>
    ${
      d.drifts?.length
        ? `<section class="sg-section"><h2 class="sg-section-title">Drift</h2>
        ${d.drifts.map((x) => `<div class="sg-context-item"><span class="sg-title-section">${esc(x.title)}</span><span class="sg-secondary">${esc(x.subtitle ?? '')}</span></div>`).join('')}
        </section>`
        : ''
    }
  </div>`;
}

function bindArchitecture(): void {
  document.getElementById('arch-refresh')?.addEventListener('click', () =>
    post({ type: 'refresh', route: 'architecture' }),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-arch-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = String(btn.dataset.archId);
      post({ type: 'archSelect', id });
      post({ type: 'archNeighbors', id, depth: 1 });
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-adr-accept]').forEach((btn) => {
    btn.addEventListener('click', () => post({ type: 'adrReview', id: String(btn.dataset.adrAccept), action: 'accept' }));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-adr-reject]').forEach((btn) => {
    btn.addEventListener('click', () => post({ type: 'adrReview', id: String(btn.dataset.adrReject), action: 'reject' }));
  });
}

function renderTasks(): string {
  const d = tasksData;
  const actions = `
    <button type="button" class="sg-btn" id="tasks-refresh">Refresh</button>
    <button type="button" class="sg-btn sg-btn-ghost" id="tasks-clear">Clear</button>`;
  if (!d || !d.tasks.length) {
    return `<div class="sg-shell-main-scroll">
      ${routeHeader('Tasks', ROUTE_HINTS.tasks, actions)}
      <div class="sg-empty">
        <h2>No active tasks</h2>
        <p>Long-running agent work appears here so you can leave chat and still track progress.</p>
      </div>
    </div>`;
  }

  return `<div class="sg-shell-main-scroll">
    ${routeHeader('Tasks', ROUTE_HINTS.tasks, actions)}
    ${d.summary ? `<p class="sg-secondary" style="margin-bottom:16px">${esc(d.summary)}</p>` : ''}
    ${d.tasks
      .map((t) => {
        const selected = t.id === d.selectedId;
        return `
      <article class="sg-task-card${selected ? ' is-selected' : ''}" data-task="${esc(t.id)}" style="${selected ? 'border-color:var(--border-strong)' : ''}">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
          <h3>${esc(t.title)}</h3>
          <span class="sg-status" data-status="${statusAttr(t.status)}">${esc(t.status)}</span>
        </div>
        ${t.objective ? `<p class="sg-secondary">${esc(t.objective)}</p>` : ''}
        <div class="sg-progress" style="margin-top:10px"><span style="width:${Math.round(t.progress * 100)}%"></span></div>
        <ul class="sg-task-steps">
          ${t.steps
            .map(
              (s) =>
                `<li><span class="sg-status" data-status="${s.status}"></span>${esc(s.title)}</li>`,
            )
            .join('')}
        </ul>
        ${t.error ? `<div class="sg-error" style="margin-top:12px"><h2>Failed</h2><p>${esc(t.error)}</p></div>` : ''}
        ${t.ownedPaths?.length ? `<div style="margin-top:8px">${t.ownedPaths.map((p) => `<button type="button" class="sg-file-ref" data-path="${esc(p)}">${esc(p)}</button>`).join(' ')}</div>` : ''}
      </article>`;
      })
      .join('')}
  </div>`;
}

function bindTasks(): void {
  document.getElementById('tasks-refresh')?.addEventListener('click', () => post({ type: 'refresh', route: 'tasks' }));
  document.getElementById('tasks-clear')?.addEventListener('click', () => post({ type: 'taskClear' }));
  document.querySelectorAll<HTMLElement>('[data-task]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-path]')) {
        return;
      }
      post({ type: 'taskSelect', id: String(el.getAttribute('data-task')) });
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-path]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const path = btn.dataset.path;
      if (path) {
        post({ type: 'openFile', path });
      }
    });
  });
}

function setInspector(html: string): void {
  inspectorHtml = html;
  const shell = document.getElementById('app');
  shell?.classList.toggle('has-inspector', Boolean(html));
  const body = document.getElementById('shell-inspector-body');
  if (body) {
    body.innerHTML = html || '';
  }
}

function showToast(message: string): void {
  const el = document.getElementById('shell-toast');
  if (!el) {
    return;
  }
  el.textContent = message;
  el.classList.add('is-visible');
  setTimeout(() => el.classList.remove('is-visible'), 1800);
}

window.addEventListener('message', (event: MessageEvent<ShellHostMessage>) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') {
    return;
  }
  switch (msg.type) {
    case 'init':
      route = msg.route;
      theme = msg.theme;
      projectName = msg.projectName ?? projectName;
      branch = msg.branch ?? '';
      brainScriptUrl = msg.brainScript ?? '';
      clearBootOverlay();
      mount();
      post({ type: 'refresh', route });
      break;
    case 'navigate':
      route = msg.route;
      searchResults = [];
      mount();
      post({ type: 'refresh', route });
      break;
    case 'contextData':
      contextData = msg.payload;
      if (route === 'context') {
        renderMain();
      }
      break;
    case 'memoryData':
      memoryData = msg.payload;
      if (route === 'memory') {
        renderMain();
      }
      break;
    case 'architectureData':
      architectureData = msg.payload;
      if (route === 'architecture') {
        renderMain();
      }
      if (msg.payload.selected) {
        const s = msg.payload.selected;
        setInspector(`
          <h2 class="sg-title-section">${esc(s.label)}</h2>
          <span class="sg-badge" style="margin-top:8px">${esc(s.kind)}</span>
          ${s.detail ? `<p class="sg-secondary" style="margin-top:12px;white-space:pre-wrap">${esc(s.detail)}</p>` : ''}
          ${
            s.neighbors?.length
              ? `<h3 class="sg-section-title" style="margin-top:16px">Related</h3>
                 ${s.neighbors.map((n) => `<div class="sg-secondary" style="padding:4px 0">${esc(n.title)}</div>`).join('')}`
              : ''
          }
        `);
      }
      break;
    case 'tasksData':
      tasksData = msg.payload;
      if (route === 'tasks') {
        renderMain();
      }
      break;
    case 'searchResults':
      searchResults = msg.results;
      renderMain();
      break;
    case 'activity':
      activityLabel = msg.label;
      activityProgress = msg.progress;
      {
        const footer = document.querySelector('.sg-shell-status .sg-activity');
        if (footer) {
          footer.innerHTML = `
            <span class="sg-status" data-status="running">${esc(msg.label)}</span>
            ${
              msg.progress != null
                ? `<div class="sg-progress" style="width:80px"><span style="width:${Math.round(msg.progress * 100)}%"></span></div>`
                : ''
            }`;
        }
        if (!contextData && route === 'context') {
          renderMain();
        }
      }
      break;
    case 'boot':
      updateBootOverlay(msg.label, msg.progress);
      break;
    case 'toast':
      showToast(msg.message);
      break;
    case 'brainForward':
      window.postMessage(msg.message, '*');
      if (msg.message.type === 'progress') {
        const ev = msg.message.event as { message?: string; status?: string } | undefined;
        activityLabel = ev?.message ?? 'Syncing brain…';
      }
      break;
  }
});

post({ type: 'ready' });
