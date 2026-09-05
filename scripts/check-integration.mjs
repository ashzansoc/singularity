#!/usr/bin/env node
/**
 * Verifies all 13 @singularity/* packages and service sidecars are built and wired.
 *
 * Usage: node scripts/check-integration.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const PACKAGES = [
  '@singularity/cache',
  '@singularity/prompt',
  '@singularity/router',
  '@singularity/context',
  '@singularity/wiki',
  '@singularity/intelligence',
  '@singularity/architecture',
  '@singularity/outcome',
  '@singularity/memory',
  '@singularity/brain',
  '@singularity/neural-relay',
  '@singularity/runtime',
  '@singularity/design',
];

const EXTENSION_DEPS = [
  '@singularity/architecture',
  '@singularity/brain',
  '@singularity/context',
  '@singularity/design',
  '@singularity/intelligence',
  '@singularity/memory',
  '@singularity/neural-relay',
  '@singularity/outcome',
  '@singularity/router',
  '@singularity/runtime',
  '@singularity/wiki',
];

const BRIDGES = [
  'contextEngineBridge.ts',
  'intelligenceBridge.ts',
  'architectureBridge.ts',
  'memoryBridge.ts',
  'outcomeBridge.ts',
  'neuralRelayBridge.ts',
  'wikiBridge.ts',
  'brainBridge.ts',
  'runtimeBridge.ts',
  'planeContextCache.ts',
];

let failed = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failed += 1;
}

function pkgDir(name) {
  return join(ROOT, 'packages', name.replace('@singularity/', ''));
}

console.log('\n[singularity] Integration check\n');

console.log('Packages (dist/index.js):');
for (const pkg of PACKAGES) {
  const entry = join(pkgDir(pkg), 'dist', 'index.js');
  if (existsSync(entry)) {
    ok(pkg);
  } else {
    fail(`${pkg} missing ${entry}`);
  }
}

console.log('\nExtension dependencies:');
const extPkg = JSON.parse(
  readFileSync(join(ROOT, 'vscode/extensions/singularity-ai/package.json'), 'utf8'),
);
for (const dep of EXTENSION_DEPS) {
  if (extPkg.dependencies?.[dep]) {
    ok(dep);
  } else {
    fail(`singularity-ai missing dependency ${dep}`);
  }
}

console.log('\nExtension bridges:');
const bridgeDir = join(ROOT, 'vscode/extensions/singularity-ai/src');
for (const file of BRIDGES) {
  const path = join(bridgeDir, file);
  if (existsSync(path)) {
    ok(file);
  } else {
    fail(`missing bridge ${file}`);
  }
}

console.log('\nService sidecars:');
const langextractPy = join(ROOT, 'services/langextract-sidecar/.venv/bin/python');
const langextractMain = join(ROOT, 'services/langextract-sidecar/main.py');
if (existsSync(langextractMain)) {
  ok('langextract-sidecar/main.py');
} else {
  fail('langextract-sidecar/main.py missing');
}
if (existsSync(langextractPy)) {
  ok('langextract-sidecar venv');
} else {
  fail('langextract-sidecar venv missing — run npm run install:langextract');
}

const intelWorker = join(ROOT, 'vscode/extensions/singularity-ai/dist/intelligenceWorker/main.js');
const intelSource = join(ROOT, 'services/project-intelligence/src/main.ts');
if (existsSync(intelSource)) {
  ok('project-intelligence source');
} else {
  fail('project-intelligence source missing');
}
if (existsSync(intelWorker)) {
  ok('project-intelligence worker bundle');
} else {
  fail('intelligenceWorker bundle missing — run npm run build:extension');
}

console.log('\nTransitive packages (via router):');
for (const pkg of ['@singularity/cache', '@singularity/prompt']) {
  const routerPkg = JSON.parse(readFileSync(join(pkgDir('@singularity/router'), 'package.json'), 'utf8'));
  if (routerPkg.dependencies?.[pkg]) {
    ok(`${pkg} → router`);
  } else {
    fail(`${pkg} not wired into router`);
  }
}

console.log('\nProject-intelligence worker health:');
const workerHealthy = await probeIntelligenceWorker();
if (workerHealthy) {
  ok('HTTP /health on :4781');
} else {
  fail('project-intelligence worker did not respond on /health');
}

console.log(`\n${failed === 0 ? 'All checks passed.' : `${failed} check(s) failed.`}\n`);
process.exit(failed === 0 ? 0 : 1);

async function probeIntelligenceWorker() {
  const workerScript = intelWorker;
  if (!existsSync(workerScript)) {
    return false;
  }
  const port = 4799;
  const child = spawn(process.execPath, [workerScript], {
    cwd: ROOT,
    env: {
      ...process.env,
      SINGULARITY_WORKSPACE: ROOT,
      SINGULARITY_INTELLIGENCE_PORT: String(port),
      SINGULARITY_INTELLIGENCE_AUTO_BOOTSTRAP: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const url = `http://127.0.0.1:${port}/health`;
  let healthy = false;
  try {
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(400) });
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  } finally {
    child.kill('SIGTERM');
  }
  return healthy;
}
