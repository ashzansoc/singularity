import type { Hono } from 'hono';
import type { ArchitectureSubsystem } from '../subsystem.js';
import { createDomainEvent, type DomainEvent } from '../events/types.js';

export function mountArchitectureRoutes(app: Hono, sys: ArchitectureSubsystem): void {
  app.get('/architecture/decisions', (c) => {
    const status = c.req.query('status');
    const list = sys.store.list({
      project_id: sys.projectId,
      status: status as never,
    });
    return c.json({ decisions: list });
  });

  app.get('/architecture/decisions/:id', (c) => {
    const adr = sys.store.get(c.req.param('id'));
    if (!adr) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(adr);
  });

  app.get('/architecture/decisions/:id/evidence', (c) => {
    const adr = sys.store.get(c.req.param('id'));
    if (!adr) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({
      adr_id: adr.id,
      evidence: adr.evidence,
      correlations: sys.store
        .listCorrelations(sys.projectId)
        .filter((x) => x.target_type === 'ADR' && x.target_id === adr.id),
    });
  });

  app.post('/architecture/decisions', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const adr = sys.createAdr(body);
    return c.json(adr, 201);
  });

  app.patch('/architecture/decisions/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const adr = sys.patchAdr(c.req.param('id'), body);
    if (!adr) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(adr);
  });

  app.get('/architecture/search', async (c) => {
    const q = c.req.query('q') ?? c.req.query('query') ?? '';
    const historical = c.req.query('historical') === '1' || c.req.query('historical') === 'true';
    const hits = await sys.search(q, { historical });
    return c.json({ hits });
  });

  app.get('/architecture/context', (c) => {
    const entity = c.req.query('entity') ?? 'workspace';
    const cached = sys.cache.get(entity) ?? sys.cache.get('workspace');
    if (!cached) {
      return c.json({
        entity,
        decisions: [],
        constraints: [],
        dependencies: [],
        architectural_risks: [],
      });
    }
    return c.json({
      entity: cached.entity,
      decisions: cached.architecture_context.decisions,
      constraints: cached.architecture_context.constraints,
      dependencies: cached.architecture_context.dependencies,
      architectural_risks: cached.architecture_context.risks,
      conflicts: cached.architecture_context.conflicts ?? [],
      prompt_block: cached.architecture_context.prompt_block,
      version: cached.version,
    });
  });

  app.get('/architecture/services/:id/decisions', (c) => {
    const id = c.req.param('id');
    const decisions = sys.history(id);
    return c.json({ service: id, decisions });
  });

  app.get('/architecture/conflicts', (c) => {
    return c.json({ conflicts: sys.store.listConflicts(sys.projectId) });
  });

  app.post('/architecture/conflicts', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      change?: string;
      affected_files?: string[];
    };
    const result = sys.checkConflicts(body.change ?? '', body.affected_files);
    return c.json({ conflicts: result });
  });

  app.get('/architecture/graph', (c) => {
    const entity = c.req.query('entity') ?? c.req.query('id') ?? 'workspace';
    const depth = Number(c.req.query('depth') ?? '2');
    return c.json(sys.neighborhood(entity, Number.isFinite(depth) ? depth : 2));
  });

  app.post('/architecture/validate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { adr_id?: string; sync?: boolean };
    if (body.sync && body.adr_id) {
      const result = sys.validateAdr(body.adr_id);
      if (!result) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json(result);
    }
    sys.emit({
      event_type: 'ARCHITECTURE_VALIDATION_REQUESTED',
      project_id: sys.projectId,
      payload: { adr_id: body.adr_id },
    });
    return c.json({ queued: true });
  });

  app.get('/architecture/impact-analysis/:analysisId', (c) => {
    const row = sys.getImpact(c.req.param('analysisId'));
    if (!row) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(row);
  });

  app.get('/architecture/impact-analysis', (c) => {
    const change = c.req.query('change');
    const files = c.req.query('files');
    const symbols = c.req.query('symbols');
    if (change != null || files != null || symbols != null) {
      const hit = sys.lookupImpactByRequest({
        change: change ?? '',
        affected_files: (files ?? '').split(',').filter(Boolean),
        symbols: (symbols ?? '').split(',').filter(Boolean),
      });
      if (!hit) {
        return c.json({ status: 'miss' });
      }
      return c.json(hit);
    }
    return c.json({ analyses: sys.listImpacts() });
  });

  app.post('/architecture/impact-analysis', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      change?: string;
      affected_files?: string[];
      symbols?: string[];
      commit_id?: string;
      repository?: string;
      sync?: boolean;
    };
    if (body.sync) {
      const queued = sys.ingestImpact(body);
      if (!queued.analysis_id) {
        return c.json(queued, queued.code === 'disabled' ? 200 : 400);
      }
      const result = await sys.runImpact(queued.analysis_id);
      return c.json(result ?? queued);
    }
    const result = sys.ingestImpact(body);
    const status = result.queued ? (result.status === 'completed' ? 200 : 202) : result.code === 'disabled' ? 200 : 400;
    return c.json(result, status);
  });

  app.get('/architecture/risk-assessments/:assessmentId', (c) => {
    const row = sys.getRisk(c.req.param('assessmentId'));
    if (!row) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(row);
  });

  app.get('/architecture/risk-assessments', (c) => {
    const missionId = c.req.query('mission_id');
    const change = c.req.query('change');
    const files = c.req.query('files');
    const symbols = c.req.query('symbols');
    if (missionId) {
      const hit = sys.lookupRiskByMission(missionId);
      if (!hit) {
        return c.json({ status: 'miss' });
      }
      return c.json(hit);
    }
    if (change != null || files != null || symbols != null) {
      const hit = sys.lookupRiskByRequest({
        change: change ?? '',
        affected_files: (files ?? '').split(',').filter(Boolean),
        symbols: (symbols ?? '').split(',').filter(Boolean),
      });
      if (!hit) {
        return c.json({ status: 'miss' });
      }
      return c.json(hit);
    }
    return c.json({ assessments: sys.listRisks() });
  });

  app.post('/architecture/risk-assessments', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'malformed' }, 400);
    }
    const rec = body as {
      mission_id?: string;
      change?: string;
      affected_files?: string[];
      changed_files?: string[];
      symbols?: string[];
      changed_symbols?: string[];
      services?: string[];
      commit_id?: string;
      commit?: string;
      repository?: string;
      prompt_risk?: unknown;
      verification?: unknown;
      sync?: boolean;
    };
    if (rec.sync) {
      const queued = sys.ingestRisk(rec);
      if (!queued.assessment_id) {
        return c.json(queued, queued.code === 'disabled' ? 200 : 400);
      }
      const result = await sys.runRisk(queued.assessment_id);
      return c.json(result ?? queued);
    }
    const result = sys.ingestRisk(rec);
    const status = result.queued
      ? result.status === 'completed' && result.assessment_status !== 'STALE'
        ? 200
        : 202
      : result.code === 'disabled'
        ? 200
        : 400;
    return c.json(result, status);
  });

  app.get('/architecture/drift', (c) => {
    return c.json({ drifts: sys.store.listDrifts(sys.projectId) });
  });

  app.get('/architecture/drift/:id', (c) => {
    const d = sys.store.getDrift(c.req.param('id'));
    if (!d) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(d);
  });

  app.patch('/architecture/drift/:id', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { status?: string };
    const status = body.status;
    if (
      status !== 'open' &&
      status !== 'acknowledged' &&
      status !== 'resolved' &&
      status !== 'false_positive'
    ) {
      return c.json({ error: 'invalid_status' }, 400);
    }
    const d = sys.patchDrift(c.req.param('id'), status);
    if (!d) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(d);
  });

  app.post('/architecture/drift', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      affected_files?: string[];
      sync?: boolean;
    };
    if (body.sync) {
      const drifts = sys.scanDrift(body.affected_files);
      return c.json({ drifts });
    }
    sys.emit({
      event_type: 'ARCHITECTURE_DRIFT_SCAN_REQUESTED',
      project_id: sys.projectId,
      changed_files: body.affected_files,
      payload: { affected_files: body.affected_files },
    });
    return c.json({ queued: true });
  });

  app.get('/architecture/evolution', (c) => {
    return c.json({ proposals: sys.store.listEvolutions(sys.projectId) });
  });

  app.post('/architecture/evolution', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      trigger?: 'drift' | 'incident' | 'deployment_failure' | 'validation';
    };
    const proposals = sys.evolve(body.trigger ?? 'drift');
    return c.json({ proposals });
  });

  app.post('/architecture/evidence', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      event_type?: DomainEvent['event_type'];
      payload?: Record<string, unknown>;
      changed_files?: string[];
      sync?: boolean;
    };
    if (body.sync) {
      const event = createDomainEvent({
        event_type: body.event_type ?? 'INCIDENT_REPORTED',
        project_id: sys.projectId,
        changed_files: body.changed_files,
        payload: body.payload,
      });
      const updated = sys.attachEvidence(event);
      sys.emit(event);
      return c.json({ attached: updated.map((a) => a.id) });
    }
    const queued = sys.ingestProduction({
      event_type: body.event_type ?? 'INCIDENT_REPORTED',
      payload: body.payload,
      changed_files: body.changed_files,
      ...body.payload,
    });
    return c.json(queued);
  });

  app.post('/architecture/production/events', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const rec = body as { sync?: boolean };
    if (rec.sync) {
      try {
        const result = sys.processProductionSync(body);
        return c.json({
          event_id: result.event_id,
          attached: result.adrs.map((a) => a.id),
          correlations: result.correlations,
        });
      } catch (e) {
        return c.json({ error: e instanceof Error ? e.message : 'invalid' }, 400);
      }
    }
    const result = sys.ingestProduction(body);
    const status = result.queued ? 202 : result.code === 'disabled' ? 200 : 400;
    return c.json(result, status);
  });

  app.get('/architecture/production/query', (c) => {
    const q = c.req.query('q') ?? 'incidents';
    return c.json(sys.queryProduction(q));
  });

  app.get('/architecture/production/events/:id', (c) => {
    const event = sys.getProductionEvent(c.req.param('id'));
    if (!event) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(event);
  });

  app.get('/architecture/evidence/:id', (c) => {
    const id = c.req.param('id');
    const corr = sys.store.getCorrelation(id);
    if (corr) {
      return c.json(corr);
    }
    const drift = sys.store.getDrift(id);
    if (drift) {
      return c.json(drift);
    }
    const event = sys.getProductionEvent(id);
    if (event) {
      return c.json(event);
    }
    return c.json({ error: 'not_found' }, 404);
  });

  app.get('/architecture/debug/incidents/:id', (c) => {
    const ctx = sys.debugContext(c.req.param('id'));
    if (!ctx) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(ctx);
  });

  app.get('/architecture/metrics', (c) => c.json(sys.metrics.snapshot()));
}
