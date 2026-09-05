import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { IntelligenceEngine } from './engine.js';
import { formatContextBlock } from './retriever.js';
import {
  mountArchitectureRoutes,
  type ArchitectureSubsystem,
} from '@singularity/architecture';
import { mountMemoryRoutes, type MemorySubsystem } from '@singularity/memory';
import { mountOutcomeRoutes, type OutcomeSubsystem } from '@singularity/outcome';
import { wireArchitectureGovernance } from './architectureReviewPort.js';

export function createIntelligenceApp(
  engine: IntelligenceEngine,
  architecture?: ArchitectureSubsystem,
  memory?: MemorySubsystem,
  outcome?: OutcomeSubsystem,
): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/project-status', (c) => c.json(engine.status()));

  app.get('/context', (c) => {
    const q = c.req.query('q') ?? c.req.query('query') ?? '';
    const res = engine.getContext(q);
    return c.json({ ...res, prompt_block: formatContextBlock(res) });
  });

  app.post('/search', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { query?: string; limit?: number };
    const query = body.query ?? '';
    return c.json({ hits: engine.search(query, body.limit ?? 24) });
  });

  app.post('/symbols', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { query?: string; limit?: number };
    return c.json({ symbols: engine.symbols(body.query ?? '', body.limit ?? 24) });
  });

  app.post('/impact', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { symbol?: string; depth?: number };
    return c.json(engine.impact(body.symbol ?? '', body.depth ?? 2));
  });

  app.get('/dependencies', (c) => {
    const symbol = c.req.query('symbol') ?? '';
    const depth = Number(c.req.query('depth') ?? '2');
    return c.json(engine.dependencies(symbol, Number.isFinite(depth) ? depth : 2));
  });

  app.get('/architecture', (c) => c.json(engine.architecture()));
  app.get('/architecture/summary', (c) => c.json(engine.architecture()));

  if (architecture) {
    mountArchitectureRoutes(app, architecture);
  }
  if (memory) {
    mountMemoryRoutes(app, memory);
  }
  if (outcome) {
    mountOutcomeRoutes(app, outcome);
  }
  if (architecture && outcome) {
    wireArchitectureGovernance(architecture, outcome);
  }

  app.post('/events', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      kind?: 'FILE_CREATED' | 'FILE_MODIFIED' | 'FILE_DELETED';
      uri?: string;
      referenced?: string[];
    };
    if (body.kind && body.uri) {
      engine.notifyFileEvent(body.kind, body.uri, body.referenced ?? []);
    }
    return c.json({ ok: true, queue: engine.status().jobQueueDepth });
  });

  app.post('/lsp', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      relations?: Array<{
        fromUri: string;
        toUri: string;
        kind: 'calls' | 'references' | 'defined_in' | 'implements' | 'extends';
        fromName?: string;
        toName?: string;
      }>;
    };
    const n = engine.applyLsp(body.relations ?? []);
    return c.json({ ok: true, edges: n });
  });

  app.post('/bootstrap', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      scope?: 'full' | 'recent';
      paths?: string[];
    };
    const scope = body.scope ?? 'recent';
    if (scope === 'full') {
      const boot = await engine.bootstrapAsync();
      return c.json({ ok: true, scope, files: boot.files });
    }
    const boot = await engine.bootstrapRecent(body.paths ?? []);
    return c.json({ ok: true, scope: 'recent', files: boot.files });
  });

  /** Fire-and-forget coding-plane events (architecture / memory / outcome). */
  app.post('/plane/coding-event', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      event_type?: string;
      project_id?: string;
      changed_files?: string[];
      text?: string;
      session_id?: string;
      task_id?: string;
      commit_id?: string;
    };
    const projectId = body.project_id ?? 'default';
    const payload = body.text ? { text: body.text } : undefined;
    try {
      if (architecture && body.event_type) {
        architecture.emit({
          event_type: body.event_type as 'FILE_MODIFIED',
          project_id: projectId,
          changed_files: body.changed_files,
          session_id: body.session_id,
          task_id: body.task_id,
          commit_id: body.commit_id,
          payload,
        });
      }
    } catch {
      /* optional */
    }
    try {
      if (memory && body.event_type) {
        const map: Record<string, string> = {
          USER_INTENT_CAPTURED: 'conversation.completed',
          CODE_CHANGE_COMPLETED: 'code.changed',
          FILE_CREATED: 'code.changed',
          FILE_MODIFIED: 'code.changed',
          FILE_DELETED: 'code.changed',
          COMMIT_CREATED: 'commit.created',
        };
        memory.emit({
          event_type: map[body.event_type] ?? body.event_type,
          project_id: projectId,
          task_id: body.task_id,
          payload: {
            text: body.text,
            files_changed: body.changed_files,
            commit_id: body.commit_id,
            session_id: body.session_id,
          },
        });
      }
    } catch {
      /* optional */
    }
    try {
      if (outcome && body.event_type) {
        outcome.emit({
          event_type: body.event_type as 'FILE_MODIFIED',
          project_id: projectId,
          changed_files: body.changed_files,
          session_id: body.session_id,
          task_id: body.task_id,
          commit_id: body.commit_id,
          payload,
        });
      }
    } catch {
      /* optional */
    }
    return c.json({ ok: true });
  });

  return app;
}

export interface ServeOptions {
  port?: number;
  hostname?: string;
}

export function serveIntelligence(
  engine: IntelligenceEngine,
  options: ServeOptions = {},
  architecture?: ArchitectureSubsystem,
  memory?: MemorySubsystem,
  outcome?: OutcomeSubsystem,
): { port: number; close: () => void } {
  const hostname = options.hostname ?? '127.0.0.1';
  const app = createIntelligenceApp(engine, architecture, memory, outcome);
  let port = options.port ?? 4781;
  const server = serve(
    {
      fetch: app.fetch,
      port,
      hostname,
    },
    (info) => {
      port = info.port;
    },
  );
  return {
    get port() {
      return port;
    },
    close: () => {
      server.close();
      engine.stop();
    },
  };
}
