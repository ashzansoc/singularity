/**
 * Design Preview gate — human confirmation between Design Spec and coding.
 *
 * Status lifecycle:
 *   awaiting_choice → user asked "open Penpot preview?"
 *   awaiting_final  → preview open; wait for Final Design
 *   approved        → user finalized design in Penpot/board → code
 *   skipped         → user declined preview → code immediately
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DESIGN_PREVIEW_FILENAME = 'design-preview.json';
export const DEFAULT_PENPOT_URL = 'http://localhost:9001';

export type DesignPreviewStatus =
  | 'awaiting_choice'
  | 'awaiting_final'
  | 'approved'
  | 'skipped';

export interface DesignPreviewGate {
  version: 1;
  status: DesignPreviewStatus;
  specPath: string;
  penpotUrl: string;
  productName?: string;
  notes?: string;
  updatedAt: string;
}

export function designPreviewPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.singularity', DESIGN_PREVIEW_FILENAME);
}

export function isDesignCodingUnlocked(status: DesignPreviewStatus | undefined): boolean {
  return status === 'approved' || status === 'skipped';
}

export function loadDesignPreviewGate(workspaceRoot: string): DesignPreviewGate | undefined {
  const file = designPreviewPath(workspaceRoot);
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as DesignPreviewGate;
    if (raw?.version !== 1 || !raw.status) {
      return undefined;
    }
    return raw;
  } catch {
    return undefined;
  }
}

export function saveDesignPreviewGate(
  workspaceRoot: string,
  gate: Omit<DesignPreviewGate, 'version' | 'updatedAt'> &
    Partial<Pick<DesignPreviewGate, 'version' | 'updatedAt'>>,
): DesignPreviewGate {
  const dir = join(workspaceRoot, '.singularity');
  mkdirSync(dir, { recursive: true });
  const next: DesignPreviewGate = {
    version: 1,
    status: gate.status,
    specPath: gate.specPath || '.singularity/design-spec.json',
    penpotUrl: gate.penpotUrl || DEFAULT_PENPOT_URL,
    productName: gate.productName,
    notes: gate.notes,
    updatedAt: gate.updatedAt ?? new Date().toISOString(),
  };
  writeFileSync(designPreviewPath(workspaceRoot), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function markDesignPreviewStatus(
  workspaceRoot: string,
  status: DesignPreviewStatus,
  patch: Partial<Pick<DesignPreviewGate, 'productName' | 'notes' | 'penpotUrl' | 'specPath'>> = {},
): DesignPreviewGate {
  const prev = loadDesignPreviewGate(workspaceRoot);
  return saveDesignPreviewGate(workspaceRoot, {
    status,
    specPath: patch.specPath ?? prev?.specPath ?? '.singularity/design-spec.json',
    penpotUrl: patch.penpotUrl ?? prev?.penpotUrl ?? DEFAULT_PENPOT_URL,
    productName: patch.productName ?? prev?.productName,
    notes: patch.notes ?? prev?.notes,
  });
}

/**
 * Poll until coding is unlocked (approved | skipped) or timeout.
 */
export async function waitForDesignCodingUnlock(
  workspaceRoot: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
    onTick?: (gate: DesignPreviewGate | undefined) => void;
  } = {},
): Promise<DesignPreviewGate | undefined> {
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const pollMs = options.pollMs ?? 800;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (options.signal?.aborted) {
      return loadDesignPreviewGate(workspaceRoot);
    }
    const gate = loadDesignPreviewGate(workspaceRoot);
    options.onTick?.(gate);
    if (gate && isDesignCodingUnlocked(gate.status)) {
      return gate;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return loadDesignPreviewGate(workspaceRoot);
}
