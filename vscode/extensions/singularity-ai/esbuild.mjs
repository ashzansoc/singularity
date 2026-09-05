import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

// Preserve a real file URL for createRequire(import.meta.url) inside bundled deps
// (tree-sitter extractor). Without this, esbuild replaces import.meta with {}.
const importMetaBanner = {
  js: 'var __singularityImportMetaUrl=require("node:url").pathToFileURL(__filename).href;',
};

function copyUiAssets() {
  const dest = join(__dirname, 'dist', 'ui');
  mkdirSync(dest, { recursive: true });
  for (const name of ['tokens.css', 'primitives.css', 'shell.css']) {
    cpSync(join(__dirname, 'src', 'ui', name), join(dest, name));
  }
}

// Extension host bundle (node, cjs).
const extensionCtx = await esbuild.context({
  entryPoints: [join(__dirname, 'src/extension.ts')],
  outfile: join(__dirname, 'dist/extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['es2022'],
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
  banner: importMetaBanner,
  define: {
    'import.meta.url': '__singularityImportMetaUrl',
  },
});

// Brain graph viewer for the webview (browser iife; sigma.js WebGL renderer).
const viewerCtx = await esbuild.context({
  entryPoints: [{ in: join(__dirname, 'src/brain/viewer.ts'), out: 'brain/viewer' }],
  outdir: join(__dirname, 'dist'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2022'],
  sourcemap: true,
  logLevel: 'info',
});

// Intelligence Shell client (browser iife).
const shellCtx = await esbuild.context({
  entryPoints: [
    {
      in: join(__dirname, 'src/intelligenceShell/shellApp.ts'),
      out: 'intelligenceShell/shellApp',
    },
  ],
  outdir: join(__dirname, 'dist'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2022'],
  sourcemap: true,
  logLevel: 'info',
});

// Intelligence worker — separate Node process (indexing, Tree-sitter, planes).
const workerEntry = join(
  __dirname,
  '../../../services/project-intelligence/src/main.ts',
);
const workerCtx = await esbuild.context({
  entryPoints: [workerEntry],
  outfile: join(__dirname, 'dist/intelligenceWorker/main.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node18'],
  sourcemap: true,
  logLevel: 'info',
  banner: importMetaBanner,
  define: {
    'import.meta.url': '__singularityImportMetaUrl',
  },
});

copyUiAssets();

if (watch) {
  await Promise.all([
    extensionCtx.watch(),
    viewerCtx.watch(),
    shellCtx.watch(),
    workerCtx.watch(),
  ]);
  console.log('singularity-ai: watching…');
} else {
  await Promise.all([
    extensionCtx.rebuild(),
    viewerCtx.rebuild(),
    shellCtx.rebuild(),
    workerCtx.rebuild(),
  ]);
  await Promise.all([
    extensionCtx.dispose(),
    viewerCtx.dispose(),
    shellCtx.dispose(),
    workerCtx.dispose(),
  ]);
  copyUiAssets();
  console.log('singularity-ai: build complete');
}
