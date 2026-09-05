import {
  parseProductionEvent,
  ProductionIngestError,
  type ProductionEvent,
} from './schema.js';

export interface ProductionEventAdapter {
  readonly name: string;
  ingest(raw: unknown): ProductionEvent | undefined;
}

/**
 * Accepts already-canonical ProductionEvent JSON (custom webhooks).
 */
export class GenericWebhookAdapter implements ProductionEventAdapter {
  readonly name = 'generic-webhook';

  ingest(raw: unknown): ProductionEvent | undefined {
    try {
      return parseProductionEvent(raw);
    } catch (e) {
      if (e instanceof ProductionIngestError) {
        return undefined;
      }
      return undefined;
    }
  }
}

/**
 * Test fixture: maps a small in-memory record onto a ProductionEvent.
 * Slots for GitHub / GitLab / CI / Kubernetes / ArgoCD / Prometheus /
 * Grafana / Sentry / PagerDuty / Datadog are documented but not implemented.
 */
export class FixtureAdapter implements ProductionEventAdapter {
  readonly name = 'fixture';

  ingest(raw: unknown): ProductionEvent | undefined {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }
    const rec = raw as Record<string, unknown>;
    try {
      return parseProductionEvent({
        event_type: rec.type ?? rec.event_type,
        source: rec.source ?? 'fixture',
        source_event_id: rec.id ?? rec.source_event_id,
        timestamp: rec.timestamp,
        service: rec.service,
        environment: rec.environment,
        repository: rec.repository,
        branch: rec.branch,
        commit_sha: rec.commit ?? rec.commit_sha,
        deployment_id: rec.deployment_id,
        payload: rec,
      });
    } catch {
      return undefined;
    }
  }
}

export const PRODUCTION_ADAPTER_SLOTS = [
  'github',
  'gitlab',
  'cicd',
  'kubernetes',
  'argocd',
  'prometheus',
  'grafana',
  'sentry',
  'pagerduty',
  'datadog',
  'custom-webhook',
] as const;
