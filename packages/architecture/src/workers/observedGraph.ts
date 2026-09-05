import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Adr } from '../domain/adr/schema.js';
import { nowIso } from '../domain/adr/schema.js';
import { isActiveStatus } from '../domain/adr/lifecycle.js';
import type { StoredDrift } from '../memory/decisionStore.js';

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go)$/i;
const IMPORT_RE =
  /(?:import\s+(?:[^'"\n]+from\s+)?|require\s*\(|from\s+)['"]([^'"]+)['"]/g;

export interface ObservedEdge {
  fromComponent: string;
  toSpecifier: string;
  toComponent?: string;
  file: string;
}

export interface ObservedGraph {
  edges: ObservedEdge[];
  components: Set<string>;
  filesByComponent: Map<string, string[]>;
}

export function parseImports(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(IMPORT_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(m[1]!);
  }
  return out;
}

export function componentFromPath(rel: string): string {
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean);
  const hit = parts.find((p) =>
    /^(api|frontend|domain|infrastructure|repository|service|gateway|worker|notification|payments|payment|auth|billing|order)(-service)?$/i.test(
      p,
    ),
  );
  if (hit) {
    return hit.toLowerCase();
  }
  if (parts[0] === 'src' || parts[0] === 'packages' || parts[0] === 'services') {
    return (parts[1] ?? parts[0] ?? 'unknown').toLowerCase();
  }
  return (parts[0] ?? 'unknown').toLowerCase();
}

function resolveRelativeComponent(fromFile: string, specifier: string, root: string): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const abs = join(dirname(join(root, fromFile)), specifier);
  const rel = relative(root, abs).split(sep).join('/');
  return componentFromPath(rel);
}

function listSourceFiles(root: string, dir: string, cap: number, acc: string[]): void {
  if (acc.length >= cap) {
    return;
  }
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (acc.length >= cap) {
      return;
    }
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === '.singularity') {
      continue;
    }
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      listSourceFiles(root, abs, cap, acc);
    } else if (SOURCE_EXT.test(name)) {
      acc.push(abs);
    }
  }
}

export function buildObservedGraph(opts: {
  workspaceRoot: string;
  files?: string[];
  cap?: number;
}): ObservedGraph {
  const root = opts.workspaceRoot;
  const files: string[] = [];
  if (opts.files?.length) {
    for (const f of opts.files) {
      const abs = f.startsWith('/') ? f : join(root, f);
      if (existsSync(abs) && SOURCE_EXT.test(abs)) {
        files.push(abs);
      }
    }
  } else {
    listSourceFiles(root, join(root, 'src'), opts.cap ?? 80, files);
    listSourceFiles(root, join(root, 'packages'), 40, files);
    listSourceFiles(root, join(root, 'services'), 40, files);
  }
  const edges: ObservedEdge[] = [];
  const components = new Set<string>();
  const filesByComponent = new Map<string, string[]>();
  for (const abs of files.slice(0, opts.cap ?? 120)) {
    let text = '';
    try {
      text = readFileSync(abs, 'utf8').slice(0, 12_000);
    } catch {
      continue;
    }
    const rel = relative(root, abs).split(sep).join('/');
    const from = componentFromPath(rel);
    components.add(from);
    const list = filesByComponent.get(from) ?? [];
    list.push(rel);
    filesByComponent.set(from, list);
    for (const spec of parseImports(text)) {
      const to = resolveRelativeComponent(rel, spec, root);
      edges.push({ fromComponent: from, toSpecifier: spec, toComponent: to, file: rel });
      if (to) {
        components.add(to);
      }
    }
  }
  return { edges, components, filesByComponent };
}

export function parseDeclaredLayers(text: string): string[] {
  const layers: string[] = [];
  const re = /[A-Za-z][\w-]*(?:\s*(?:→|->)\s*[A-Za-z][\w-]*)+/g;
  for (const chain of text.match(re) ?? []) {
    for (const part of chain.split(/\s*(?:→|->)\s*/)) {
      const n = part.trim().toLowerCase();
      if (n && !layers.includes(n)) {
        layers.push(n);
      }
    }
  }
  return layers;
}

function layerIndex(layers: string[], name: string): number {
  const n = name.toLowerCase();
  return layers.findIndex((l) => n === l || n.includes(l) || l.includes(n));
}

/**
 * Structural declared-vs-observed drift. Intelligence plane only.
 */
export function detectStructuralDrift(opts: {
  workspaceRoot: string;
  project_id: string;
  adrs: Adr[];
  extraFiles?: string[];
}): StoredDrift[] {
  const out: StoredDrift[] = [];
  let seq = 0;
  const observed = buildObservedGraph({
    workspaceRoot: opts.workspaceRoot,
    files: opts.extraFiles,
  });

  for (const adr of opts.adrs) {
    if (adr.record_kind === 'observation' || !isActiveStatus(adr.status)) {
      continue;
    }
    const declaredText = [adr.title, adr.decision.summary, ...adr.constraints, ...adr.dependencies].join(
      '\n',
    );
    const layers = parseDeclaredLayers(declaredText);

    for (const comp of adr.affected_components) {
      const key = comp.toLowerCase();
      const present = [...observed.components].some((c) => c.includes(key) || key.includes(c));
      const dirHits = ['src', 'packages', 'services', ''].some((base) => {
        const dir = base ? join(opts.workspaceRoot, base, comp) : join(opts.workspaceRoot, comp);
        return existsSync(dir);
      });
      if (!present && !dirHits) {
        seq += 1;
        out.push({
          id: `drift_${adr.id}_struct_${seq}`,
          project_id: opts.project_id,
          adr_id: adr.id,
          severity: 'medium',
          kind: 'missing_implementation',
          reason: `${adr.id} declares component ${comp} but no corresponding implementation was detected.`,
          files: [],
          created_at: nowIso(),
          status: 'open',
          confidence: 0.7,
          declared: { component: comp },
          observed: { components: [...observed.components] },
          affected_nodes: [comp],
        });
      }
    }

    const allowed = new Set(adr.dependencies.map((d) => d.toLowerCase()));
    if (layers.length >= 2) {
      for (const e of observed.edges) {
        if (!e.toComponent || e.fromComponent === e.toComponent) {
          continue;
        }
        const iFrom = layerIndex(layers, e.fromComponent);
        const iTo = layerIndex(layers, e.toComponent);
        if (iFrom < 0 || iTo < 0) {
          continue;
        }
        if (iTo < iFrom || iTo - iFrom > 1) {
          seq += 1;
          out.push({
            id: `drift_${adr.id}_struct_${seq}`,
            project_id: opts.project_id,
            adr_id: adr.id,
            severity: 'high',
            kind: 'constraint_violation',
            reason: `${adr.id}: ${e.fromComponent} directly depends on ${e.toComponent}, but declared architecture requires ${layers.join(' → ')}.`,
            files: [e.file],
            created_at: nowIso(),
            status: 'open',
            confidence: 0.85,
            declared: { layers },
            observed: { from: e.fromComponent, to: e.toComponent },
            affected_nodes: [e.fromComponent, e.toComponent],
          });
        }
      }
    }

    const isolated = /isolated from ([a-z0-9][a-z0-9_-]*)/i.exec(declaredText);
    if (isolated) {
      const other = isolated[1]!.toLowerCase();
      const self = adr.affected_components[0]?.toLowerCase();
      if (self) {
        for (const e of observed.edges) {
          if (
            (e.fromComponent.includes(self) && (e.toComponent ?? '').includes(other)) ||
            (e.fromComponent.includes(other) && (e.toComponent ?? '').includes(self))
          ) {
            seq += 1;
            out.push({
              id: `drift_${adr.id}_struct_${seq}`,
              project_id: opts.project_id,
              adr_id: adr.id,
              severity: 'high',
              kind: 'undeclared_dependency',
              reason: `${adr.id}: unexpected coupling ${e.fromComponent} → ${e.toComponent ?? e.toSpecifier} (declared isolated from ${other}).`,
              files: [e.file],
              created_at: nowIso(),
              status: 'open',
              confidence: 0.8,
              declared: { isolated_from: other },
              observed: { from: e.fromComponent, to: e.toComponent },
              affected_nodes: [e.fromComponent, e.toComponent ?? other],
            });
          }
        }
      }
    }

    if (allowed.size) {
      for (const e of observed.edges) {
        const to = (e.toComponent ?? e.toSpecifier).toLowerCase();
        const fromOk = adr.affected_components.some(
          (c) => e.fromComponent.includes(c.toLowerCase()) || c.toLowerCase().includes(e.fromComponent),
        );
        if (!fromOk || !e.toComponent) {
          continue;
        }
        if (![...allowed].some((a) => to.includes(a) || a.includes(to))) {
          seq += 1;
          out.push({
            id: `drift_${adr.id}_struct_${seq}`,
            project_id: opts.project_id,
            adr_id: adr.id,
            severity: 'medium',
            kind: 'undeclared_dependency',
            reason: `${adr.id}: ${e.fromComponent} depends on ${e.toComponent}, which is not in declared dependencies (${[...allowed].join(', ')}).`,
            files: [e.file],
            created_at: nowIso(),
            status: 'open',
            confidence: 0.65,
            declared: { dependencies: [...allowed] },
            observed: { from: e.fromComponent, to: e.toComponent },
            affected_nodes: [e.fromComponent, e.toComponent],
          });
        }
      }
    }
  }

  return out;
}
