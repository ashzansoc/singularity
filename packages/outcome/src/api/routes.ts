import type { Hono } from 'hono';
import type { OutcomeSubsystem } from '../subsystem.js';
import { parseReviewerHeaders } from '../review/reviewerPolicy.js';
import type { HumanReviewDecision } from '../domain/types.js';

function identityFrom(c: { req: { header: (name: string) => string | undefined } }) {
  return parseReviewerHeaders({
    get: (name) => c.req.header(name),
  });
}

export function mountOutcomeRoutes(app: Hono, sys: OutcomeSubsystem): void {
  app.post('/missions', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      text?: string;
      sessionId?: string;
    };
    const text = body.text ?? '';
    if (!text.trim()) {
      return c.json({ error: 'text required' }, 400);
    }
    const created = sys.createMission(text, body.sessionId);
    return c.json(created, 202);
  });

  app.get('/missions/:missionId', (c) => {
    const id = c.req.param('missionId');
    const mission = sys.store.getMission(id);
    if (!mission) {
      return c.json({ error: 'not_found' }, 404);
    }
    const outcome = sys.store.getOutcome(id);
    const requirements = sys.store.listRequirements(id);
    const reviews = sys.store.listReviews(id);
    return c.json({ mission, outcome, requirements, reviews });
  });

  app.get('/missions/:missionId/requirements', (c) => {
    const id = c.req.param('missionId');
    return c.json({ requirements: sys.store.listRequirements(id) });
  });

  app.post('/missions/:missionId/outcomes/compile', (c) => {
    const id = c.req.param('missionId');
    const mission = sys.store.getMission(id);
    if (!mission) {
      return c.json({ error: 'not_found' }, 404);
    }
    sys.emit({
      event_type: 'mission.created',
      project_id: sys.projectId,
      mission_id: id,
      payload: { text: mission.request_text, request_text: mission.request_text },
    });
    return c.json({ status: 'QUEUED', missionId: id }, 202);
  });

  app.post('/missions/:missionId/verify', (c) => {
    const id = c.req.param('missionId');
    if (!sys.store.getMission(id)) {
      return c.json({ error: 'not_found' }, 404);
    }
    void sys.queueMissionVerify(id);
    return c.json({ status: 'QUEUED', missionId: id }, 202);
  });

  app.post('/missions/:missionId/reviews/evaluate', (c) => {
    const id = c.req.param('missionId');
    if (!sys.store.getMission(id)) {
      return c.json({ error: 'not_found' }, 404);
    }
    const queued = sys.queueReviewEvaluate(id);
    return c.json(queued, 202);
  });

  app.get('/missions/:missionId/reviews', (c) => {
    const id = c.req.param('missionId');
    if (!sys.store.getMission(id)) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({ reviews: sys.store.listReviews(id) });
  });

  app.get('/reviews/:id', (c) => {
    const review = sys.store.getReview(c.req.param('id'));
    if (!review) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({
      review,
      events: sys.store.listReviewEvents(review.id),
    });
  });

  app.get('/reviews/:id/evidence', (c) => {
    const review = sys.store.getReview(c.req.param('id'));
    if (!review) {
      return c.json({ error: 'not_found' }, 404);
    }
    const pkg = review.evidence_package_id
      ? sys.store.getEvidencePackage(review.evidence_package_id)
      : undefined;
    return c.json({ review_id: review.id, package: pkg ?? { missing: true } });
  });

  app.post('/reviews/:id/start', (c) => {
    const identity = identityFrom(c);
    if (!identity) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    try {
      const review = sys.startReview(c.req.param('id'), identity);
      return c.json({ review });
    } catch (e) {
      const msg = String(e);
      if (msg.includes('not_found')) {
        return c.json({ error: 'not_found' }, 404);
      }
      return c.json({ error: msg }, 409);
    }
  });

  const decide = (decision: HumanReviewDecision) => async (c: {
    req: {
      param: (n: string) => string;
      json: () => Promise<unknown>;
      header: (n: string) => string | undefined;
    };
    json: (body: unknown, status?: number) => Response;
  }) => {
    const identity = identityFrom(c);
    if (!identity) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string; comment?: string };
    const reason = body.reason ?? body.comment;
    try {
      const result = sys.decideReview(c.req.param('id'), decision, identity, reason);
      if (result.error) {
        return c.json({ error: result.error.code, message: result.error.message }, result.error.status as 400);
      }
      return c.json({ review: result.review });
    } catch (e) {
      const msg = String(e);
      if (msg.includes('not_found')) {
        return c.json({ error: 'not_found' }, 404);
      }
      sys.metrics.recordReviewEventFailure();
      return c.json({ error: 'failed', message: msg }, 503);
    }
  };

  app.post('/reviews/:id/approve', decide('APPROVE'));
  app.post('/reviews/:id/reject', decide('REJECT'));
  app.post('/reviews/:id/request-changes', decide('REQUEST_CHANGES'));

  app.get('/requirements/:requirementId', (c) => {
    const id = c.req.param('requirementId');
    const req = sys.store.getRequirement(id);
    if (!req) {
      return c.json({ error: 'not_found' }, 404);
    }
    const criteria = sys.store.listCriteria(id);
    const plans = sys.store.listPlansForRequirement(id);
    const evidence = sys.store.listEvidenceForRequirement(id);
    return c.json({ requirement: req, criteria, plans, evidence });
  });

  app.post('/requirements/:requirementId/verify', async (c) => {
    const id = c.req.param('requirementId');
    const result = await sys.queueVerify(id);
    if (result.status === 'NOT_FOUND') {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(result, 202);
  });

  app.get('/verification-runs/:id', (c) => {
    const run = sys.store.getRun(c.req.param('id'));
    if (!run) {
      return c.json({ error: 'not_found' }, 404);
    }
    const evidence = sys.store.listEvidenceForRun(run.id);
    return c.json({ run, evidence });
  });

  app.get('/outcome/metrics', (c) => {
    return c.json(sys.metrics.snapshot());
  });
}
