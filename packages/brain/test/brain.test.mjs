import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrainStore, normLabel } from '../dist/store.js';
import { HashBrainEmbedder, cosine } from '../dist/embeddings.js';

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'brain-test-'));
  return new BrainStore(join(dir, 'brain.sqlite'), 'user-1');
}

test('normLabel canonicalizes labels', () => {
  assert.equal(normLabel('  PostgreSQL   Core '), 'postgresql core');
});

test('upsert dedupes entities by normalized label', () => {
  const s = tempStore();
  const a = s.upsertEntity({ type: 'technology', label: 'PostgreSQL', sourceType: 'test' });
  const b = s.upsertEntity({ type: 'technology', label: 'postgresql', sourceType: 'test', description: 'db' });
  assert.equal(a.id, b.id);
  assert.equal(s.countEntities(), 1);
  const fetched = s.getEntity(a.id);
  assert.equal(fetched?.description, 'db');
  s.close();
});

test('relationships resolve endpoints and refresh degrees', () => {
  const s = tempStore();
  s.upsertEntity({ type: 'project', label: 'Singularity', sourceType: 'test' });
  s.upsertEntity({ type: 'technology', label: 'SQLite', sourceType: 'test' });
  s.upsertRelationship(
    { sourceLabel: 'Singularity', sourceType: 'project', targetLabel: 'SQLite', targetType: 'technology', relType: 'uses' },
    (label) => s.findByNormLabel(normLabel(label)),
  );
  const edges = s.edgesFor(new Set(s.topEntities(10).map((e) => e.id)));
  assert.equal(edges.length, 1);
  assert.equal(edges[0]?.relType, 'uses');
  s.refreshDegrees();
  const proj = s.findByNormLabel('singularity');
  assert.equal(proj?.degree, 1);
  s.close();
});

test('upsertRelationship is idempotent and keeps max confidence', () => {
  const s = tempStore();
  for (const label of ['A', 'B']) {
    s.upsertEntity({ type: 'concept', label, sourceType: 'test' });
  }
  const resolver = (label) => s.findByNormLabel(normLabel(label));
  s.upsertRelationship({ sourceLabel: 'A', sourceType: 'concept', targetLabel: 'B', targetType: 'concept', relType: 'related_to', confidence: 0.5 }, resolver);
  s.upsertRelationship({ sourceLabel: 'A', sourceType: 'concept', targetLabel: 'B', targetType: 'concept', relType: 'related_to', confidence: 0.9 }, resolver);
  const all = s.topEntities(2).map((e) => e.id);
  const edges = s.edgesFor(new Set(all));
  assert.equal(edges.length, 1);
  assert.equal(edges[0]?.confidence, 0.9);
  s.close();
});

test('episodes persist and are queryable per entity', () => {
  const s = tempStore();
  const e = s.upsertEntity({ type: 'decision', label: 'Kafka over Redis', sourceType: 'test' });
  s.addEpisode({ kind: 'decision', summary: 'Chose Kafka', entityIds: [e.id], occurredAt: Date.now() });
  const eps = s.episodesFor(e.id);
  assert.equal(eps.length, 1);
  assert.equal(eps[0]?.summary, 'Chose Kafka');
  s.close();
});

test('sync state round-trips', () => {
  const s = tempStore();
  s.setSyncState({
    workspaceRoot: '/tmp/ws', status: 'running', phase: 'understanding', filesTotal: 10, filesDone: 4,
    startedAt: 1, updatedAt: 2,
  });
  const st = s.getSyncState('/tmp/ws');
  assert.equal(st?.filesDone, 4);
  assert.equal(st?.status, 'running');
  s.close();
});

test('hash embedder is deterministic and cosine works', async () => {
  const emb = new HashBrainEmbedder(64);
  const [a, b] = await emb.embed(['kubernetes networking', 'kubernetes networking']);
  const [c] = await emb.embed(['postgres indexing']);
  assert.deepEqual(a, b);
  assert.ok(cosine(a, c) < cosine(a, b));
});

test('type registry seeds dynamic categories', () => {
  const s = tempStore();
  const types = s.listTypeRegistry();
  assert.ok(types.length >= 30, `expected expanded semantic types, got ${types.length}`);
  const names = new Set(types.map((t) => t.type));
  assert.equal(names.size, types.length, 'each type id is unique');
  assert.ok(names.has('architecture') && names.has('decision') && names.has('experiment'));
  s.registerType('framework', 'Frameworks', '#abcdef');
  assert.equal(s.listTypeRegistry().some((t) => t.type === 'framework'), true);
  s.close();
});
