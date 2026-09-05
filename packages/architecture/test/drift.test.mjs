import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createArchitectureSubsystem, createMemoryStore, detectDrift } from '../dist/index.js';

function makeSys(root, flags = {}) {
  return createArchitectureSubsystem({
    workspaceRoot: root,
    projectId: 'p1',
    store: createMemoryStore(),
    heuristicOnly: true,
    persistGraph: false,
    flags: { architecture_evolution_enabled: false, ...flags },
  });
}

describe('architecture drift', () => {
  it('does not flag expected layered dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'drift-ok-'));
    mkdirSync(join(root, 'src/api'), { recursive: true });
    mkdirSync(join(root, 'src/service'), { recursive: true });
    mkdirSync(join(root, 'src/repository'), { recursive: true });
    writeFileSync(join(root, 'src/api/index.ts'), "import { svc } from '../service/index.js';\nexport const api = svc;\n");
    writeFileSync(join(root, 'src/service/index.ts'), "import { repo } from '../repository/index.js';\nexport const svc = repo;\n");
    writeFileSync(join(root, 'src/repository/index.ts'), 'export const repo = 1;\n');
    const s = makeSys(root);
    s.createAdr({
      title: 'Layered backend',
      decision: { summary: 'API → Service → Repository' },
      constraints: ['API → Service → Repository'],
      affected_components: ['api', 'service', 'repository'],
      record_kind: 'decision',
      status: 'accepted',
    });
    const drifts = s.scanDrift();
    assert.equal(
      drifts.filter((d) => d.kind === 'constraint_violation' && /directly depends/.test(d.reason)).length,
      0,
      JSON.stringify(drifts),
    );
    s.stop();
  });

  it('detects unexpected API → Repository dependency', () => {
    const root = mkdtempSync(join(tmpdir(), 'drift-bad-'));
    mkdirSync(join(root, 'src/api'), { recursive: true });
    mkdirSync(join(root, 'src/repository'), { recursive: true });
    mkdirSync(join(root, 'src/service'), { recursive: true });
    writeFileSync(join(root, 'src/api/index.ts'), "import { repo } from '../repository/index.js';\nexport const api = repo;\n");
    writeFileSync(join(root, 'src/service/index.ts'), 'export const svc = 1;\n');
    writeFileSync(join(root, 'src/repository/index.ts'), 'export const repo = 1;\n');
    const s = makeSys(root);
    s.createAdr({
      title: 'Layered backend',
      decision: { summary: 'API → Service → Repository' },
      constraints: ['API → Service → Repository'],
      affected_components: ['api', 'service', 'repository'],
      record_kind: 'decision',
      status: 'accepted',
    });
    const drifts = s.scanDrift();
    assert.ok(
      drifts.some((d) => d.kind === 'constraint_violation' && /api.*repository/i.test(d.reason)),
      JSON.stringify(drifts),
    );
    s.stop();
  });

  it('detects missing declared component', () => {
    const root = mkdtempSync(join(tmpdir(), 'drift-miss-'));
    mkdirSync(join(root, 'src/api'), { recursive: true });
    writeFileSync(join(root, 'src/api/index.ts'), 'export const api = 1;\n');
    const s = makeSys(root);
    s.createAdr({
      title: 'Auth service required',
      decision: { summary: 'Authentication Service is required' },
      affected_components: ['authentication-service'],
      record_kind: 'decision',
      status: 'accepted',
    });
    const drifts = s.scanDrift();
    assert.ok(
      drifts.some((d) => d.kind === 'missing_implementation' && /authentication-service/.test(d.reason)),
      JSON.stringify(drifts),
    );
    s.stop();
  });

  it('detects unexpected coupling when services are isolated', () => {
    const root = mkdtempSync(join(tmpdir(), 'drift-cpl-'));
    mkdirSync(join(root, 'src/payments'), { recursive: true });
    mkdirSync(join(root, 'src/notification'), { recursive: true });
    writeFileSync(
      join(root, 'src/payments/index.ts'),
      "import { notify } from '../notification/index.js';\nexport const pay = notify;\n",
    );
    writeFileSync(join(root, 'src/notification/index.ts'), 'export const notify = 1;\n');
    const s = makeSys(root);
    s.createAdr({
      title: 'Isolate payments',
      decision: { summary: 'Payments Service isolated from Notification Service' },
      constraints: ['Payments Service isolated from notification'],
      affected_components: ['payments'],
      record_kind: 'decision',
      status: 'accepted',
    });
    const drifts = s.scanDrift();
    assert.ok(
      drifts.some((d) => d.kind === 'undeclared_dependency' && /coupling/i.test(d.reason)),
      JSON.stringify(drifts),
    );
    s.stop();
  });

  it('detects frontend → infrastructure boundary violation', () => {
    const root = mkdtempSync(join(tmpdir(), 'drift-bnd-'));
    mkdirSync(join(root, 'src/frontend'), { recursive: true });
    mkdirSync(join(root, 'src/infrastructure'), { recursive: true });
    writeFileSync(
      join(root, 'src/frontend/app.ts'),
      "import { db } from '../infrastructure/db.js';\nexport const app = db;\n",
    );
    writeFileSync(join(root, 'src/infrastructure/db.ts'), 'export const db = 1;\n');
    const s = makeSys(root);
    s.createAdr({
      title: 'Boundaries',
      decision: { summary: 'Frontend → API → Domain → Infrastructure' },
      constraints: ['Frontend → API → Domain → Infrastructure'],
      affected_components: ['frontend', 'api', 'domain', 'infrastructure'],
      record_kind: 'decision',
      status: 'accepted',
    });
    const drifts = s.scanDrift();
    assert.ok(
      drifts.some((d) => d.kind === 'constraint_violation' && /frontend.*infrastructure/i.test(d.reason)),
      JSON.stringify(drifts),
    );
    s.stop();
  });

  it('false-positive handling via status patch', () => {
    const root = mkdtempSync(join(tmpdir(), 'drift-fp-'));
    mkdirSync(join(root, 'src/api'), { recursive: true });
    mkdirSync(join(root, 'src/repository'), { recursive: true });
    mkdirSync(join(root, 'src/service'), { recursive: true });
    writeFileSync(join(root, 'src/api/index.ts'), "import { repo } from '../repository/index.js';\n");
    writeFileSync(join(root, 'src/service/index.ts'), 'export const svc = 1;\n');
    writeFileSync(join(root, 'src/repository/index.ts'), 'export const repo = 1;\n');
    const s = makeSys(root);
    s.createAdr({
      title: 'Layered backend',
      decision: { summary: 'API → Service → Repository' },
      constraints: ['API → Service → Repository'],
      affected_components: ['api'],
      record_kind: 'decision',
      status: 'accepted',
    });
    const drifts = s.scanDrift();
    const hit = drifts.find((d) => d.kind === 'constraint_violation');
    assert.ok(hit);
    const patched = s.patchDrift(hit.id, 'false_positive');
    assert.equal(patched.status, 'false_positive');
    assert.equal(s.store.getDrift(hit.id).status, 'false_positive');
    s.stop();
  });

  it('coding continues when drift detector is disabled', () => {
    const root = mkdtempSync(join(tmpdir(), 'drift-off-'));
    const s = makeSys(root, { architecture_drift_detection_enabled: false });
    s.emit({ event_type: 'FILE_MODIFIED', project_id: 'p1', changed_files: ['a.ts'] });
    const ctx = s.lookup('task');
    assert.equal(typeof ctx, 'string');
    s.stop();
  });

  it('detectDrift remains callable without subsystem', () => {
    const root = mkdtempSync(join(tmpdir(), 'drift-fn-'));
    const found = detectDrift({ workspaceRoot: root, project_id: 'p1', adrs: [] });
    assert.deepEqual(found, []);
  });
});
