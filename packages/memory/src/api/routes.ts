import type { Hono } from 'hono';
import type { MemorySubsystem } from '../subsystem.js';
import { createMemoryEvent } from '../events/schemas.js';

function compactList(sys: MemorySubsystem, memories: Array<{ id: string; type: string; status: string; title: string; importance: number; confidence: number; source_type: string }>) {
  return memories.map((m) => sys.compact(m as never));
}

export function mountMemoryRoutes(app: Hono, sys: MemorySubsystem): void {
  const base = '/projects/:project_id';

  app.post(`${base}/memories`, async (c) => {
    const projectId = c.req.param('project_id');
    if (projectId !== sys.projectId && sys.projectId !== 'default') {
      return c.json({ error: 'project_mismatch' }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const memory = await sys.createMemory(body);
    return c.json(sys.compact(memory), 201);
  });

  app.get(`${base}/memories`, async (c) => {
    const status = c.req.query('status') as never;
    const list = await sys.store.list({
      project_id: sys.projectId,
      status,
      limit: 50,
    });
    return c.json({ memories: compactList(sys, list) });
  });

  app.get(`${base}/memories/:memory_id`, async (c) => {
    const mem = await sys.getMemory(c.req.param('memory_id'));
    if (!mem) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(mem);
  });

  app.patch(`${base}/memories/:memory_id`, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const mem = await sys.patchMemory(c.req.param('memory_id'), body);
    if (!mem) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(sys.compact(mem));
  });

  app.post(`${base}/memories/search`, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      query?: string;
      limit?: number;
      historical?: boolean;
    };
    const hits = await sys.search(body.query ?? '', body.limit ?? 10, Boolean(body.historical));
    return c.json({
      hits: hits.map((h) => ({ ...sys.compact(h.memory), score: Number(h.score.toFixed(4)) })),
    });
  });

  app.post(`${base}/memory/events`, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    sys.emit(
      createMemoryEvent({
        event_type: String(body.event_type ?? 'agent.discovery'),
        project_id: sys.projectId,
        task_id: body.task_id as string | undefined,
        agent_id: body.agent_id as string | undefined,
        payload: (body.payload as Record<string, unknown>) ?? body,
      }),
    );
    return c.json({ ok: true, queued: true });
  });

  app.post(`${base}/memory/extract`, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    sys.emit({
      event_type: 'agent.discovery',
      project_id: sys.projectId,
      payload: { text: String(body.text ?? body.summary ?? '') },
    });
    return c.json({ ok: true, queued: true });
  });

  app.post(`${base}/memory/consolidate`, async (c) => {
    const rec = await sys.consolidate();
    return c.json({ ok: true, memory: rec ? sys.compact(rec) : null });
  });

  app.get(`${base}/memory/snapshot`, async (c) => {
    return c.json(await sys.snapshot());
  });

  app.get(`${base}/memory/decisions`, async (c) => {
    const list = await sys.store.list({
      project_id: sys.projectId,
      type: 'ARCHITECTURAL_DECISION',
    });
    return c.json({ decisions: compactList(sys, list) });
  });

  app.get(`${base}/memory/relationships`, async (c) => {
    const entity = c.req.query('entity') ?? 'Project';
    return c.json(await sys.relationships(entity));
  });
}
