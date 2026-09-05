import type { Adr, AdrStatus } from './schema.js';

const ALLOWED: Record<AdrStatus, AdrStatus[]> = {
  proposed: ['accepted', 'rejected', 'deprecated'],
  accepted: ['implemented', 'superseded', 'rejected', 'deprecated'],
  implemented: ['validated', 'superseded', 'deprecated'],
  validated: ['superseded', 'deprecated'],
  superseded: [],
  rejected: [],
  deprecated: [],
};

export function canTransition(from: AdrStatus, to: AdrStatus): boolean {
  if (from === to) {
    return true;
  }
  return ALLOWED[from].includes(to);
}

export function transitionAdr(adr: Adr, to: AdrStatus, supersededBy?: string): Adr {
  if (!canTransition(adr.status, to)) {
    throw new Error(`Illegal ADR transition ${adr.status} → ${to}`);
  }
  const next: Adr = {
    ...adr,
    status: to,
    version: adr.version + (to === adr.status ? 0 : 1),
    timestamps: {
      ...adr.timestamps,
      updated_at: new Date().toISOString(),
    },
  };
  if (to === 'superseded' && supersededBy) {
    next.relationships = { ...next.relationships, superseded_by: supersededBy };
  }
  return next;
}

/** Mark `oldAdr` superseded by `newId` and point the new ADR at the old one. */
export function applySupersession(oldAdr: Adr, newAdr: Adr): { old: Adr; next: Adr } {
  const old = transitionAdr(oldAdr, 'superseded', newAdr.id);
  const next: Adr = {
    ...newAdr,
    relationships: {
      ...newAdr.relationships,
      supersedes: oldAdr.id,
      related: [...new Set([...(newAdr.relationships.related ?? []), oldAdr.id])],
    },
  };
  return { old, next };
}

/** Active-for-retrieval statuses (prefer these over historical). */
export function isActiveStatus(status: AdrStatus): boolean {
  return (
    status === 'accepted' ||
    status === 'implemented' ||
    status === 'validated' ||
    status === 'proposed'
  );
}
