/* Smoke test: simulate what singularity-ai does on activation + Sync Everything. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrainEngine } from '../dist/index.js';

const storageDir = mkdtempSync(join(tmpdir(), 'brain-smoke-'));
const events = [];

// Activation: engine is constructed once with an onProgress sink (like brainBridge).
const engine = new BrainEngine({
  storageDir,
  userId: 'smoke-user',
  onProgress: (e) => events.push(`${e.status}:${e.phase}`),
});

// 1. Initial sync over a real tree
const ws = '/Users/ashutosh/Singularity/packages/brain';
await engine.syncWorkspace(ws, 'brain');
console.log('sync events:', events.length > 0 ? `${events.length} progress events` : 'NONE');

// 2. Graph view for the webview
const view = engine.getGraphView(500);
console.log(`graph: ${view.nodes.length} nodes / ${view.edges.length} edges (truncated=${view.truncated})`);
if (view.nodes.length === 0) throw new Error('empty graph after sync');

// 3. Node inspection
const first = view.nodes[0];
const detail = engine.getEntityDetail(first.id);
console.log('detail:', detail ? `${detail.label} (${detail.type})` : 'MISSING');

// 4. Hybrid search
const hits = await engine.search(first.label.split(' ')[0], { limit: 5 });
console.log(`search "${first.label.split(' ')[0]}": ${hits.length} hits, top via=${hits[0]?.via}`);

// 5. Chat observation (heuristic mode — no LLM configured)
const obs = await engine.observeChat('We decided to adopt SQLite for the brain store because zero-config persistence matters more than concurrency here.', {
  projectId: 'brain',
  workspaceRoot: ws,
});
console.log('chat observation durable:', obs?.durable, '| entities:', obs?.entities.length ?? 0);

// 6. Context injection block for chat prompts
const block = await engine.relevantContext('brain store persistence');
console.log('relevantContext bytes:', block.length);

// 7. Persistence across "restart"
const stats = engine.stats();
engine.close();
const engine2 = new BrainEngine({ storageDir, userId: 'smoke-user' });
const stats2 = engine2.stats();
console.log(`persisted: ${stats.entities} → ${stats2.entities} entities, ${stats2.episodes} episodes`);
engine2.close();

if (stats2.entities !== stats.entities) throw new Error('persistence mismatch');
if (stats2.entities === 0) throw new Error('no memories persisted');
console.log('\nSMOKE TEST PASSED');
