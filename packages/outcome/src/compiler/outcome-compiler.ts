import type { AcceptanceCriterion, OutcomeRequirement, VerificationType } from '../domain/types.js';
import { nowIso, paddedAcId } from '../ids.js';

export interface CompiledOutcome {
  requirementId: string;
  outcome: { statement: string; measurable: boolean };
  acceptanceCriteria: AcceptanceCriterion[];
}

function pickVerificationType(text: string): VerificationType {
  const t = text.toLowerCase();
  if (/\bcompil|\btypescript|\btsc\b|\bnoemit/.test(t)) {
    return 'COMPILER';
  }
  if (/\bhttp|status|401|400|201|jwt|endpoint|api|integrat/.test(t)) {
    return 'TEST';
  }
  if (/\bhash|plaintext|database inspect|npm test|pytest/.test(t)) {
    return 'COMMAND';
  }
  if (/\bui|button|browser|click/.test(t)) {
    return 'BROWSER';
  }
  return 'TEST';
}

export function compileRequirement(req: OutcomeRequirement): CompiledOutcome {
  const now = nowIso();
  const condition = req.description;
  const verification_type = pickVerificationType(condition);
  const ac: AcceptanceCriterion = {
    id: paddedAcId(req.id, 1),
    mission_id: req.mission_id,
    requirement_id: req.id,
    condition,
    verification_type,
    mandatory: req.criticality === 'CRITICAL' || req.criticality === 'HIGH',
    status: 'PENDING',
    created_at: now,
    updated_at: now,
    version: 1,
  };
  return {
    requirementId: req.id,
    outcome: {
      statement: condition,
      measurable: verification_type !== 'BROWSER',
    },
    acceptanceCriteria: [ac],
  };
}

export class OutcomeCompiler {
  compile(req: OutcomeRequirement): CompiledOutcome {
    return compileRequirement(req);
  }
}
