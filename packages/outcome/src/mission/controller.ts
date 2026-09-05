import type { Mission, OutcomeRequirement } from '../domain/types.js';
import { newId, nowIso, paddedReqId, requirementVersionHash } from '../ids.js';
import type { ExtractedRequirementDraft } from '../extraction/heuristic.js';

export function createMissionRecord(opts: {
  projectId: string;
  text: string;
  sessionId?: string;
  codeRevision?: string;
}): Mission {
  const now = nowIso();
  const id = newId('MISSION');
  return {
    id,
    mission_id: id,
    project_id: opts.projectId,
    title: opts.text.slice(0, 80),
    request_text: opts.text,
    status: 'IN_PROGRESS',
    lifecycle: 'CREATED',
    session_id: opts.sessionId,
    code_revision: opts.codeRevision,
    created_at: now,
    updated_at: now,
    version: 1,
  };
}

export function draftsToRequirements(
  mission: Mission,
  drafts: ExtractedRequirementDraft[],
): OutcomeRequirement[] {
  const now = nowIso();
  return drafts.map((d, i) => {
    const id = `${mission.id}:${paddedReqId(i + 1)}`;
    const hash = requirementVersionHash({
      description: d.description,
      type: d.type,
      acceptance: [d.description],
    });
    return {
      id,
      mission_id: mission.id,
      description: d.description,
      type: d.type,
      priority: d.priority,
      criticality: d.criticality,
      status: 'PENDING',
      source: { type: 'user_request', text: d.source_text },
      constraints: d.constraints,
      dependencies: [],
      measurable_properties: [],
      requirement_version_hash: hash,
      scope: 'MISSION',
      owned_paths: [],
      created_at: now,
      updated_at: now,
      version: 1,
    };
  });
}

export function bumpMission(mission: Mission, patch: Partial<Mission>): Mission {
  return {
    ...mission,
    ...patch,
    updated_at: nowIso(),
    version: mission.version + 1,
  };
}
